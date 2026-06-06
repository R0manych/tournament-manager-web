import type { GroupAssignment, GroupStanding } from './bracketUtils'

// Swiss phase shape (simple, single-pool subset of the v0.3 DSL).
export interface SwissPhaseData {
  id: string
  name: string
  type: 'swiss'
  rounds?: number
  qualification?: { winsToQualify: number; lossesToEliminate: number; maxRounds?: number }
  pairing?: {
    firstRound?: 'fold' | 'adjacent' | 'random'
    avoidRematch?: boolean
  }
  pointsPerMatch?: { win: number; draw: number; loss: number }
  tieBreakers?: string[]
}

interface Props {
  name: string
  phase: SwissPhaseData
  pool: GroupAssignment
  standings?: GroupStanding[]
}

const FIRST_ROUND_LABELS: Record<string, string> = {
  fold: 'верхняя половина против нижней',
  adjacent: 'соседи по посеву',
  random: 'случайные пары',
}

const TIE_BREAKER_LABELS: Record<string, string> = {
  scoreDifference: 'разница ударов',
  buchholz: 'Бухгольц',
  buchholzCut1: 'Бухгольц (без худшего)',
  sonnebornBerger: 'Зоннеборн—Бергер',
  opponentWinRate: 'винрейт соперников',
  cumulative: 'кумулятивный',
  random: 'жребий',
}

const TH: React.CSSProperties = {
  padding: '5px 10px',
  fontWeight: 600,
  fontSize: 12,
  color: '#fff',
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

const TH_NUM: React.CSSProperties = { ...TH, textAlign: 'center', width: 36 }

const TD: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  borderBottom: '1px solid #f0f0f0',
  whiteSpace: 'nowrap',
}

const TD_NUM: React.CSSProperties = { ...TD, textAlign: 'center', color: '#555' }

export default function SwissPhaseView({ name, phase, pool, standings }: Props) {
  const standingMap = standings ? new Map(standings.map(s => [s.fighterId, s])) : null
  const hasStats = standingMap !== null

  // Order rows by standing when available, otherwise by seed.
  const rows = standingMap
    ? standings!.map((s, rank) => {
        const p = pool.participants.find(x => x.fighterId === s.fighterId)
        return { rank: rank + 1, name: p?.name ?? s.fighterId, seed: p?.seed, standing: s }
      })
    : pool.participants.map((p, i) => ({
        rank: i + 1,
        name: p.name,
        seed: p.seed,
        standing: null as GroupStanding | null,
      }))

  const ppm = phase.pointsPerMatch
  const firstRound = phase.pairing?.firstRound ?? 'fold'
  const tieBreakers = phase.tieBreakers ?? []

  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{ marginBottom: 12, color: '#444' }}>{name}</h3>

      <div style={{ fontSize: 13, color: '#888', marginBottom: 12, lineHeight: 1.6 }}>
        {phase.rounds != null && <div>Туров: {phase.rounds}</div>}
        {phase.qualification && (
          <div>
            Отсечка: {phase.qualification.winsToQualify} побед → проход,{' '}
            {phase.qualification.lossesToEliminate} поражений → вылет
          </div>
        )}
        <div>Жеребьёвка 1-го тура: {FIRST_ROUND_LABELS[firstRound] ?? firstRound}</div>
        {ppm && <div>Очки: победа {ppm.win} / ничья {ppm.draw} / поражение {ppm.loss}</div>}
        {tieBreakers.length > 0 && (
          <div>Тай-брейки: {tieBreakers.map(tb => TIE_BREAKER_LABELS[tb] ?? tb).join(' → ')}</div>
        )}
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden', display: 'inline-block' }}>
        <div style={{ background: '#4a6fa5', color: '#fff', padding: '6px 12px', fontWeight: 600, fontSize: 14 }}>
          Турнирная таблица
        </div>

        {pool.participants.length === 0 ? (
          <p style={{ padding: '6px 12px', color: '#aaa', fontSize: 13, margin: 0 }}>Нет участников</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ background: '#4a6fa5' }}>
                <th style={TH_NUM}>#</th>
                <th style={TH}>Участник</th>
                {hasStats && <>
                  <th style={TH_NUM} title="Победы">В</th>
                  <th style={TH_NUM} title="Ничьи">Н</th>
                  <th style={TH_NUM} title="Поражения">П</th>
                  <th style={TH_NUM} title="Разница ударов">±</th>
                  <th style={TH_NUM} title="Очки">Оч</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.name}>
                  <td style={TD_NUM}>{row.rank}</td>
                  <td style={{ ...TD, color: '#1a1a1a' }}>
                    {row.name}
                    {row.seed != null && (
                      <span style={{ color: '#bbb', fontSize: 11, marginLeft: 5 }}>#{row.seed}</span>
                    )}
                  </td>
                  {hasStats && row.standing && <>
                    <td style={{ ...TD_NUM, color: '#2a7a2a', fontWeight: 600 }}>{row.standing.wins}</td>
                    <td style={TD_NUM}>{row.standing.draws}</td>
                    <td style={{ ...TD_NUM, color: '#a00' }}>{row.standing.losses}</td>
                    <td style={TD_NUM}>{row.standing.scoreDiff > 0 ? `+${row.standing.scoreDiff}` : row.standing.scoreDiff}</td>
                    <td style={{ ...TD_NUM, fontWeight: 600 }}>{row.standing.points}</td>
                  </>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
