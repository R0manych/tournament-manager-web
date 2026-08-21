// Канал «пульт → табло» (АР-14, ТЗ §11). Вкладка организатора вещает, вкладка
// табло слушает. Сокетов нет и не нужно: синхронизировать надо не время раз в
// секунду, а редкие события — старт, пауза, возобновление, завершение, смена
// текущего боя. Счёт и статус табло берёт из API поллингом.
//
// Передаётся НОРМАЛИЗОВАННОЕ состояние таймера: момент нуля (`deadlineMs`) или
// замороженный остаток. Тик не передаётся — обе вкладки тикают локально от
// абсолютной метки, поэтому тротлинг фоновой вкладки на них не влияет.

import { remainingSeconds } from './timer'

export const DISPLAY_CHANNEL_NAME = 'zettel-display'

/** Версия схемы сообщений. Не совпала — сообщение игнорируется. */
export const DISPLAY_PROTOCOL_VERSION = 1

export type BoardTimer =
  /** Идёт: `deadlineMs` — момент по `Date.now()`, когда остаток дойдёт до нуля. */
  | { state: 'running'; deadlineMs: number }
  /** Пауза: остаток заморожен на этом значении. */
  | { state: 'paused'; remainingSec: number }
  /** Бой не идёт, либо длительность не задана — табло считает само. */
  | { state: 'idle' }

export type DisplayPayload =
  /** Табло открылось или перезагрузилось — просит текущее состояние. */
  | { type: 'hello' }
  /**
   * «Организатор смотрит этот бой». Канал общий на весь браузер, поэтому у
   * сообщения есть адрес: `tournamentId` отсекает чужой турнир, а табло,
   * открытое на конкретный бой, `show` не слушает вовсе (см. B-9).
   */
  | { type: 'show'; matchId: string; tournamentId: string }
  | { type: 'timer'; matchId: string; timer: BoardTimer }
  /**
   * Счёт сразу после схода. Сервер возвращает пересчитанную встречу в ответе на
   * мутацию, поэтому пульт знает итог раньше, чем табло дождётся поллинга.
   * Это ускорение, а не источник истины: снимок применяется, только если он
   * свежее последнего ответа API, а поллинг остаётся страховкой.
   */
  | { type: 'score'; matchId: string; score1: number; score2: number; doubleHitsCount: number }

export type DisplayMessage = DisplayPayload & { v: number }

/** `null`, если BroadcastChannel недоступен — табло тогда живёт на фолбэке. */
export function openDisplayChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(DISPLAY_CHANNEL_NAME)
  } catch {
    return null
  }
}

export function postDisplay(channel: BroadcastChannel | null, payload: DisplayPayload): void {
  channel?.postMessage({ ...payload, v: DISPLAY_PROTOCOL_VERSION })
}

export function parseDisplayMessage(data: unknown): DisplayPayload | null {
  const msg = data as Partial<DisplayMessage> | null
  if (!msg || msg.v !== DISPLAY_PROTOCOL_VERSION) return null
  if (msg.type === 'hello') return { type: 'hello' }
  if (msg.type === 'show' && typeof msg.matchId === 'string' && typeof msg.tournamentId === 'string') {
    return { type: 'show', matchId: msg.matchId, tournamentId: msg.tournamentId }
  }
  if (msg.type === 'timer' && typeof msg.matchId === 'string' && msg.timer) {
    return { type: 'timer', matchId: msg.matchId, timer: msg.timer }
  }
  if (msg.type === 'score' && typeof msg.matchId === 'string' && typeof msg.score1 === 'number') {
    return {
      type: 'score',
      matchId: msg.matchId,
      score1: msg.score1,
      score2: msg.score2 ?? 0,
      doubleHitsCount: msg.doubleHitsCount ?? 0,
    }
  }
  return null
}

/**
 * Состояние таймера пульта в терминах табло. Считает через `remainingSeconds`,
 * а не своей арифметикой: два экрана обязаны округлять одинаково (04 §3).
 */
export function boardTimerOf(args: {
  anchorMs: number | null
  totalSeconds?: number
  paused: boolean
  pauseAccSec: number
  /** `Date.now()` начала текущей паузы — момент, на который заморожен остаток. */
  pauseStartedMs: number | null
}): BoardTimer {
  const { anchorMs, totalSeconds, paused, pauseAccSec, pauseStartedMs } = args
  // Без длительности обратного отсчёта нет: табло посчитает прямой само,
  // взяв сдвиг из localStorage.
  if (anchorMs == null || totalSeconds == null) return { state: 'idle' }

  if (paused) {
    // `pauseAcc` ещё не включает текущую паузу, поэтому остаток берём на её начало.
    const nowMs = pauseStartedMs ?? Date.now()
    return {
      state: 'paused',
      remainingSec: remainingSeconds({ anchorMs, nowMs, totalSeconds, pauseAccSec }),
    }
  }

  const nowMs = Date.now()
  const left = remainingSeconds({ anchorMs, nowMs, totalSeconds, pauseAccSec })
  return { state: 'running', deadlineMs: nowMs + left * 1000 }
}
