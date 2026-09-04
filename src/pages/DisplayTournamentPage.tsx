import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { matchesApi } from '../api/matches'
import type { Match } from '../api/types'
import MatchBoard, { RESULT_HOLD_MS, WaitingBoard } from '../components/display/MatchBoard'
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
    queryFn: ({ signal }) => matchesApi.listByTournament(id!, undefined, signal),
    enabled: !!id,
    refetchInterval: 5000,
  })

  // Часы для срока удержания результата: тикают отдельно от поллинга, иначе
  // возврат к живому бою запаздывал бы до следующего ответа сервера.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const active = (matches ?? [])
    .filter(m => m.status === 'InProgress')
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0]

  // `show` мог прийти про бой другого турнира только до того, как список
  // загрузился, — сверяем принадлежность, когда есть с чем сверять.
  const shown = link.shownMatchId
  const shownMatch = (matches ?? []).find(m => m.id === shown)
  const shownBelongs = !matches || shown == null || shownMatch != null

  // Выбор оператора держится, пока бой живой, и ещё 20 секунд после итога —
  // ровно столько же, сколько сам `MatchBoard` держит результат на экране.
  // Бессрочный приоритет означал бы, что зал навсегда застревает на
  // завершённом бое: следующий, уже идущий, туда не попадёт, пока оператор не
  // вспомнит про кнопку снятия. В сериях это происходило после каждого боута.
  const shownExpired = (m: Match | undefined): boolean => {
    if (!m) return false
    if (m.status === 'Scheduled' || m.status === 'InProgress') return false
    const endedMs = m.endedAt ? new Date(m.endedAt).getTime() : null
    return endedMs == null || now - endedMs > RESULT_HOLD_MS
  }

  // Просроченный выбор не возвращается запасным вариантом: если живого боя
  // нет, зал уходит на экран ожидания со следующей парой, а не остаётся на
  // старом результате.
  const pinned = shownBelongs && !shownExpired(shownMatch) ? shown : null
  const matchId = pinned ?? active?.id

  if (!matchId) return <WaitingBoard tournamentId={id} />
  return <MatchBoard matchId={matchId} link={link} />
}
