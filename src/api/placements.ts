import { api } from './client'
import type { MatchPlacement } from './types'

export type { MatchPlacement, MatchPlacementRef } from './types'

// Размещения встреч в ячейках сетки (B-5, docs/08).
//
// Записи создаются только вместе со встречей — полем `placement` в
// `POST /tournaments/{id}/matches`, в одной транзакции с ней. Отдельного
// write-эндпоинта нет сознательно (ОВ-5), поэтому здесь только чтение и
// точечное освобождение ячейки.
export const placementsApi = {
  list: (tournamentId: string) =>
    api.get<MatchPlacement[]>(`/tournaments/${tournamentId}/placements`),

  // Убрать встречу из сетки, не удаляя её. Отмена встречи (`Cancelled`)
  // освобождает ячейку сама (инвариант 44) — это путь для ремонта: бой нужно
  // оставить живым, но из сетки убрать.
  release: (tournamentId: string, phaseId: string, roundId: string, slotIndex: number) =>
    api.delete(
      `/tournaments/${tournamentId}/placements/` +
      `${encodeURIComponent(phaseId)}/${encodeURIComponent(roundId)}/${slotIndex}`,
    ),
}
