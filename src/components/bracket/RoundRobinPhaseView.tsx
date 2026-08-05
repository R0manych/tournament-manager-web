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

export default function RoundRobinPhaseView({
  name, groups, standings, pointsPerMatch,
  editable, generating, lockedNote, generateLabel, onGenerate,
}: Props) {
  const [draft, setDraft] = useState<GroupAssignment[]>(groups)
  const [dragId, setDragId] = useState<string | null>(null)

  // Re-sync the local draft whenever the server composition changes.
  const groupsKey = useMemo(() => JSON.stringify(groups.map(g => [g.groupLabel, g.participants.map(p => p.fighterId)])), [groups])
  useEffect(() => { setDraft(groups) }, [groupsKey])

  // Move dragged participant: before `beforeId` in group `toGroup`, or append when null.
  // Random seeding: shuffle everyone, then deal back preserving group sizes.
  const randomize = () => {
    setDraft(prev => {
      const shuffled = prev.flatMap(g => g.participants)
        .map(p => ({ p, r: Math.random() }))
        .sort((a, b) => a.r - b.r)
        .map(x => x.p)
      let offset = 0
      return prev.map(g => {
        const part = shuffled.slice(offset, offset + g.participants.length)
        offset += g.participants.length
        return { ...g, participants: part }
      })
    })
  }

  const moveTo = (toGroup: number, beforeId: string | null) => {
    if (!dragId) return
    setDraft(prev => {
      const dragged = prev.flatMap(g => g.participants).find(p => p.fighterId === dragId)
      if (!dragged) return prev
      const next = prev.map(g => ({ ...g, participants: g.participants.filter(p => p.fighterId !== dragId) }))
      const list = next[toGroup].participants
      const at = beforeId ? list.findIndex(p => p.fighterId === beforeId) : -1
      if (at >= 0) list.splice(at, 0, dragged)
      else list.push(dragged)
      return next
    })
    setDragId(null)
  }

  const displayGroups = editable ? draft : groups
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

      {editable && onGenerate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <button
            onClick={() => onGenerate(draft.map(g => ({ label: g.groupLabel, participantIds: g.participants.map(p => p.fighterId) })))}
            disabled={generating}
            title="Сохранить текущий состав групп и сгенерировать все встречи группового этапа"
          >
            {generating ? '…' : `⚙ ${generateLabel ?? 'Сформировать бои группового этапа'}`}
          </button>
          <button onClick={randomize} disabled={generating} title="Случайно перемешать участников по группам">
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
