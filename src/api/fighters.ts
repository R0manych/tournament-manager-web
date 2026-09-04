import { api } from './client'
import type { Fighter, CreateFighterRequest, UpdateFighterRequest } from './types'

export const fightersApi = {
  list: () => api.get<Fighter[]>('/fighters'),
  get: (id: string) => api.get<Fighter>(`/fighters/${id}`),
  create: (data: CreateFighterRequest) => api.post<Fighter>('/fighters', data),
  // 204 No Content — тела нет.
  update: (id: string, data: UpdateFighterRequest) => api.put<void>(`/fighters/${id}`, data),
  delete: (id: string) => api.delete(`/fighters/${id}`),
}
