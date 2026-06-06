import type { Match, TournamentFormat, TournamentParticipant } from '../../api/types'
import {
  assignGroups, assignGroupsFromExplicitSeeding, buildSwissPool,
  buildBracketRounds, calculateGroupStandings, resolvePlayoffSlots, resolveDERoundPairs,
  type PhaseStandingsCache,
} from './bracketUtils'
import type { DEPhase } from './bracketUtils'
import RoundRobinPhaseView from './RoundRobinPhaseView'
import SingleEliminationView from './SingleEliminationView'
import DoubleEliminationView from './DoubleEliminationView'
import SwissPhaseView, { type SwissPhaseData } from './SwissPhaseView'

interface Props {
  format: TournamentFormat
  participants: TournamentParticipant[]
  fightDurationSeconds?: number
  allMatches?: Match[]
}

export default function TournamentBracketView({ format, participants, fightDurationSeconds, allMatches }: Props) {
  const displayDuration = fightDurationSeconds ?? format.defaults?.roundDurationSeconds

  // Build standings cache for all roundRobin phases in declaration order so that
  // explicit-seeded phases (seeding.groups) can resolve participants from earlier phases.
  const standingsCache: PhaseStandingsCache = new Map()
  for (const phase of format.phases) {
    if (phase.type !== 'roundRobin') continue
    const p = phase as any
    const assignments = p.seeding?.groups
      ? assignGroupsFromExplicitSeeding(phase as any, standingsCache)
      : assignGroups(phase as any, participants)
    const standings = allMatches
      ? calculateGroupStandings(phase, assignments, allMatches)
      : assignments.map(() => [])
    standingsCache.set(phase.id, { assignments, standings })
  }

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
          const cached = standingsCache.get(phase.id)!

          let groups = cached.assignments
          let phaseStandings = allMatches ? cached.standings : undefined

          if (p.seeding?.groups) {
            // Only show participants once the source phase has completed matches.
            // Before that, standings are all-zero and group assignments are meaningless.
            // Mirrors SE/DE: slots stay empty until the previous phase actually resolves.
            const seedingGroups = p.seeding.groups as Record<string, Array<{ source: string; rank: number }>>
            const sourcePhaseId = Object.values(seedingGroups).flat()[0]?.source?.split('.')?.[0]
            const sourceCached = sourcePhaseId ? standingsCache.get(sourcePhaseId) : undefined
            const sourceIds = sourceCached
              ? new Set(sourceCached.assignments.flatMap(g => g.participants.map(px => px.fighterId)))
              : new Set<string>()
            const sourceHasCompleted = allMatches
              ? allMatches.some(m => m.status === 'Completed' && sourceIds.has(m.fighter1Id) && m.fighter2Id != null && sourceIds.has(m.fighter2Id))
              : false

            if (!sourceHasCompleted) {
              groups = cached.assignments.map(g => ({ ...g, participants: [] }))
              phaseStandings = undefined
            }
          }

          return (
            <RoundRobinPhaseView
              key={phase.id}
              name={phase.name}
              groups={groups}
              standings={phaseStandings}
              pointsPerMatch={p.pointsPerMatch}
            />
          )
        }

        if (phase.type === 'singleElimination') {
          const p = phase as any
          let resolvedIds: (string | null)[] | undefined
          if (allMatches && p.seeding?.from) {
            const cached = standingsCache.get(p.seeding.from as string)
            if (cached) {
              const candidateIds = resolvePlayoffSlots(phase as any, cached.standings)
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

        if (phase.type === 'swiss') {
          // Simple swiss: single pool of all participants, ranked like a one-group
          // round robin. Group-swiss (multiple pools) is deferred.
          const sp = phase as unknown as SwissPhaseData
          const pool = buildSwissPool(participants)
          const standings = allMatches
            ? calculateGroupStandings(phase, [pool], allMatches)[0]
            : undefined
          return (
            <SwissPhaseView
              key={phase.id}
              name={phase.name}
              phase={sp}
              pool={pool}
              standings={standings}
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
              const cached = standingsCache.get(fromPhaseId)
              if (cached) {
                const resolved = resolveDERoundPairs(dePhase, cached.standings, allMatches)
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
