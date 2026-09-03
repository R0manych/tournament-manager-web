// Адрес табло ристалища (docs/09 §6.3). Больше про этот экран ничего знать не
// нужно: турнир площадки, её имя и очередь табло берёт по `GET /pistes/{id}`.
export function pisteBoardPath(pisteId: string): string {
  return `/display/piste/${pisteId}`
}
