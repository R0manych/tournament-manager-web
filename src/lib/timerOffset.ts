// Клиентский сдвиг таймера (пауза и уже накопленные паузы), переживающий F5 и
// видимый другим вкладкам того же браузера.
//
// Зачем: сервер штампует `currentRoundStartedAt` в момент запроса, а отсчёт в
// живой вкладке начинается позже — по «Продолжить» (двухфазный старт, 04 §3).
// Этот зазор плюс каждое «Стоп» живут только на клиенте, поэтому вкладка,
// считающая строго по ТЗ §7.4, уходила вперёд на несколько секунд. Состояние
// паузы по-прежнему НЕ едет на сервер (АР-1) — это кэш браузера, ровно в том же
// скоупе «один браузер», что и табло из АР-14.
//
// Ключ привязан к встрече, запись — к якорю раунда: после `advance-round` или
// «Вернуть в бой» якорь другой, и старая запись не применяется.

const KEY_PREFIX = 'zettel-timer:'

/** Запись старше этого срока считается мусором от прошлых турниров. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000

export interface TimerOffset {
  /** Якорь раунда (`currentRoundStartedAt`), к которому относится сдвиг. */
  anchorMs: number
  /** Накопленные секунды пауз, БЕЗ текущей незавершённой. */
  pauseAccSec: number
  paused: boolean
  /** `Date.now()` начала текущей паузы; `null`, когда таймер идёт. */
  pauseStartedMs: number | null
}

export function timerOffsetKey(matchId: string): string {
  return `${KEY_PREFIX}${matchId}`
}

/** Разбор записи. `null`, если её нет, она от другого якоря или протухла. */
export function parseTimerOffset(raw: string | null, anchorMs: number): TimerOffset | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as TimerOffset & { updatedMs?: number }
    if (o.anchorMs !== anchorMs) return null
    if (o.updatedMs != null && Date.now() - o.updatedMs > MAX_AGE_MS) return null
    if (typeof o.pauseAccSec !== 'number' || typeof o.paused !== 'boolean') return null
    return {
      anchorMs: o.anchorMs,
      pauseAccSec: o.pauseAccSec,
      paused: o.paused,
      pauseStartedMs: o.pauseStartedMs ?? null,
    }
  } catch {
    return null
  }
}

export function readTimerOffset(matchId: string, anchorMs: number): TimerOffset | null {
  try {
    return parseTimerOffset(localStorage.getItem(timerOffsetKey(matchId)), anchorMs)
  } catch {
    // Приватный режим / отключённое хранилище: таймер обязан работать и без него.
    return null
  }
}

export function writeTimerOffset(matchId: string, offset: TimerOffset): void {
  try {
    localStorage.setItem(
      timerOffsetKey(matchId),
      JSON.stringify({ ...offset, updatedMs: Date.now() })
    )
  } catch {
    /* см. readTimerOffset */
  }
}

export function clearTimerOffset(matchId: string): void {
  try {
    localStorage.removeItem(timerOffsetKey(matchId))
  } catch {
    /* см. readTimerOffset */
  }
}
