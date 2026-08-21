import { useParams } from 'react-router-dom'
import MatchBoard, { WaitingBoard } from '../components/display/MatchBoard'
import { useDisplayLink } from '../components/display/useDisplayLink'

/**
 * Табло для зала, закреплённое за одним боем: `/display/match/:id` (АР-14).
 * Read-only вкладка того же браузера — ни одной мутации.
 *
 * За `show` это табло **не следует**: адрес в URL и есть решение оператора.
 * Так работают параллельные ристалища — на каждое своё табло со своим боем, и
 * пульт соседнего ристалища его не перекинет, хотя канал в браузере общий.
 * Табло, которое должно следовать за организатором, — `/display/tournament/:id`.
 */
export default function DisplayMatchPage() {
  const { id } = useParams<{ id: string }>()
  const link = useDisplayLink({ pinned: true })

  if (!id) return <WaitingBoard />
  return <MatchBoard matchId={id} link={link} />
}
