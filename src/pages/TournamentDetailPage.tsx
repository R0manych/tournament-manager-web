import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { tournamentsApi } from '../api/tournaments'
import { matchesApi } from '../api/matches'
import TournamentFormatSection from '../components/TournamentFormatSection'

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>()

  const { data: tournament, isLoading } = useQuery({
    queryKey: ['tournaments', id],
    queryFn: () => tournamentsApi.get(id!),
    enabled: !!id,
  })

  const { data: matches } = useQuery({
    queryKey: ['matches', id],
    queryFn: () => matchesApi.listByTournament(id!),
    enabled: !!id,
  })

  if (isLoading) return <p>Загрузка...</p>
  if (!tournament) return <p>Турнир не найден</p>

  const hasMatches = (matches?.length ?? tournament.matchesCount ?? 0) > 0

  return (
    <div>
      <h1>{tournament.name}</h1>
      {tournament.nomination && <p>Номинация: {tournament.nomination}</p>}
      {tournament.description && <p>{tournament.description}</p>}
      <p>Статус: {tournament.status}</p>
      <p>Даты: {tournament.startDate} — {tournament.endDate}</p>

      <TournamentFormatSection
        tournamentId={id!}
        hasMatches={hasMatches}
        participants={tournament.participants}
      />

      <h2>Участники ({tournament.participants.length})</h2>
      <ul>
        {tournament.participants.map(p => (
          <li key={p.fighterId}>{p.firstName} {p.lastName} {p.club && `(${p.club})`}</li>
        ))}
      </ul>

      <h2>Встречи</h2>
      <Link to={`/tournaments/${id}/matches/new`}>+ Создать встречу</Link>
      <ul>
        {matches?.map(m => (
          <li key={m.id}>
            <Link to={`/matches/${m.id}`}>
              {m.stage} — {m.status} — {m.score1}:{m.score2}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
