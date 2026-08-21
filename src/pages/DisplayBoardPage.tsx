// Табло турнира, кроме экрана боя: заставка, участники, группы, сетка.
// Данные грузятся здесь одним набором запросов на все четыре экрана — при
// переключении клавишами кэш TanStack Query уже прогрет, и зал не видит
// «Загрузка…» на каждом шаге.
//
// Экран боя (`/display/tournament/:id`) живёт отдельно — у него свой канал с
// пультом и свой поллинг; см. DisplayTournamentPage.

import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { encountersApi } from '../api/encounters'
import { groupsApi } from '../api/groups'
import { matchesApi } from '../api/matches'
import { tournamentsApi } from '../api/tournaments'
import { encountersToStandingsMatches, placementsOf } from '../components/bracket/bracketUtils'
import { BoardHeader, BoardNavHint, BoardNotice, BoardScreen } from '../components/display/BoardFrame'
import type { BoardView } from '../components/display/boardViews'
import { useBoardNav } from '../components/display/useBoardNav'
import BracketBoard from '../components/display/BracketBoard'
import GroupsBoard from '../components/display/GroupsBoard'
import InfoBoard from '../components/display/InfoBoard'
import ParticipantsBoard from '../components/display/ParticipantsBoard'

const SECTION: Record<Exclude<BoardView, 'match'>, string> = {
  info: 'Турнир',
  list: 'Участники',
  groups: 'Группы',
  bracket: 'Плейофф',
}

export default function DisplayBoardPage({ view }: { view: Exclude<BoardView, 'match'> }) {
  const { id } = useParams<{ id: string }>()
  useBoardNav(id, view)

  const { data: tournament, isLoading, isError } = useQuery({
    queryKey: ['tournaments', id],
    queryFn: () => tournamentsApi.get(id!),
    enabled: !!id,
    refetchInterval: 30_000,
  })

  const isTeam = tournament?.participantKind === 'Team'
  const needsBracketData = view === 'groups' || view === 'bracket'

  const { data: format } = useQuery({
    queryKey: ['tournament-format', id],
    queryFn: () => tournamentsApi.format.get(id!),
    enabled: !!id && needsBracketData,
    // 404 — законный ответ «формат не загружен», повторять нечего.
    retry: (failureCount, error: unknown) =>
      (error as { status?: number })?.status !== 404 && failureCount < 2,
  })

  const { data: matches } = useQuery({
    queryKey: ['tournament-matches', id],
    queryFn: () => matchesApi.listByTournament(id!),
    enabled: !!id && needsBracketData,
    refetchInterval: 10_000,
  })

  const { data: encounters } = useQuery({
    queryKey: ['encounters', id],
    queryFn: () => encountersApi.listByTournament(id!),
    enabled: !!id && needsBracketData && isTeam,
    refetchInterval: 10_000,
  })

  const { data: savedGroups } = useQuery({
    queryKey: ['tournament-groups', id],
    queryFn: () => groupsApi.list(id!),
    enabled: !!id && needsBracketData,
  })

  if (!id) return null
  if (isLoading) return <BoardScreen><BoardNotice text="Загрузка…" /></BoardScreen>
  if (isError || !tournament) return <BoardScreen><BoardNotice text="Турнир не найден" /></BoardScreen>

  // Командный групповой этап считается по сериям, одиночный — по встречам
  // (04 §2). Один и тот же `StandingsMatch` обслуживает оба случая.
  const standingsSource = isTeam ? encountersToStandingsMatches(encounters ?? []) : matches
  const placements = placementsOf(matches)

  return (
    <BoardScreen>
      {/* Заставка сама себе шапка: на ней название турнира и есть содержимое. */}
      {view !== 'info' && <BoardHeader tournament={tournament} section={SECTION[view]} />}

      {view === 'info' && <InfoBoard tournament={tournament} />}
      {view === 'list' && <ParticipantsBoard tournament={tournament} />}
      {view === 'groups' && (
        <GroupsBoard
          format={format}
          participants={tournament.participants}
          standingsSource={standingsSource}
          placements={placements}
          savedGroups={savedGroups}
        />
      )}
      {view === 'bracket' && (
        <BracketBoard
          format={format}
          participants={tournament.participants}
          allMatches={matches}
          standingsSource={standingsSource}
          placements={placements}
          savedGroups={savedGroups}
        />
      )}

      <BoardNavHint tournamentId={id} current={view} />
    </BoardScreen>
  )
}
