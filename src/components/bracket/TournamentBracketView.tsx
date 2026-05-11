import type { Match, TournamentFormat, TournamentParticipant } from '../../api/types'
import { assignGroups, buildBracketRounds, calculateGroupStandings, resolvePlayoffSlots } from './bracketUtils'
import type { DEPhase } from './bracketUtils'
import RoundRobinPhaseView from './RoundRobinPhaseView'
import SingleEliminationView from './SingleEliminationView'
import DoubleEliminationView from './DoubleEliminationView'

interface Props {
  format: TournamentFormat
  participants: TournamentParticipant[]
  fightDurationSeconds?: number
  allMatches?: Match[]
}

export default function TournamentBracketView({ format, participants, fightDurationSeconds, allMatches }: Props) {
  const displayDuration = fightDurationSeconds ?? format.defaults?.roundDurationSeconds
  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 13, color: '#888' }}>
        Участников: {format.participants.count}
        {' · '}Посев: {format.participants.seeding === 'ranked' ? 'по рейтингу' : 'случайный'}
        {displayDuration && ` · Время боя: ${displayDuration}с`}
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
          let resolvedIds: (string | null)[] | undefined
          if (allMatches && p.seeding?.from) {
            const rrPhase = format.phases.find(ph => ph.id === p.seeding.from)
            if (rrPhase) {
              const groupAssignments = assignGroups(rrPhase as any, participants)
              const standings = calculateGroupStandings(rrPhase, groupAssignments, allMatches)
              resolvedIds = resolvePlayoffSlots(phase as any, standings)
            }
          }
          const rounds = buildBracketRounds(phase as any, resolvedIds, participants, allMatches)
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
