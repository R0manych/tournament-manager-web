// Список участников для зала. Раскладывается в колонки и вписывается в экран
// целиком (`FitBox`): прокрутки в зале нет, а «продолжение на следующей
// странице» заставляет зрителя ждать своей фамилии.

import type { Tournament, TournamentParticipant } from '../../api/types'
import { participantClub, participantName } from '../../api/types'
import { MUTED } from './boardStyle'
import { FitBox } from './BoardFrame'

/** Больше — и колонка становится выше экрана раньше, чем кончаются имена. */
const MAX_ROWS_PER_COLUMN = 16
const MAX_COLUMNS = 4

function orderParticipants(participants: TournamentParticipant[]): TournamentParticipant[] {
  return [...participants].sort((a, b) => {
    // Посев — это и есть объявленный порядок; без него читаем по алфавиту.
    if (a.seed != null && b.seed != null && a.seed !== b.seed) return a.seed - b.seed
    if ((a.seed == null) !== (b.seed == null)) return a.seed == null ? 1 : -1
    return participantName(a).localeCompare(participantName(b), 'ru')
  })
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export default function ParticipantsBoard({ tournament }: { tournament: Tournament | undefined }) {
  const participants = orderParticipants(tournament?.participants ?? [])

  if (participants.length === 0) {
    return <div style={{ margin: 'auto', color: MUTED, fontSize: '3vh' }}>Участников пока нет</div>
  }

  const columns = Math.min(MAX_COLUMNS, Math.ceil(participants.length / MAX_ROWS_PER_COLUMN)) || 1
  const perColumn = Math.ceil(participants.length / columns)
  // Режем последовательно, а не «по кругу»: колонка читается сверху вниз, и
  // номера в ней должны идти подряд.
  const chunks = chunk(participants, perColumn)

  return (
    <FitBox refit={`${tournament?.id}:${participants.length}`}>
      {/* Отступы в `em`: колонка должна расходиться с соседней пропорционально
          своему тексту, а не ширине окна — вписывать целиком это дело FitBox. */}
      <div style={{ display: 'flex', gap: '1.6em', fontSize: '3vh' }}>
        {chunks.map((column, ci) => (
          <table key={ci} style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {column.map((p, ri) => (
                <tr key={p.participantId}>
                  <td style={{ ...CELL, color: '#4b5265', textAlign: 'right', paddingRight: '0.5em' }}>
                    {ci * perColumn + ri + 1}
                  </td>
                  <td style={{ ...CELL, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {participantName(p)}
                  </td>
                  <td style={{ ...CELL, color: MUTED, paddingLeft: '0.8em', whiteSpace: 'nowrap' }}>
                    {participantClub(p) ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </FitBox>
  )
}

const CELL: React.CSSProperties = {
  padding: '0.18em 0',
  verticalAlign: 'baseline',
}
