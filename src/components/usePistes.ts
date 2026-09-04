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
    queryFn: ({ signal }) => pistesApi.listByTournament(tournamentId!, signal),
    enabled: !!tournamentId,
    // На табло нет ни фокуса, ни перемонтирования, поэтому без интервала
    // список читался ровно один раз за всю жизнь вкладки: площадку, заведённую
    // после открытия табло, экран не увидел бы до перезагрузки и так и остался
    // бы в общетурнирном режиме, обещая залу чужую «следующую пару».
    refetchInterval: 60_000,
  })
}
