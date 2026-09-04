import { api } from './client'
import type { CreatePisteRequest, Piste, UpdatePisteRequest } from './types'

// Ристалище живёт внутри турнира (АР-17, docs/09 §3.1): глобального справочника
// площадок нет, поэтому список читается только от турнира, а правится по id.
export const pistesApi = {
  listByTournament: (tournamentId: string, signal?: AbortSignal) =>
    api.get<Piste[]>(`/tournaments/${tournamentId}/pistes`, signal),
  // Табло ристалища знает только свой id — турнир площадки берётся отсюда.
  get: (id: string, signal?: AbortSignal) => api.get<Piste>(`/pistes/${id}`, signal),
  create: (tournamentId: string, data: CreatePisteRequest) =>
    api.post<Piste>(`/tournaments/${tournamentId}/pistes`, data),
  update: (id: string, data: UpdatePisteRequest) => api.put<Piste>(`/pistes/${id}`, data),
  // 409, если на ристалище есть встречи в Scheduled/InProgress (инвариант 57).
  delete: (id: string) => api.delete(`/pistes/${id}`),
}
