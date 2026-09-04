import { api } from './client'
import type {
  AddExchangeRequest,
  AssignPisteRequest,
  CreateMatchRequest,
  Match,
  MatchStatus,
} from './types'

export interface GenerateRoundRobinResponse {
  created: number
  skipped: number
  matches: Match[]
}

export const matchesApi = {
  // `pisteId` фильтрует по эффективному ристалищу (docs/09 §5.4): боут приходит
  // в выборку своей серии. Нужен табло ристалища и очереди по площадке — без
  // него оба тянули бы все встречи турнира и фильтровали на клиенте.
  listByTournament: (tournamentId: string, pisteId?: string, signal?: AbortSignal) =>
    api.get<Match[]>(
      `/tournaments/${tournamentId}/matches${pisteId ? `?pisteId=${pisteId}` : ''}`,
      signal,
    ),
  get: (id: string, signal?: AbortSignal) => api.get<Match>(`/matches/${id}`, signal),
  create: (tournamentId: string, data: CreateMatchRequest) =>
    api.post<Match>(`/tournaments/${tournamentId}/matches`, data),
  delete: (id: string) => api.delete(`/matches/${id}`),
  // groups omitted → the server generates from the saved group composition.
  generateRoundRobin: (tournamentId: string, phaseId: string, groups?: string[][]) =>
    api.post<GenerateRoundRobinResponse>(
      `/tournaments/${tournamentId}/matches/generate-round-robin`,
      { phaseId, groups }
    ),

  // Ристалище правится и у идущего боя: перевести бой на другую площадку —
  // законная операция, ограничение «только при Scheduled» на `pisteId` не
  // распространяется (docs/09 §5.2). Границы задаёт инвариант 55.
  //
  // Настройки приходится слать целиком: `PATCH /matches/{id}` заменяет весь их
  // блок, а «трогает ли запрос настройки» сервер определяет сравнением с
  // текущими значениями (спека §8.1, п. 5). Послать один `pisteId` значило бы
  // обнулить `scheduledAt` и оверрайды боя — а у идущего боя ещё и получить 409.
  // Отвечает 204, поэтому вызывающий обновляет кэш инвалидацией.
  assignPiste: (match: Match, pisteId: string | null) =>
    api.patch<void>(`/matches/${match.id}`, {
      scheduledAt: match.scheduledAt ?? null,
      roundDurationSeconds: match.roundDurationSeconds ?? null,
      maxDoubles: match.maxDoubles ?? null,
      maxWarnings: match.maxWarnings ?? null,
      pisteId,
    } satisfies AssignPisteRequest),

  setStatus: (id: string, status: MatchStatus) =>
    api.patch<Match>(`/matches/${id}/status`, { status }),
  updateWarnings: (id: string, fighter1Delta?: number, fighter2Delta?: number) =>
    api.patch<Match>(`/matches/${id}/warnings`, { fighter1Delta, fighter2Delta }),
  updateVideoReplays: (id: string, fighter1Delta?: number, fighter2Delta?: number) =>
    api.patch<Match>(`/matches/${id}/video-replays`, { fighter1Delta, fighter2Delta }),
  advanceRound: (id: string) => api.post<Match>(`/matches/${id}/advance-round`),

  addExchange: (matchId: string, data: AddExchangeRequest) =>
    api.post<Match>(`/matches/${matchId}/exchanges`, data),
  updateExchange: (exchangeId: string, data: AddExchangeRequest) =>
    api.put<Match>(`/exchanges/${exchangeId}`, data),
  // Отвечает встречей с уже пересчитанным счётом (инвариант 1), а не 204.
  deleteExchange: (exchangeId: string) => api.delete<Match>(`/exchanges/${exchangeId}`),
}
