import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { tournamentsApi } from '../api/tournaments'
import { matchesApi } from '../api/matches'
import EncountersSection from '../components/EncountersSection'
import type { Match, MatchStatus, TournamentFormat, TournamentParticipant } from '../api/types'
import { participantName } from '../api/types'
import { buildBoutOrder, compareBoutOrder, describePlacement } from '../components/bracket/bracketUtils'
import PisteAssign from '../components/PisteAssign'
import { usePistes } from '../components/usePistes'

// Типизировано по `MatchStatus` намеренно: с `Record<string, string>` новый
// статус отрисовался бы пустой строкой, и компилятор бы промолчал.
const STATUS_LABEL: Record<MatchStatus, string> = {
  Scheduled: 'Запланирована',
  InProgress: 'В процессе',
  Completed: 'Завершена',
  Cancelled: 'Отменена',
  WalkoverWin: 'Бай (тех. победа)',
  DoubleLoss: 'Двойное поражение',
}

const STATUS_COLOR: Record<MatchStatus, string> = {
  Scheduled: '#888',
  InProgress: '#0077cc',
  Completed: '#080',
  Cancelled: '#aaa',
  WalkoverWin: '#080',
  DoubleLoss: '#b3261e',
}

function MatchRow({
  match,
  participants,
  format,
  boutNumber,
  hasPistes,
}: {
  match: Match
  participants: TournamentParticipant[]
  format: TournamentFormat | undefined
  /** Место в очереди боёв своей ячейки; нет у неразмещённых встреч. */
  boutNumber: number | undefined
  /** В турнире заведены площадки — только тогда есть колонка ристалища. */
  hasPistes: boolean
}) {
  const isBye = match.fighter2Id == null
  const f1 = participants.find(p => p.participantId === match.fighter1Id)
  const f2 = participants.find(p => p.participantId === match.fighter2Id)
  const n1 = f1 ? participantName(f1) : match.fighter1Id.slice(0, 8)
  const n2 = isBye ? '— (бай)' : (f2 ? participantName(f2) : (match.fighter2Id ?? '').slice(0, 8))
  // Ячейки нет у встреч, заведённых вручную, и у турниров, созданных до
  // размещений (инвариант 46) — тогда стадия неизвестна, и врать о ней нельзя.
  const where = describePlacement(match.placement, format)

  return (
    <tr>
      <td style={TD}>
        <Link to={`/matches/${match.id}`}>{n1}</Link>
      </td>
      <td style={{ ...TD, textAlign: 'center', fontWeight: 700, fontSize: '1.05em' }}>
        {isBye
          ? 'бай'
          : match.status === 'Scheduled'
            ? 'vs'
            : `${match.score1} : ${match.score2}`}
      </td>
      <td style={{ ...TD, color: isBye ? '#aaa' : undefined }}>
        {isBye ? n2 : <Link to={`/matches/${match.id}`}>{n2}</Link>}
      </td>
      {/* Фаза и ячейка переехали в подзаголовок блока, поэтому здесь номер боя
          в очереди, а не адрес ячейки: очередь — это то, в каком порядке бои
          вызывают на ристалище, и по ней же отсортирован список. Адрес ячейки
          остался в подсказке — по нему ищут встречу в сетке. */}
      <td style={{ ...TD, whiteSpace: 'nowrap', color: '#888', fontVariantNumeric: 'tabular-nums' }}>
        {where && boutNumber != null ? (
          <span title={`${where.phase} · ${where.cell} · пара ${where.pair} по сетке`}>
            {boutNumber}
          </span>
        ) : (
          <span style={{ color: '#bbb' }}>—</span>
        )}
      </td>
      <td style={{ ...TD, color: STATUS_COLOR[match.status] ?? '#888', whiteSpace: 'nowrap' }}>
        {STATUS_LABEL[match.status] ?? match.status}
      </td>
      {/* Назначение площадки прямо из строки: на турнире это делают пачкой,
          заходить ради этого в карточку каждого боя незачем (docs/09 §6.2). */}
      {hasPistes && (
        <td style={TD}>
          <PisteAssign
            target={{ kind: 'match', match }}
            disabled={match.status !== 'Scheduled' && match.status !== 'InProgress'}
            disabledTitle="Бой завершён: назначать площадку задним числом нечему"
            compact
          />
        </td>
      )}
      <td style={{ ...TD, color: '#888', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
        {match.scheduledAt ? new Date(match.scheduledAt).toLocaleString('ru') : '—'}
      </td>
      <td style={TD}>
        <Link to={`/matches/${match.id}`}>→</Link>
      </td>
    </tr>
  )
}

// Блок таблицы = одна ячейка сетки: группа группового этапа, раунд плейофф,
// тур швейцарки. Встречи уже отсортированы `comparePlacements`, поэтому
// одноимённые идут подряд и блоки набираются одним проходом — пересортировка
// здесь сломала бы порядок пар внутри раунда.
interface CellChunk {
  key: string
  label: string
  phase?: string
  items: Match[]
}

const UNPLACED = '\0unplaced'

function chunkByCell(items: Match[], format: TournamentFormat | undefined): CellChunk[] {
  const chunks: CellChunk[] = []
  for (const match of items) {
    const p = match.placement
    // Ячейки нет — встреча заведена вручную или турнир создан до размещений
    // (инвариант 46). Такие идут одним блоком в конце, стадию им не выдумываем.
    const key = p ? `${p.phaseId}\0${p.roundId}` : UNPLACED
    const last = chunks[chunks.length - 1]
    if (last?.key === key) {
      last.items.push(match)
      continue
    }
    const where = describePlacement(p, format)
    chunks.push({
      key,
      label: where?.cell ?? 'Без стадии',
      phase: where?.phase,
      items: [match],
    })
  }
  return chunks
}

export default function TournamentMatchesPage() {
  const { id } = useParams<{ id: string }>()

  const { data: tournament, isLoading: tLoading } = useQuery({
    queryKey: ['tournaments', id],
    queryFn: () => tournamentsApi.get(id!),
    enabled: !!id,
  })

  const isTeam = tournament?.participantKind === 'Team'

  // Канонический ключ списка встреч турнира — `['tournament-matches', id]`
  // (B-7). Под `['matches', <uuid>]` живёт ОДНА встреча (`MatchPage`,
  // `MatchBoard`), и список под тем же префиксом не видел ни одной инвалидации
  // от генерации встреч и смены счёта: страница показывала устаревшие данные
  // до случайного рефетча по фокусу.
  const { data: matches, isLoading: mLoading } = useQuery({
    queryKey: ['tournament-matches', id],
    queryFn: ({ signal }) => matchesApi.listByTournament(id!, undefined, signal),
    // Team tournaments are navigated as encounters (team windows), not flat bouts.
    enabled: !!id && tournament != null && !isTeam,
  })

  // Ристалища турнира: пустой список — турнир на одной площадке (docs/09 §3.3),
  // и колонки назначения в списке тогда нет вовсе.
  const { data: pistes } = usePistes(id)

  // Формат даёт имена фазам и раундам: в размещении встречи лежат только их id.
  // 404 — законный ответ (формат не загружен), повторять запрос незачем.
  const { data: format } = useQuery({
    queryKey: ['tournament-format', id],
    queryFn: () => tournamentsApi.format.get(id!),
    enabled: !!id && tournament != null && !isTeam,
    retry: (failureCount, error: unknown) =>
      (error as { status?: number })?.status !== 404 && failureCount < 2,
  })

  const hasPistes = (pistes?.length ?? 0) > 0

  if (tLoading) return <p>Загрузка...</p>
  if (!tournament) return <p>Турнир не найден</p>

  // Team tournament: list the team encounters; each opens the team-encounter window
  // (/encounters/:id) which in turn drills into per-pair bout windows (/matches/:id).
  if (isTeam) {
    return (
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 16px' }}>
        <p style={{ margin: '12px 0 4px', color: '#888', fontSize: '0.9em' }}>
          <Link to={`/tournaments/${id}`}>← {tournament.name}</Link>
        </p>
        <h1 style={{ margin: '4px 0 20px' }}>Встречи</h1>
        <EncountersSection tournamentId={id!} participants={tournament.participants} />
      </div>
    )
  }

  if (mLoading) return <p>Загрузка...</p>

  // Очередь боёв считается по всему списку сразу, до фильтров по статусу:
  // сыгранные бои занимают в ней свои места, иначе номера в секциях разъедутся.
  const boutOrder = buildBoutOrder(matches ?? [])

  // Порядок внутри каждой секции — порядок проведения: групповой этап группами,
  // плейофф по раундам, внутри ячейки по очереди боёв. Встречи без ячейки уходят
  // в конец и держат прежний порядок по времени (`sort` в JS стабилен).
  const byTime = [...(matches ?? [])].sort((a, b) =>
    (a.scheduledAt ?? a.createdAt).localeCompare(b.scheduledAt ?? b.createdAt)
  )
  const ordered = byTime.sort((a, b) => compareBoutOrder(a, b, format, boutOrder))

  const scheduled = ordered.filter(m => m.status === 'Scheduled')
  const inProgress = ordered.filter(m => m.status === 'InProgress')
  // Двойное поражение — завершённая встреча (АР-16), иначе она навсегда
  // осталась бы в незавершённых.
  const completed = ordered.filter(
    m => m.status === 'Completed' || m.status === 'WalkoverWin' || m.status === 'DoubleLoss'
  )
  const cancelled = ordered.filter(m => m.status === 'Cancelled')

  const groups: Array<{ label: string; items: Match[] }> = [
    { label: 'В процессе', items: inProgress },
    { label: 'Запланированы', items: scheduled },
    { label: 'Завершены', items: completed },
    { label: 'Отменены', items: cancelled },
  ].filter(g => g.items.length > 0)

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 16px' }}>
      <p style={{ margin: '12px 0 4px', color: '#888', fontSize: '0.9em' }}>
        <Link to={`/tournaments/${id}`}>← {tournament.name}</Link>
      </p>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, margin: '4px 0 20px' }}>
        <h1 style={{ margin: 0 }}>Встречи</h1>
        <Link to={`/tournaments/${id}/matches/new`} style={{ fontSize: '0.95em' }}>
          + Создать встречу
        </Link>
      </div>

      {!matches || matches.length === 0 ? (
        <p style={{ color: '#888' }}>Встреч пока нет</p>
      ) : (
        groups.map(group => (
          <section key={group.label} style={{ marginBottom: 28 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: '1em', color: '#555', fontWeight: 600 }}>
              {group.label} ({group.items.length})
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95em' }}>
              <thead>
                <tr style={{ background: '#f5f5f5' }}>
                  <th style={TH}>Боец 1</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Счёт</th>
                  <th style={TH}>Боец 2</th>
                  <th style={TH} title="Порядок проведения боёв внутри стадии">№</th>
                  <th style={TH}>Статус</th>
                  {hasPistes && <th style={TH}>Ристалище</th>}
                  <th style={TH}>Время</th>
                  <th style={TH} />
                </tr>
              </thead>
              {chunkByCell(group.items, format).map(chunk => (
                <tbody key={chunk.key}>
                  <tr>
                    <th colSpan={hasPistes ? 8 : 7} style={SUBHEAD}>
                      {chunk.label}
                      {chunk.phase && (
                        <span style={SUBHEAD_MUTED}> · {chunk.phase}</span>
                      )}
                      <span style={SUBHEAD_MUTED}> · {chunk.items.length}</span>
                    </th>
                  </tr>
                  {chunk.items.map(m => (
                    <MatchRow
                      key={m.id}
                      match={m}
                      participants={tournament.participants}
                      format={format}
                      boutNumber={boutOrder.get(m.id)}
                      hasPistes={hasPistes}
                    />
                  ))}
                </tbody>
              ))}
            </table>
          </section>
        ))
      )}
    </div>
  )
}

const TH: React.CSSProperties = {
  border: '1px solid #ddd',
  padding: '5px 10px',
  textAlign: 'left',
  fontWeight: 600,
}

const TD: React.CSSProperties = {
  border: '1px solid #ddd',
  padding: '6px 10px',
}

// Подзаголовок блока. Разделяет не только фоном: верхняя граница толще границ
// строк, поэтому граница между группами видна и на плохом проекторе, и при
// печати в ч/б.
const SUBHEAD: React.CSSProperties = {
  border: '1px solid #ddd',
  borderTop: '3px solid #c9c9c9',
  padding: '8px 10px 6px',
  textAlign: 'left',
  background: '#fafafa',
  fontWeight: 700,
}

const SUBHEAD_MUTED: React.CSSProperties = {
  color: '#888',
  fontWeight: 400,
  fontSize: '0.85em',
}
