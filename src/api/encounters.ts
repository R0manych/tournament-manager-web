import { api } from './client'
import type {
  AssignPisteRequest,
  CreateEncounterRequest,
  CreateTieBreakRequest,
  Encounter,
  MatchStatus,
} from './types'

export const encountersApi = {
  listByTournament: (tournamentId: string) =>
    api.get<Encounter[]>(`/tournaments/${tournamentId}/encounters`),
  get: (id: string) => api.get<Encounter>(`/encounters/${id}`),
  create: (tournamentId: string, data: CreateEncounterRequest) =>
    api.post<Encounter>(`/tournaments/${tournamentId}/encounters`, data),
  delete: (id: string) => api.delete(`/encounters/${id}`),

  // Idempotent — creates 9 bouts by the FIE 3v3 schedule.
  generateBouts: (id: string) => api.post<Encounter>(`/encounters/${id}/generate-bouts`),

  // Серия назначается на ристалище целиком — боуты наследуют (docs/09 §3.2),
  // назначить площадку отдельному боуту нельзя (инвариант 54). Отвечает 204.
  assignPiste: (id: string, pisteId: string | null) =>
    api.patch<void>(`/encounters/${id}`, { pisteId } satisfies AssignPisteRequest),

  setStatus: (id: string, status: MatchStatus) =>
    api.patch<Encounter>(`/encounters/${id}/status`, { status }),

  // Creates the 10th (tie-break) bout; server randomly sets priorityParticipantId.
  createTieBreak: (id: string, data: CreateTieBreakRequest) =>
    api.post<Encounter>(`/encounters/${id}/tiebreak`, data),
}
