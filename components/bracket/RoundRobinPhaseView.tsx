import type { GroupAssignment } from './bracketUtils'

interface Props {
  name: string
  groups: GroupAssignment[]
  pointsPerMatch?: { win: number; draw: number; loss: number }
}

export default function RoundRobinPhaseView({ name, groups, pointsPerMatch }: Props) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{ marginBottom: 12, color: '#444' }}>{name}</h3>
      {pointsPerMatch && (
        <p style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
          Очки: победа {pointsPerMatch.win} / ничья {pointsPerMatch.draw} / поражение {pointsPerMatch.loss}
        </p>
      )}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {groups.map(group => (
          <div key={group.groupLabel} style={{
            border: '1px solid #ddd',
            borderRadius: 6,
            minWidth: 180,
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
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {group.participants.length === 0
                ? <li style={{ padding: '6px 12px', color: '#aaa', fontSize: 13 }}>Нет участников</li>
                : group.participants.map(p => (
                  <li key={p.seed} style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid #f0f0f0',
                    fontSize: 14,
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                  }}>
                    <span style={{ color: '#aaa', fontSize: 12, minWidth: 20 }}>#{p.seed}</span>
                    {p.name}
                  </li>
                ))
              }
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
