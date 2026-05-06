import { api } from './client'
import type { Fighter, CreateFighterRequest, UpdateFighterRequest } from './types'

export const fightersApi = {
  list: () => api.get<Fighter[]>('/fighters'),
  get: (id: string) => api.get<Fighter>(`/fighters/${id}`),
  create: (data: CreateFighterRequest) => api.post<Fighter>('/fighters', data),
  update: (id: string, data: UpdateFighterRequest) => api.put<Fighter>(`/fighters/${id}`, data),
  delete: (id: string) => api.delete(`/fighters/${id}`),
}
