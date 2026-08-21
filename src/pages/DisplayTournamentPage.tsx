import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { matchesApi } from '../api/matches'
import MatchBoard, { WaitingBoard } from '../components/display/MatchBoard'
import { useDisplayLink } from '../components/display/useDisplayLink'

/**
 * Табло турнира: `/display/tournament/:id`. В отличие от `/display/match/:id`,
 * **следует за организатором** — переключается по `show` от пультов **этого**
 * турнира (чужой турнир в общем канале браузера отсекается по `tournamentId`).
 *
 * Пока `show` не приходил, показывает бой, начатый последним. Если ристалищ
 * несколько, одно такое табло за всеми не уследит — на каждое ристалище нужно
 * своё табло по ссылке «🖵 Табло» с карточки боя (B-9).
 */
export default function DisplayTournamentPage() {
  const { id } = useParams<{ id: string }>()
  const link = useDisplayLink({ tournamentId: id })

  const { data: matches } = useQuery({
    queryKey: ['tournament-matches', id],
    queryFn: () => matchesApi.listByTournament(id!),
    enabled: !!id,
    refetchInterval: 5000,
  })

  const active = (matches ?? [])
    .filter(m => m.status === 'InProgress')
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0]

  // `show` мог прийти про бой другого турнира только до того, как список
  // загрузился, — сверяем принадлежность, когда есть с чем сверять.
  const shown = link.shownMatchId
  const shownBelongs = !matches || matches.some(m => m.id === shown)
  const matchId = (shownBelongs ? shown : null) ?? active?.id

  if (!matchId) return <WaitingBoard tournamentId={id} />
  return <MatchBoard matchId={matchId} link={link} />
}
