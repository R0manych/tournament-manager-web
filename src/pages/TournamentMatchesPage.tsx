import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { tournamentsApi } from '../api/tournaments'
import { matchesApi } from '../api/matches'
import EncountersSection from '../components/EncountersSection'
import type { Match, MatchStatus, TournamentParticipant } from '../api/types'
import { participantName } from '../api/types'

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

function MatchRow({ match, participants }: { match: Match; participants: TournamentParticipant[] }) {
  const isBye = match.fighter2Id == null
  const f1 = participants.find(p => p.participantId === match.fighter1Id)
  const f2 = participants.find(p => p.participantId === match.fighter2Id)
  const n1 = f1 ? participantName(f1) : match.fighter1Id.slice(0, 8)
  const n2 = isBye ? '— (бай)' : (f2 ? participantName(f2) : (match.fighter2Id ?? '').slice(0, 8))

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
      <td style={{ ...TD, color: STATUS_COLOR[match.status] ?? '#888', whiteSpace: 'nowrap' }}>
        {STATUS_LABEL[match.status] ?? match.status}
      </td>
      <td style={{ ...TD, color: '#888', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
        {match.scheduledAt ? new Date(match.scheduledAt).toLocaleString('ru') : '—'}
      </td>
      <td style={TD}>
        <Link to={`/matches/${match.id}`}>→</Link>
      </td>
    </tr>
  )
}

export default function TournamentMatchesPage() {
  const { id } = useParams<{ id: string }>()

  const { data: tournament, isLoading: tLoading } = useQuery({
    queryKey: ['tournaments', id],
    queryFn: () => tournamentsApi.get(id!),
    enabled: !!id,
  })

  const isTeam = tournament?.participantKind === 'Team'

  const { data: matches, isLoading: mLoading } = useQuery({
    queryKey: ['matches', id],
    queryFn: () => matchesApi.listByTournament(id!),
    // Team tournaments are navigated as encounters (team windows), not flat bouts.
    enabled: !!id && tournament != null && !isTeam,
  })

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

  const scheduled = matches?.filter(m => m.status === 'Scheduled') ?? []
  const inProgress = matches?.filter(m => m.status === 'InProgress') ?? []
  // Двойное поражение — завершённая встреча (АР-16), иначе она навсегда
  // осталась бы в незавершённых.
  const completed =
    matches?.filter(
      m => m.status === 'Completed' || m.status === 'WalkoverWin' || m.status === 'DoubleLoss'
    ) ?? []
  const cancelled = matches?.filter(m => m.status === 'Cancelled') ?? []

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
                  <th style={TH}>Статус</th>
                  <th style={TH}>Время</th>
                  <th style={TH} />
                </tr>
              </thead>
              <tbody>
                {group.items.map(m => (
                  <MatchRow key={m.id} match={m} participants={tournament.participants} />
                ))}
              </tbody>
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
