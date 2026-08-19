import { api } from './client'

// Persisted group composition of a round-robin phase. participantIds is ordered
// (seed order within the group) and holds Fighter.Id or Team.Id depending on
// the tournament's participantKind.
export interface TournamentGroup {
  phaseId: string
  label: string
  participantIds: string[]
  updatedAt: string
}

export interface SaveGroupItem {
  label: string
  participantIds: string[]
}

export const groupsApi = {
  // Read-only summary across all phases.
  list: (tournamentId: string) =>
    api.get<TournamentGroup[]>(`/tournaments/${tournamentId}/groups`),
  // The per-phase collection: what `save` replaces, same URI.
  listByPhase: (tournamentId: string, phaseId: string) =>
    api.get<TournamentGroup[]>(`/tournaments/${tournamentId}/phases/${phaseId}/groups`),
  // Replaces the saved composition of one phase's groups.
  save: (tournamentId: string, phaseId: string, groups: SaveGroupItem[]) =>
    api.put<TournamentGroup[]>(`/tournaments/${tournamentId}/phases/${phaseId}/groups`, { groups }),
}
