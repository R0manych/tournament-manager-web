import { api } from './client'
import type { Tournament, TournamentFormat, TournamentStatus, CreateTournamentRequest, UpdateTournamentRequest } from './types'

// A forced write goes through while the tournament is out of Draft and discards the
// saved group compositions the new format no longer describes (all of them on delete),
// together with the bracket placements of those phases (инвариант 45). How many were
// dropped comes back in X-Groups-Cleared / X-Placements-Cleared, not in the body —
// see B-2 and docs/08.
export interface FormatWriteResult<T> {
  data: T
  groupsCleared: number
  placementsCleared: number
}

const headerCount = (headers: Headers, name: string) => Number(headers.get(name) ?? 0)
const forceQuery = (force: boolean) => (force ? '?force=true' : '')

export const tournamentsApi = {
  list: () => api.get<Tournament[]>('/tournaments'),
  get: (id: string) => api.get<Tournament>(`/tournaments/${id}`),
  create: (data: CreateTournamentRequest) => api.post<Tournament>('/tournaments', data),
  update: (id: string, data: UpdateTournamentRequest) => api.put<Tournament>(`/tournaments/${id}`, data),
  delete: (id: string) => api.delete(`/tournaments/${id}`),
  setStatus: (id: string, status: TournamentStatus) =>
    api.patch<Tournament>(`/tournaments/${id}/status`, { status }),
  addParticipant: (id: string, participantId: string, seed?: number) =>
    api.post(`/tournaments/${id}/participants`, { participantId, seed }),
  removeParticipant: (id: string, participantId: string) =>
    api.delete(`/tournaments/${id}/participants/${participantId}`),

  format: {
    get: (id: string) => api.get<TournamentFormat>(`/tournaments/${id}/format`),
    upload: async (id: string, file: File, force = false): Promise<FormatWriteResult<TournamentFormat>> => {
      const form = new FormData()
      form.append('file', file)
      const res = await api.putFormWithMeta<TournamentFormat>(
        `/tournaments/${id}/format${forceQuery(force)}`,
        form,
      )
      return {
        data: res.data,
        groupsCleared: headerCount(res.headers, 'X-Groups-Cleared'),
        placementsCleared: headerCount(res.headers, 'X-Placements-Cleared'),
      }
    },
    downloadRaw: async (id: string, fileName: string) => {
      const res = await api.getRaw(`/tournaments/${id}/format/raw`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    },
    delete: async (id: string, force = false): Promise<FormatWriteResult<void>> => {
      const res = await api.deleteWithMeta(`/tournaments/${id}/format${forceQuery(force)}`)
      return {
        data: undefined,
        groupsCleared: headerCount(res.headers, 'X-Groups-Cleared'),
        placementsCleared: headerCount(res.headers, 'X-Placements-Cleared'),
      }
    },
  },
}
