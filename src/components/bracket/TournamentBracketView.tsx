import type { TournamentFormat, TournamentParticipant } from '../../api/types'
import { assignGroups, buildBracketRounds } from './bracketUtils'
import type { DEPhase } from './bracketUtils'
import RoundRobinPhaseView from './RoundRobinPhaseView'
import SingleEliminationView from './SingleEliminationView'
import DoubleEliminationView from './DoubleEliminationView'

interface Props {
  format: TournamentFormat
  participants: TournamentParticipant[]
}

export default function TournamentBracketView({ format, participants }: Props) {
  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 13, color: '#888' }}>
        Участников: {format.participants.count}
        {' · '}Посев: {format.participants.seeding === 'ranked' ? 'по рейтингу' : 'случайный'}
        {format.defaults?.roundsPerMatch && ` · Раундов: ${format.defaults.roundsPerMatch}`}
        {format.defaults?.roundDurationSeconds && ` · ${format.defaults.roundDurationSeconds}с/раунд`}
      </div>

      {format.phases.map(phase => {
        if (phase.type === 'roundRobin') {
          const p = phase as any
          const groups = assignGroups(phase as any, participants)
          return (
            <RoundRobinPhaseView
              key={phase.id}
              name={phase.name}
              groups={groups}
              pointsPerMatch={p.pointsPerMatch}
            />
          )
        }

        if (phase.type === 'singleElimination') {
          const p = phase as any
          const rounds = buildBracketRounds(phase as any)
          return (
            <SingleEliminationView
              key={phase.id}
              name={phase.name}
              rounds={rounds}
              thirdPlaceMatch={p.thirdPlaceMatch}
            />
          )
        }

        if (phase.type === 'doubleElimination') {
          return (
            <DoubleEliminationView
              key={phase.id}
              name={phase.name}
              phase={phase as unknown as DEPhase}
            />
          )
        }

        return null
      })}
    </div>
  )
}
