import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { matchesApi } from '../api/matches'

export default function MatchPage() {
  const { id } = useParams<{ id: string }>()

  const { data: match, isLoading } = useQuery({
    queryKey: ['matches', id],
    queryFn: () => matchesApi.get(id!),
    enabled: !!id,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.data?.status === 'InProgress' ? 5000 : false,
  })

  if (isLoading) return <p>Загрузка...</p>
  if (!match) return <p>Встреча не найдена</p>

  return (
    <div>
      <h1>Встреча — {match.stage}</h1>
      <p>Статус: {match.status}</p>
      <p>Счёт: {match.score1} : {match.score2}</p>
      <p>Раунд: {match.currentRoundNumber}</p>
      <p>Обоюдных: {match.doubleHitsCount} / {match.effectiveMaxDoubles ?? '—'}</p>
      <p>Предупреждения: {match.warnings1} / {match.warnings2}</p>

      <h2>Сходы</h2>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Раунд</th><th>Очки 1</th><th>Очки 2</th><th>Обоюдный</th><th>Заметка</th>
          </tr>
        </thead>
        <tbody>
          {match.exchanges.map(e => (
            <tr key={e.id}>
              <td>{e.sequence}</td>
              <td>{e.roundNumber}</td>
              <td>{e.points1}</td>
              <td>{e.points2}</td>
              <td>{e.isDoubleHit ? '✓' : ''}</td>
              <td>{e.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
