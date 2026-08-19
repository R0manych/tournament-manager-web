import type { Encounter, Match, MatchPlacement, TournamentFormat, TournamentParticipant } from '../../api/types'
import type { SaveGroupItem, TournamentGroup } from '../../api/groups'
import {
  assignGroupsFromExplicitSeeding, buildSwissPool, resolvePhaseGroups,
  buildBracketRounds, calculateGroupStandings, encountersToStandingsMatches,
  hasPhasePlacements, matchesOfPhase,
  resolvePlayoffSlots, resolveDERoundPairs,
  type PhaseStandingsCache,
} from './bracketUtils'
import type { DEPhase, GrandFinalSeries } from './bracketUtils'
import RoundRobinPhaseView from './RoundRobinPhaseView'
import SingleEliminationView from './SingleEliminationView'
import DoubleEliminationView from './DoubleEliminationView'
import SwissPhaseView, { type SwissPhaseData } from './SwissPhaseView'

interface Props {
  format: TournamentFormat
  participants: TournamentParticipant[]
  fightDurationSeconds?: number
  allMatches?: Match[]
  encounters?: Encounter[]
  savedGroups?: TournamentGroup[]
  // Размещения встреч в ячейках сетки (B-5): резолв идёт по ним, а не по паре.
  placements?: MatchPlacement[]
  // Group editing (snake-seeded RR phases, tournament in Draft): the panel's
  // single action persists the composition and generates the group-stage fights.
  groupsEditable?: boolean
  groupsGenerating?: boolean
  groupsLockedNote?: string
  generateGroupsLabel?: string
  onGenerateGroups?: (phaseId: string, groups: SaveGroupItem[]) => void
}

export default function TournamentBracketView({
  format, participants, fightDurationSeconds, allMatches, encounters, savedGroups, placements,
  groupsEditable, groupsGenerating, groupsLockedNote, generateGroupsLabel, onGenerateGroups,
}: Props) {
  const displayDuration = fightDurationSeconds ?? format.defaults?.roundDurationSeconds

  // Team group stages score from Encounters (aggregate per pair), singles from
  // flat Matches. Map encounters onto the shared StandingsMatch shape.
  const isTeam = participants[0]?.kind === 'Team'
  const standingsSource = isTeam ? encountersToStandingsMatches(encounters ?? []) : allMatches

  // Build standings cache for all roundRobin phases in declaration order so that
  // explicit-seeded phases (seeding.groups) can resolve participants from earlier phases.
  const standingsCache: PhaseStandingsCache = new Map()
  for (const phase of format.phases) {
    if (phase.type !== 'roundRobin') continue
    const p = phase as any
    const assignments = p.seeding?.groups
      ? assignGroupsFromExplicitSeeding(phase as any, standingsCache)
      : resolvePhaseGroups(phase as any, participants, savedGroups)
    // Только встречи, размещённые в этой фазе: переигровка одногруппников в
    // плейофф не должна задним числом двигать групповую таблицу (Д-3).
    const standings = standingsSource
      ? calculateGroupStandings(phase, assignments, matchesOfPhase(phase.id, standingsSource, placements))
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
          let phaseStandings = standingsSource ? cached.standings : undefined

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
            const sourceHasCompleted = standingsSource
              ? standingsSource.some(m => m.status === 'Completed' && sourceIds.has(m.fighter1Id) && m.fighter2Id != null && sourceIds.has(m.fighter2Id))
              : false

            if (!sourceHasCompleted) {
              groups = cached.assignments.map(g => ({ ...g, participants: [] }))
              phaseStandings = undefined
            }
          }

          const isSnakePhase = !p.seeding?.groups
          return (
            <RoundRobinPhaseView
              key={phase.id}
              name={phase.name}
              groups={groups}
              standings={phaseStandings}
              pointsPerMatch={p.pointsPerMatch}
              editable={isSnakePhase && groupsEditable}
              generating={groupsGenerating}
              lockedNote={isSnakePhase ? groupsLockedNote : undefined}
              generateLabel={generateGroupsLabel}
              onGenerate={onGenerateGroups ? items => onGenerateGroups(phase.id, items) : undefined}
            />
          )
        }

        if (phase.type === 'singleElimination') {
          const p = phase as any
          let resolvedIds: (string | null)[] | undefined
          if (standingsSource && p.seeding?.from) {
            const cached = standingsCache.get(p.seeding.from as string)
            if (cached) {
              const candidateIds = resolvePlayoffSlots(phase as any, cached.standings)
              // Размещённая фаза говорит о себе сама; для старых турниров
              // остаётся прежняя проверка «есть встреча этой пары».
              const hasPlayoffMatches = hasPhasePlacements(phase.id, placements) || candidateIds.some((id, i) => {
                if (i % 2 !== 0) return false
                const f1 = id, f2 = candidateIds[i + 1]
                if (!f1 || !f2) return false
                return standingsSource.some(m =>
                  (m.fighter1Id === f1 && m.fighter2Id === f2) ||
                  (m.fighter1Id === f2 && m.fighter2Id === f1)
                )
              })
              if (hasPlayoffMatches) resolvedIds = candidateIds
            }
          }
          const rounds = buildBracketRounds(phase as any, resolvedIds, participants, standingsSource, placements)
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
            ? calculateGroupStandings(phase, [pool], matchesOfPhase(phase.id, allMatches, placements))[0]
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
          let grandFinal: GrandFinalSeries<Match> | undefined
          if (allMatches) {
            const fromPhaseId = dePhase.upperBracket.slots[0]?.source?.split('.')?.[0]
            if (fromPhaseId) {
              const cached = standingsCache.get(fromPhaseId)
              if (cached) {
                const resolved = resolveDERoundPairs(dePhase, cached.standings, allMatches, placements)
                ubPairs = resolved.ubPairs
                lbPairs = resolved.lbPairs
                grandFinal = resolved.grandFinal
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
              grandFinal={grandFinal}
            />
          )
        }

        return null
      })}
    </div>
  )
}
