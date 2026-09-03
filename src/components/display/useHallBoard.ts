import { useCallback, useSyncExternalStore } from 'react'
import { postDisplay } from '../../lib/displayChannel'
import {
  clearDisplayShow,
  readDisplayShow,
  subscribeDisplayShow,
  writeDisplayShow,
} from '../../lib/displayShow'

/**
 * Бой, выведенный оператором на табло зала (`/display/tournament/:id`).
 *
 * Внешнее хранилище, а не состояние компонента: решение переживает F5 и общее
 * для вкладок одного браузера, а меняют его и эта вкладка, и соседняя. Отсюда
 * `useSyncExternalStore` — иначе пришлось бы держать копию в state и чинить её
 * из эффекта на каждое событие.
 */
export function useHallBoardMatchId(tournamentId: string | undefined): string | null {
  const subscribe = useCallback(
    (onChange: () => void) =>
      tournamentId ? subscribeDisplayShow(tournamentId, onChange) : () => {},
    [tournamentId]
  )
  const snapshot = useCallback(
    () => (tournamentId ? readDisplayShow(tournamentId) : null),
    [tournamentId]
  )
  return useSyncExternalStore(subscribe, snapshot)
}

/**
 * Вывести бой на табло зала или снять (`matchId === null`).
 *
 * Пишет решение в хранилище — для табло, которое откроется или перезагрузится
 * позже, — и сразу шлёт `show` тем, что уже открыты. Автопубликации при
 * открытии карточки боя нет: зал переключается по этому действию и только по
 * нему (B-12, docs/09 §7).
 */
export function setHallBoardMatch(
  tournamentId: string,
  matchId: string | null,
  channel: BroadcastChannel | null
): void {
  if (matchId) writeDisplayShow(tournamentId, matchId)
  else clearDisplayShow(tournamentId)
  postDisplay(channel, { type: 'show', matchId, tournamentId })
}
