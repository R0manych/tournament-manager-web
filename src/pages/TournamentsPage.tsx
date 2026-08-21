import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { tournamentsApi } from '../api/tournaments'

export default function TournamentsPage() {
  const { data: tournaments, isLoading, error } = useQuery({
    queryKey: ['tournaments'],
    queryFn: tournamentsApi.list,
  })

  if (isLoading) return <p>Загрузка...</p>
  if (error) return <p>Ошибка загрузки турниров</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Турниры</h1>
        <Link to="/admin/tournaments/new">+ Создать</Link>
      </div>
      {tournaments?.length === 0 && <p>Турниров пока нет</p>}
      <ul>
        {tournaments?.map(t => (
          <li key={t.id}>
            <Link to={`/tournaments/${t.id}`}>
              {t.name}
              {/* Номинация опциональна: разделитель рисуем только вместе с ней,
                  иначе в списке останутся висящие точки. */}
              {t.nomination && <span style={{ color: '#888' }}> · {t.nomination}</span>}
              {' — '}
              {t.status}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
