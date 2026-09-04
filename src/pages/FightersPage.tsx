import { useQuery } from '@tanstack/react-query'
import { fightersApi } from '../api/fighters'

export default function FightersPage() {
  const { data: fighters, isLoading, error } = useQuery({
    queryKey: ['fighters'],
    queryFn: fightersApi.list,
  })

  if (isLoading) return <p>Загрузка...</p>
  if (error) return <p>Ошибка загрузки бойцов</p>

  return (
    <div>
      <h1>Бойцы</h1>
      {fighters?.length === 0 && <p>Бойцов пока нет</p>}
      <ul>
        {fighters?.map(f => (
          <li key={f.id}>
            {f.firstName} {f.lastName} {f.club && `— ${f.club}`}
          </li>
        ))}
      </ul>
    </div>
  )
}
