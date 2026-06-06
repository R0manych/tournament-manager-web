import { api } from './client'
import type { Encounter, MatchStatus, CreateEncounterRequest, CreateTieBreakRequest } from './types'

export const encountersApi = {
  listByTournament: (tournamentId: string) =>
    api.get<Encounter[]>(`/tournaments/${tournamentId}/encounters`),
  get: (id: string) => api.get<Encounter>(`/encounters/${id}`),
  create: (tournamentId: string, data: CreateEncounterRequest) =>
    api.post<Encounter>(`/tournaments/${tournamentId}/encounters`, data),
  delete: (id: string) => api.delete(`/encounters/${id}`),

  // Idempotent — creates 9 bouts by the FIE 3v3 schedule.
  generateBouts: (id: string) => api.post<Encounter>(`/encounters/${id}/generate-bouts`),

  setStatus: (id: string, status: MatchStatus) =>
    api.patch<Encounter>(`/encounters/${id}/status`, { status }),

  // Creates the 10th (tie-break) bout; server randomly sets priorityParticipantId.
  createTieBreak: (id: string, data: CreateTieBreakRequest) =>
    api.post<Encounter>(`/encounters/${id}/tiebreak`, data),
}
