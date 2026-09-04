import { useEffect, useMemo, useState } from 'react'
import type { GroupAssignment, GroupStanding } from './bracketUtils'
import type { SaveGroupItem } from '../../api/groups'

interface Props {
  name: string
  groups: GroupAssignment[]
  standings?: GroupStanding[][]
  pointsPerMatch?: { win: number; draw: number; loss: number }
  // Editing (snake-seeded phases in Draft only): rows become draggable between
  // group tables; the draft is persisted by onGenerate together with match
  // generation — there is no separate save.
  editable?: boolean
  generating?: boolean
  lockedNote?: string
  generateLabel?: string
  onGenerate?: (groups: SaveGroupItem[]) => void
  /**
   * Зарегистрированы, но не попали ни в одну сохранённую группу — обычно
   * дозаявленные после сохранения состава (`savedGroupsDrift`). Раньше они не
   * показывались нигде и молча выпадали из группового этапа.
   */
  unassigned?: GroupAssignment['participants']
  /** Сколько участников сохранённого состава снялись с турнира. */
  withdrawnCount?: number
}

const TH: React.CSSProperties = {
  padding: '5px 10px',
  fontWeight: 600,
  fontSize: 12,
  color: '#fff',
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

const TH_NUM: React.CSSProperties = { ...TH, textAlign: 'center', width: 36 }

const TD: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  borderBottom: '1px solid #f0f0f0',
  whiteSpace: 'nowrap',
}

const TD_NUM: React.CSSProperties = { ...TD, textAlign: 'center', color: '#555' }

const DRIFT_NOTE: React.CSSProperties = {
  background: '#fff4e5',
  color: '#a86500',
  border: '1px solid #f0d8b0',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 13,
  marginBottom: 10,
}

// Пул нарочно не похож на группу: у групп синяя шапка, у него — предупреждающая.
// Участник в этом блоке не играет, и спутать его с составом группы нельзя.
const POOL_BOX: React.CSSProperties = {
  border: '1px solid #f0d8b0',
  borderRadius: 6,
  overflow: 'hidden',
  marginBottom: 16,
  maxWidth: 320,
}

const POOL_HEAD: React.CSSProperties = {
  background: '#e8a33d',
  color: '#fff',
  padding: '6px 12px',
  fontWeight: 600,
  fontSize: 14,
}

interface Draft {
  groups: GroupAssignment[]
  /** Зарегистрированы, но пока ни в одной группе. В сохранение не уходят. */
  pool: GroupAssignment['participants']
}

/** Индекс «группы» для пула в `moveTo`: настоящие группы нумеруются с нуля. */
const POOL = -1

export default function RoundRobinPhaseView({
  name, groups, standings, pointsPerMatch,
  editable, generating, lockedNote, generateLabel, onGenerate,
  unassigned, withdrawnCount = 0,
}: Props) {
  // Группы и пул нераспределённых — одно состояние: участник переезжает между
  // ними перетаскиванием, и разводить их по двум `useState` значило бы держать
  // два эффекта синхронизации на один и тот же серверный состав.
  const [draft, setDraft] = useState<Draft>(() => ({ groups, pool: unassigned ?? [] }))
  const [dragId, setDragId] = useState<string | null>(null)

  // Re-sync the local draft whenever the server composition changes.
  const groupsKey = useMemo(
    () => JSON.stringify([
      groups.map(g => [g.groupLabel, g.participants.map(p => p.fighterId)]),
      (unassigned ?? []).map(p => p.fighterId),
    ]),
    [groups, unassigned],
  )
  useEffect(() => { setDraft({ groups, pool: unassigned ?? [] }) }, [groupsKey])

  // Случайный посев: перемешать всех и раздать обратно.
  //
  // Нераспределённые участвуют наравне с остальными, иначе кнопка «перемешать»
  // оставляла бы дозаявленного за бортом — ровно то, из-за чего его и не видно
  // было. Размеры групп при этом сохраняются, а пул доливается в самые мелкие:
  // так неравные группы, сделанные организатором намеренно, не схлопываются, а
  // новички расходятся ровно.
  const randomize = () => {
    setDraft(prev => {
      const shuffled = [...prev.groups.flatMap(g => g.participants), ...prev.pool]
        .map(p => ({ p, r: Math.random() }))
        .sort((a, b) => a.r - b.r)
        .map(x => x.p)

      const sizes = prev.groups.map(g => g.participants.length)
      for (let i = 0; i < prev.pool.length; i++) {
        let smallest = 0
        for (let g = 1; g < sizes.length; g++) if (sizes[g] < sizes[smallest]) smallest = g
        sizes[smallest]++
      }

      let offset = 0
      const groups = prev.groups.map((g, i) => {
        const part = shuffled.slice(offset, offset + sizes[i])
        offset += sizes[i]
        return { ...g, participants: part }
      })
      return { groups, pool: [] }
    })
  }

  // Переносит перетаскиваемого участника: перед `beforeId` в группу `toGroup`
  // (или в пул при `POOL`), в конец — когда `beforeId` пуст.
  const moveTo = (toGroup: number, beforeId: string | null) => {
    if (!dragId) return
    setDraft(prev => {
      const dragged =
        prev.groups.flatMap(g => g.participants).find(p => p.fighterId === dragId) ??
        prev.pool.find(p => p.fighterId === dragId)
      if (!dragged) return prev

      const groups = prev.groups.map(g => ({
        ...g,
        participants: g.participants.filter(p => p.fighterId !== dragId),
      }))
      const pool = prev.pool.filter(p => p.fighterId !== dragId)

      const list = toGroup === POOL ? pool : groups[toGroup].participants
      const at = beforeId ? list.findIndex(p => p.fighterId === beforeId) : -1
      if (at >= 0) list.splice(at, 0, dragged)
      else list.push(dragged)

      return { groups, pool }
    })
    setDragId(null)
  }

  const displayGroups = editable ? draft.groups : groups
  // В режиме правки пул живёт в черновике (из него перетаскивают), в
  // заблокированном — приходит как есть: там его только показывают.
  const pending = editable ? draft.pool : (unassigned ?? [])
  // While editing, rows must follow the draft order — standings (all-zero in
  // Draft anyway) would resurrect the pre-edit composition.
  const effectiveStandings = editable ? undefined : standings

  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{ marginBottom: 12, color: '#444' }}>{name}</h3>
      {pointsPerMatch && (
        <p style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
          Очки: победа {pointsPerMatch.win} / ничья {pointsPerMatch.draw} / поражение {pointsPerMatch.loss}
        </p>
      )}

      {/* Расхождение сохранённого состава с текущей регистрацией. Снявшиеся уже
          убраны из групп, дозаявленные лежат в пуле ниже — но и то и другое
          означает, что сохранённый состав больше не соответствует заявке, и
          молчать об этом нельзя: бои группового этапа считаются по составу. */}
      {(pending.length > 0 || withdrawnCount > 0) && (
        <div style={DRIFT_NOTE}>
          {pending.length > 0 && (
            <div>
              <strong>Не распределены: {pending.length}</strong> — добавлены после сохранения состава.
              {editable
                ? ' Перетащите их в группы: пока они в этом списке, бои для них не сформируются.'
                : ' Чтобы включить их в группы, верните турнир в черновик.'}
            </div>
          )}
          {withdrawnCount > 0 && (
            <div style={{ marginTop: pending.length > 0 ? 4 : 0 }}>
              <strong>Снялись с турнира: {withdrawnCount}</strong> — из групп убраны.
              {editable
                ? ' Состав обновится при формировании боёв.'
                : ' Их бои остаются в списке встреч — отмените их вручную.'}
            </div>
          )}
        </div>
      )}

      {editable && onGenerate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <button
            onClick={() => onGenerate(draft.groups.map(g => ({ label: g.groupLabel, participantIds: g.participants.map(p => p.fighterId) })))}
            disabled={generating || pending.length > 0}
            title={
              pending.length > 0
                ? 'Сначала распределите всех участников по группам. Если участник не должен играть — снимите его с турнира в списке участников.'
                : 'Сохранить текущий состав групп и сгенерировать все встречи группового этапа'
            }
          >
            {generating ? '…' : `⚙ ${generateLabel ?? 'Сформировать бои группового этапа'}`}
          </button>
          <button onClick={randomize} disabled={generating} title="Случайно перемешать участников по группам (нераспределённые тоже попадут в группы)">
            🎲 Случайный посев
          </button>
          <span style={{ color: '#888', fontSize: 12 }}>
            Перетаскивайте участников между группами — состав сохранится при формировании боёв
          </span>
        </div>
      )}

      {!editable && lockedNote && (
        <p style={{ fontSize: 13, color: '#888', marginBottom: 10 }}>🔒 {lockedNote}</p>
      )}

      {/* Пул нераспределённых. Показывается и в заблокированном виде: участник,
          которого не видно нигде, — это тот же молчаливый пропуск, из-за
          которого дозаявленный выпадал из группового этапа. */}
      {pending.length > 0 && (
        <div
          onDragOver={editable ? e => e.preventDefault() : undefined}
          onDrop={editable ? e => { e.preventDefault(); moveTo(POOL, null) } : undefined}
          style={POOL_BOX}
        >
          <div style={POOL_HEAD}>Без группы ({pending.length})</div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {pending.map(p => (
                <tr
                  key={p.fighterId}
                  draggable={editable}
                  onDragStart={editable ? () => setDragId(p.fighterId) : undefined}
                  onDragEnd={editable ? () => setDragId(null) : undefined}
                  onDragOver={editable ? e => e.preventDefault() : undefined}
                  onDrop={editable ? e => { e.preventDefault(); e.stopPropagation(); moveTo(POOL, p.fighterId) } : undefined}
                  style={editable ? { cursor: 'grab', opacity: dragId === p.fighterId ? 0.4 : 1 } : undefined}
                  title={editable ? 'Перетащите в группу' : undefined}
                >
                  <td style={TD_NUM}>{editable ? <span style={{ color: '#bbb' }}>⠿</span> : '—'}</td>
                  <td style={{ ...TD, color: '#1a1a1a' }}>
                    {p.name}
                    {p.seed != null && (
                      <span style={{ color: '#bbb', fontSize: 11, marginLeft: 5 }}>#{p.seed}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {displayGroups.map((group, gi) => {
          const groupStandings = effectiveStandings?.[gi]
          const standingMap = groupStandings
            ? new Map(groupStandings.map(s => [s.fighterId, s]))
            : null

          // Order rows by standing if available, otherwise by seed
          const rows = standingMap
            ? groupStandings!.map((s, rank) => {
                const p = group.participants.find(x => x.fighterId === s.fighterId)!
                return { id: s.fighterId, rank: rank + 1, name: p?.name ?? s.fighterId, seed: p?.seed, standing: s }
              })
            : group.participants.map((p, i) => ({
                id: p.fighterId,
                rank: i + 1,
                name: p.name,
                seed: p.seed,
                standing: null as GroupStanding | null,
              }))

          const hasStats = standingMap !== null

          return (
            <div
              key={group.groupLabel}
              onDragOver={editable ? e => e.preventDefault() : undefined}
              onDrop={editable ? e => { e.preventDefault(); moveTo(gi, null) } : undefined}
              style={{
                border: '1px solid #ddd',
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              <div style={{
                background: '#4a6fa5',
                color: '#fff',
                padding: '6px 12px',
                fontWeight: 600,
                fontSize: 14,
              }}>
                Группа {group.groupLabel}
              </div>

              {group.participants.length === 0 ? (
                <p style={{ padding: '6px 12px', color: '#aaa', fontSize: 13, margin: 0 }}>
                  {editable ? 'Перетащите участников сюда' : 'Нет участников'}
                </p>
              ) : (
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                    <tr style={{ background: '#4a6fa5' }}>
                      <th style={TH_NUM}>#</th>
                      <th style={TH}>Участник</th>
                      {hasStats && <>
                        <th style={TH_NUM} title="Победы">В</th>
                        <th style={TH_NUM} title="Ничьи">Н</th>
                        <th style={TH_NUM} title="Поражения">П</th>
                        <th style={TH_NUM} title="Очки">Оч</th>
                      </>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr
                        key={row.id}
                        draggable={editable}
                        onDragStart={editable ? () => setDragId(row.id) : undefined}
                        onDragEnd={editable ? () => setDragId(null) : undefined}
                        onDragOver={editable ? e => e.preventDefault() : undefined}
                        onDrop={editable ? e => { e.preventDefault(); e.stopPropagation(); moveTo(gi, row.id) } : undefined}
                        style={editable ? { cursor: 'grab', opacity: dragId === row.id ? 0.4 : 1 } : undefined}
                        title={editable ? 'Перетащите в другую группу или на другую строку для изменения порядка' : undefined}
                      >
                        <td style={TD_NUM}>{editable ? <span style={{ color: '#bbb' }}>⠿</span> : row.rank}</td>
                        <td style={{ ...TD, color: '#1a1a1a' }}>
                          {row.name}
                          {row.seed != null && (
                            <span style={{ color: '#bbb', fontSize: 11, marginLeft: 5 }}>#{row.seed}</span>
                          )}
                        </td>
                        {hasStats && row.standing && <>
                          <td style={{ ...TD_NUM, color: '#2a7a2a', fontWeight: 600 }}>{row.standing.wins}</td>
                          <td style={TD_NUM}>{row.standing.draws}</td>
                          <td style={{ ...TD_NUM, color: '#a00' }}>{row.standing.losses}</td>
                          <td style={{ ...TD_NUM, fontWeight: 600 }}>{row.standing.points}</td>
                        </>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
