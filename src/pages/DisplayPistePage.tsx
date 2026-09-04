import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { matchesApi } from '../api/matches'
import { pistesApi } from '../api/pistes'
import MatchBoard, { RESULT_HOLD_MS, WaitingBoard } from '../components/display/MatchBoard'
import { useDisplayLink } from '../components/display/useDisplayLink'
import { MUTED, SCREEN } from '../components/display/boardStyle'

/**
 * Табло ристалища: `/display/piste/:id` (АР-17, docs/09 §6.3) — основной экран
 * зала на турнире с несколькими площадками.
 *
 * В отличие от обоих прежних табло, оно не следует ни за оператором, ни за тем,
 * что открыто у него в браузере: показывает встречу со статусом `InProgress`,
 * назначенную на **это** ристалище. Инвариант 56 гарантирует, что такая ровно
 * одна, поэтому «оператор заглянул в соседний бой — зал переключился» здесь
 * невозможно по построению (B-12), а следующий бой площадки появляется сам.
 *
 * `show` этот экран не слушает (`pinned`), но `timer` и `score` от пульта
 * принимает: они адресованы бою. Пауза по-прежнему живёт только на клиенте
 * (АР-1) и доезжает в пределах одного браузера — ристалище этого не меняет
 * (docs/09 §2).
 */
export default function DisplayPistePage() {
  const { id: pisteId } = useParams<{ id: string }>()
  const link = useDisplayLink({ pinned: true })

  // Занятость площадки меняется на старте боя — это и есть событие «покажи
  // следующий»; поллинг здесь заменяет сокет (ADR-001 в силе).
  const { data: piste, isError } = useQuery({
    queryKey: ['piste', pisteId],
    queryFn: () => pistesApi.get(pisteId!),
    enabled: !!pisteId,
    refetchInterval: 3000,
  })

  const tournamentId = piste?.tournamentId

  const { data: matches } = useQuery({
    queryKey: ['tournament-matches', tournamentId, pisteId ?? null],
    queryFn: () => matchesApi.listByTournament(tournamentId!, pisteId),
    enabled: !!tournamentId && !!pisteId,
    refetchInterval: 3000,
  })

  // Часы удержания результата. Тикают отдельно от поллинга, иначе уход в
  // экран ожидания запаздывал бы до следующего ответа сервера.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Текущий бой считает сервер (`currentMatchId`, §5.1) — он же разрешает
  // случай боута, у которого площадка своя только через серию. Список нужен
  // очереди и служит запасным источником, пока ответ по ристалищу в пути.
  const currentId =
    piste?.currentMatchId ?? matches?.find(m => m.status === 'InProgress')?.id ?? null

  // Итог завершённого боя держит на экране сам `MatchBoard` (20 с), но
  // занятость площадки снимается сразу по «Завершить» — без этого экран
  // схлопнулся бы в ожидание, не показав результат.
  //
  // Считается из данных, а не запоминается в состоянии: только тогда табло,
  // открытое или перезагруженное сразу после схода, покажет тот же результат,
  // что и соседнее. Ушедший бой из выборки по площадке пропадает сам, поэтому
  // «последний завершённый здесь» — это ровно то, что нужно.
  const justFinished = (matches ?? [])
    .filter(m => m.endedAt != null)
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))[0]
  const holdover =
    justFinished && now - new Date(justFinished.endedAt!).getTime() < RESULT_HOLD_MS
      ? justFinished.id
      : null
  const shownId = currentId ?? holdover

  if (isError) {
    return (
      <div style={SCREEN}>
        <div style={{ margin: 'auto', textAlign: 'center', padding: '0 4vw', color: MUTED, fontSize: '3vh' }}>
          Ристалище не найдено. Возможно, его удалили — откройте табло заново с карточки турнира.
        </div>
      </div>
    )
  }

  const boardPiste = piste ? { id: piste.id, name: piste.name } : undefined
  if (!shownId) return <WaitingBoard tournamentId={tournamentId} piste={boardPiste} />
  return <MatchBoard matchId={shownId} link={link} piste={boardPiste} />
}
