import { api } from './client'
import type { Team, CreateTeamRequest, AddTeamMemberRequest } from './types'

export const teamsApi = {
  listByTournament: (tournamentId: string) =>
    api.get<Team[]>(`/tournaments/${tournamentId}/teams`),
  get: (teamId: string) => api.get<Team>(`/teams/${teamId}`),
  create: (tournamentId: string, data: CreateTeamRequest) =>
    api.post<Team>(`/tournaments/${tournamentId}/teams`, data),
  update: (teamId: string, data: CreateTeamRequest) =>
    api.put<Team>(`/teams/${teamId}`, data),
  delete: (teamId: string) => api.delete(`/teams/${teamId}`),

  addMember: (teamId: string, data: AddTeamMemberRequest) =>
    api.post<Team>(`/teams/${teamId}/members`, data),
  removeMember: (teamId: string, fighterId: string) =>
    api.delete(`/teams/${teamId}/members/${fighterId}`),
}
