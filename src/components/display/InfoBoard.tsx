// Нейтральный экран: турнир и номинация. Показывается в перерывах, до начала и
// когда в зале не должно быть ничего лишнего.

import type { Tournament } from '../../api/types'
import { MUTED } from './boardStyle'

function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const full = (d: Date) => d.toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })
  if (Number.isNaN(start.valueOf())) return ''
  if (Number.isNaN(end.valueOf()) || start.toDateString() === end.toDateString()) return full(start)
  // Один месяц — не повторяем его дважды: «12–13 апреля 2026».
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  return sameMonth ? `${start.getDate()}–${full(end)}` : `${full(start)} — ${full(end)}`
}

export default function InfoBoard({ tournament }: { tournament: Tournament | undefined }) {
  if (!tournament) return null

  const dates = formatRange(tournament.startDate, tournament.endDate)
  const count = tournament.participants.length
  const kind = tournament.participantKind === 'Team' ? 'команд' : 'участников'

  return (
    <div style={{ margin: 'auto', textAlign: 'center', padding: '0 5vw', maxWidth: '92vw' }}>
      <div style={{ fontSize: '8vh', fontWeight: 900, lineHeight: 1.05 }}>{tournament.name}</div>

      {tournament.nomination && (
        <div style={{ fontSize: '5vh', fontWeight: 700, color: '#6ea8ff', marginTop: '2.5vh' }}>
          {tournament.nomination}
        </div>
      )}

      <div style={{ fontSize: '2.8vh', color: MUTED, marginTop: '5vh', display: 'flex', gap: '2.5vw', justifyContent: 'center', flexWrap: 'wrap' }}>
        {tournament.location && <span>{tournament.location}</span>}
        {dates && <span>{dates}</span>}
        {count > 0 && <span>{count} {kind}</span>}
      </div>
    </div>
  )
}
