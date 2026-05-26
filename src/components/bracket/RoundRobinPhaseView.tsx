import type { GroupAssignment, GroupStanding } from './bracketUtils'

interface Props {
  name: string
  groups: GroupAssignment[]
  standings?: GroupStanding[][]
  pointsPerMatch?: { win: number; draw: number; loss: number }
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

export default function RoundRobinPhaseView({ name, groups, standings, pointsPerMatch }: Props) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{ marginBottom: 12, color: '#444' }}>{name}</h3>
      {pointsPerMatch && (
        <p style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
          Очки: победа {pointsPerMatch.win} / ничья {pointsPerMatch.draw} / поражение {pointsPerMatch.loss}
        </p>
      )}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {groups.map((group, gi) => {
          const groupStandings = standings?.[gi]
          const standingMap = groupStandings
            ? new Map(groupStandings.map(s => [s.fighterId, s]))
            : null

          // Order rows by standing if available, otherwise by seed
          const rows = standingMap
            ? groupStandings!.map((s, rank) => {
                const p = group.participants.find(x => x.fighterId === s.fighterId)!
                return { rank: rank + 1, name: p?.name ?? s.fighterId, seed: p?.seed, standing: s }
              })
            : group.participants.map((p, i) => ({
                rank: i + 1,
                name: p.name,
                seed: p.seed,
                standing: null as GroupStanding | null,
              }))

          const hasStats = standingMap !== null

          return (
            <div key={group.groupLabel} style={{
              border: '1px solid #ddd',
              borderRadius: 6,
              overflow: 'hidden',
            }}>
              <div style={{
                background: '#4a6fa5',
                color: '#fff',
                padding: '6px 12px',
                fontWeight: 600,
                fontSize: 14,
              }}>
                Группа {group.groupLabel}
              </div>

              {group.participants.length === 0 ? (
                <p style={{ padding: '6px 12px', color: '#aaa', fontSize: 13, margin: 0 }}>
                  Нет участников
                </p>
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
                          <td style={{ ...TD_NUM, fontWeight: 600 }}>{row.standing.points}</td>
                        </>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
