import { api } from './client'
import type { Tournament, TournamentFormat, CreateTournamentRequest, UpdateTournamentRequest } from './types'

export const tournamentsApi = {
  list: () => api.get<Tournament[]>('/tournaments'),
  get: (id: string) => api.get<Tournament>(`/tournaments/${id}`),
  create: (data: CreateTournamentRequest) => api.post<Tournament>('/tournaments', data),
  update: (id: string, data: UpdateTournamentRequest) => api.put<Tournament>(`/tournaments/${id}`, data),
  delete: (id: string) => api.delete(`/tournaments/${id}`),
  addParticipant: (id: string, fighterId: string, seed?: number) =>
    api.post(`/tournaments/${id}/participants`, { fighterId, seed }),
  removeParticipant: (id: string, fighterId: string) =>
    api.delete(`/tournaments/${id}/participants/${fighterId}`),

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
