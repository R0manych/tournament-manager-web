import type { Match, TournamentFormat, TournamentParticipant } from '../../api/types'
import { assignGroups, buildBracketRounds, calculateGroupStandings, resolvePlayoffSlots, resolveDERoundPairs } from './bracketUtils'
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
          const standings = allMatches
            ? calculateGroupStandings(phase, groups, allMatches)
            : undefined
          return (
            <RoundRobinPhaseView
              key={phase.id}
              name={phase.name}
              groups={groups}
              standings={standings}
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
              const candidateIds = resolvePlayoffSlots(phase as any, standings)
              // Only show resolved names if playoff matches have actually been generated.
              // generatePlayoffMut creates all first-round matches at once, so checking
              // any one of the expected pairs is sufficient.
              const hasPlayoffMatches = candidateIds.some((id, i) => {
                if (i % 2 !== 0) return false
                const f1 = id, f2 = candidateIds[i + 1]
                if (!f1 || !f2) return false
                return allMatches.some(m =>
                  (m.fighter1Id === f1 && m.fighter2Id === f2) ||
                  (m.fighter1Id === f2 && m.fighter2Id === f1)
                )
              })
              if (hasPlayoffMatches) resolvedIds = candidateIds
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
          const dePhase = phase as unknown as DEPhase
          let ubPairs: ([string | null, string | null])[][] | undefined
          let lbPairs: ([string | null, string | null])[][] | undefined
          if (allMatches) {
            const fromPhaseId = dePhase.upperBracket.slots[0]?.source?.split('.')?.[0]
            if (fromPhaseId) {
              const rrPhase = format.phases.find(ph => ph.id === fromPhaseId)
              if (rrPhase) {
                const groupAssignments = assignGroups(rrPhase as any, participants)
                const standings = calculateGroupStandings(rrPhase, groupAssignments, allMatches)
                const resolved = resolveDERoundPairs(dePhase, standings, allMatches)
                ubPairs = resolved.ubPairs
                lbPairs = resolved.lbPairs
              }
            }
          }
          return (
            <DoubleEliminationView
              key={phase.id}
              name={phase.name}
              phase={dePhase}
              participants={participants}
              ubPairs={ubPairs}
              lbPairs={lbPairs}
            />
          )
        }

        return null
      })}
    </div>
  )
}
