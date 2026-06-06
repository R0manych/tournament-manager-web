import { api } from './client'
import type { Tournament, TournamentFormat, TournamentStatus, CreateTournamentRequest, UpdateTournamentRequest } from './types'

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
    upload: (id: string, file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.putForm<TournamentFormat>(`/tournaments/${id}/format`, form)
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
    delete: (id: string) => api.delete(`/tournaments/${id}/format`),
  },
}
