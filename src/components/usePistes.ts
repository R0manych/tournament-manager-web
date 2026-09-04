import { useQuery } from '@tanstack/react-query'
import { pistesApi } from '../api/pistes'

/**
 * Список ристалищ турнира. Отдельный ключ (`['pistes', id]`) — занятость
 * площадок (`currentMatchId`) меняется на каждом старте боя, и подмешивать её
 * в кэш встреч не за чем.
 *
 * Пустой список — штатный турнир на одной площадке (docs/09 §3.3): весь UI
 * ристалищ обязан в этом случае просто не рисоваться.
 */
export function usePistes(tournamentId: string | undefined) {
  return useQuery({
    queryKey: ['pistes', tournamentId],
    queryFn: () => pistesApi.listByTournament(tournamentId!),
    enabled: !!tournamentId,
  })
}
