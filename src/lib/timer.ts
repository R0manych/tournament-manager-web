// Расчёт остатка времени раунда. Вынесен из компонента намеренно: экран табло
// (B-9) обязан считать этим же кодом, иначе пульт и табло разойдутся на
// округлениях. Функция чистая — рендера и React-состояния не касается.

export interface RemainingSecondsArgs {
  /** Якорь отсчёта — начало ТЕКУЩЕГО раунда (`currentRoundStartedAt`), в мс. */
  anchorMs: number
  /** Момент, на который считаем остаток (обычно `Date.now()`). */
  nowMs: number
  /** Длительность раунда. Не задана — считаем время вверх, от нуля. */
  totalSeconds?: number
  /** Накопленные секунды клиентских пауз (АР-1, на сервере не живут). */
  pauseAccSec?: number
}

/**
 * ТЗ §7.4: `remaining = max(0, effectiveRoundDurationSeconds − (now − currentRoundStartedAt))`,
 * с поправкой на клиентскую паузу. Без `totalSeconds` — прямой отсчёт.
 */
export function remainingSeconds({
  anchorMs,
  nowMs,
  totalSeconds,
  pauseAccSec = 0,
}: RemainingSecondsArgs): number {
  const elapsed = (nowMs - anchorMs) / 1000 - pauseAccSec
  return totalSeconds != null ? Math.max(0, totalSeconds - elapsed) : Math.max(0, elapsed)
}

/** `m:ss` из секунд, округление вниз — для прямого отсчёта (секундомер). */
export function formatClock(seconds: number): string {
  return clock(Math.max(0, Math.floor(seconds)))
}

/**
 * `m:ss` для обратного отсчёта: округление **вверх**.
 *
 * Полное время должно показываться полным: в момент старта остаток уже 89.98 с
 * (миллисекунды на запрос и рендер), и округление вниз давало бы «1:29» вместо
 * «1:30». При округлении вверх каждое значение висит ровно свою секунду, а
 * «0:00» появляется в настоящий ноль, а не за секунду до него.
 */
export function formatCountdown(seconds: number): string {
  return clock(Math.max(0, Math.ceil(seconds)))
}

function clock(total: number): string {
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}
