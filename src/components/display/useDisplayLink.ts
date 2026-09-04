import { useEffect, useRef, useState } from 'react'
import type { BoardTimer } from '../../lib/displayChannel'
import { openDisplayChannel, parseDisplayMessage, postDisplay } from '../../lib/displayChannel'
import { displayShowKey, parseDisplayShow, readDisplayShow } from '../../lib/displayShow'

/** Пульт молчит дольше этого — состояние таймера считаем протухшим. */
const SILENCE_MS = 3000

export interface DisplayLinkOptions {
  /**
   * Табло открыто на конкретный бой (`/display/match/:id`) — оно **не следует**
   * за `show`. Иначе на турнире с несколькими ристалищами пульт соседнего
   * ристалища перекидывал бы это табло на свой бой: канал-то один на браузер.
   */
  pinned?: boolean
  /** Табло турнира: `show` принимается только от пультов этого турнира. */
  tournamentId?: string
}

export interface PushedScore {
  score1: number
  score2: number
  doubleHitsCount: number
  /** `Date.now()` приёма — сравнивается с `dataUpdatedAt` запроса. */
  atMs: number
}

export interface DisplayLink {
  /**
   * Бой, который оператор явно вывел на табло зала. `null` — не выводил или
   * снял; тогда табло падает на бой, начатый последним.
   */
  shownMatchId: string | null
  timer: BoardTimer | null
  timerMatchId: string | null
  /** Есть ли живое состояние таймера **для этого** боя. */
  hasTimerFor: (matchId: string) => boolean
  /** Счёт, присланный пультом раньше поллинга. `null` — про другой бой или не было. */
  scoreFor: (matchId: string) => PushedScore | null
}

/**
 * Сторона табло в канале `zettel-display` (АР-14): при открытии и после F5
 * шлёт `hello`, дальше слушает `show` и `timer`. Ничего не мутирует.
 *
 * Адресация обязательна: канал один на весь браузер, а боёв и турниров может
 * идти несколько параллельно. `timer` адресован `matchId`, `show` — турниру,
 * и его слушает только табло, открытое без конкретного боя.
 */
export function useDisplayLink(options: DisplayLinkOptions = {}): DisplayLink {
  const { pinned = false, tournamentId } = options

  // Выбор оператора читается из хранилища сразу, а не ждёт `show`: табло могли
  // открыть или перезагрузить уже после нажатия кнопки, и тогда по каналу
  // ничего не придёт — вещать `show` при открытии карточки боя больше некому
  // (B-12). Закреплённое табло за выбором не следует по определению.
  const [shownMatchId, setShownMatchId] = useState<string | null>(() =>
    !pinned && tournamentId ? readDisplayShow(tournamentId) : null
  )
  const [timer, setTimer] = useState<BoardTimer | null>(null)
  const [timerMatchId, setTimerMatchId] = useState<string | null>(null)
  const [timerSeenMs, setTimerSeenMs] = useState(0)
  const [score, setScore] = useState<(PushedScore & { matchId: string }) | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const optionsRef = useRef({ pinned, tournamentId })
  optionsRef.current = { pinned, tournamentId }

  useEffect(() => {
    const channel = openDisplayChannel()
    if (!channel) return

    const onMessage = (e: MessageEvent) => {
      const msg = parseDisplayMessage(e.data)
      if (!msg || msg.type === 'hello') return

      if (msg.type === 'show') {
        const { pinned: isPinned, tournamentId: myTournament } = optionsRef.current
        if (isPinned) return
        if (myTournament && msg.tournamentId !== myTournament) return
        setShownMatchId(msg.matchId)
        return
      }

      if (msg.type === 'score') {
        setScore({
          matchId: msg.matchId,
          score1: msg.score1,
          score2: msg.score2,
          doubleHitsCount: msg.doubleHitsCount,
          atMs: Date.now(),
        })
        return
      }

      // `timer` адресован бою: применит его только то табло, которое этот бой
      // и показывает, поэтому фильтровать по турниру здесь незачем.
      setTimer(msg.timer)
      setTimerMatchId(msg.matchId)
      setTimerSeenMs(Date.now())
    }

    channel.addEventListener('message', onMessage)
    postDisplay(channel, { type: 'hello' })

    return () => {
      channel.removeEventListener('message', onMessage)
      channel.close()
    }
  }, [])

  // Та же запись, изменённая другой вкладкой: `storage` приходит только в
  // чужие вкладки, поэтому дублирования с сообщением `show` здесь нет — есть
  // страховка на случай, когда канал недоступен (BroadcastChannel выключен).
  useEffect(() => {
    if (pinned || !tournamentId) return
    const onStorage = (e: StorageEvent) => {
      if (e.key !== displayShowKey(tournamentId)) return
      setShownMatchId(parseDisplayShow(e.newValue))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [pinned, tournamentId])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Пока таймер идёт, пульт молчит — и это нормально: `running` живёт до
  // `deadlineMs`, `paused` не протухает вовсе. Протухшим считаем только то, что
  // должно было закончиться, а продолжения не пришло.
  const stillValid =
    timer?.state === 'paused' ||
    (timer?.state === 'running' && timer.deadlineMs > now - SILENCE_MS) ||
    now - timerSeenMs < SILENCE_MS

  return {
    shownMatchId,
    timer,
    timerMatchId,
    hasTimerFor: (matchId: string) => timerSeenMs > 0 && timerMatchId === matchId && stillValid,
    scoreFor: (matchId: string) => (score && score.matchId === matchId ? score : null),
  }
}
