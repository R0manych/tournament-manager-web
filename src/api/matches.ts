import { api } from './client'
import type { Match, MatchStatus, CreateMatchRequest, AddExchangeRequest } from './types'

export interface GenerateRoundRobinResponse {
  created: number
  skipped: number
  matches: Match[]
}

export const matchesApi = {
  listByTournament: (tournamentId: string) =>
    api.get<Match[]>(`/tournaments/${tournamentId}/matches`),
  get: (id: string) => api.get<Match>(`/matches/${id}`),
  create: (tournamentId: string, data: CreateMatchRequest) =>
    api.post<Match>(`/tournaments/${tournamentId}/matches`, data),
  delete: (id: string) => api.delete(`/matches/${id}`),
  // groups omitted → the server generates from the saved group composition.
  generateRoundRobin: (tournamentId: string, phaseId: string, groups?: string[][]) =>
    api.post<GenerateRoundRobinResponse>(
      `/tournaments/${tournamentId}/matches/generate-round-robin`,
      { phaseId, groups }
    ),

  setStatus: (id: string, status: MatchStatus) =>
    api.patch<Match>(`/matches/${id}/status`, { status }),
  updateWarnings: (id: string, fighter1Delta?: number, fighter2Delta?: number) =>
    api.patch<Match>(`/matches/${id}/warnings`, { fighter1Delta, fighter2Delta }),
  advanceRound: (id: string) => api.post<Match>(`/matches/${id}/advance-round`),

  addExchange: (matchId: string, data: AddExchangeRequest) =>
    api.post<Match>(`/matches/${matchId}/exchanges`, data),
  updateExchange: (exchangeId: string, data: AddExchangeRequest) =>
    api.put<Match>(`/exchanges/${exchangeId}`, data),
  deleteExchange: (exchangeId: string) => api.delete(`/exchanges/${exchangeId}`),
}
