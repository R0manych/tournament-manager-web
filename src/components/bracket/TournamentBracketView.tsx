import type { Encounter, Match, MatchPlacement, TournamentFormat, TournamentParticipant } from '../../api/types'
import type { SaveGroupItem, TournamentGroup } from '../../api/groups'
import {
  buildPhaseStandingsCache, buildSwissPool,
  buildBracketRounds, calculateGroupStandings, encountersToStandingsMatches,
  matchesOfPhase, resolveDEFromCache, resolveSESlotIds, savedGroupsDrift,
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

  // Составы и таблицы всех roundRobin-фаз (в порядке объявления, чтобы фаза с
  // явным посевом резолвилась из предыдущих). Общий с табло для зала расчёт —
  // см. `buildPhaseStandingsCache`.
  const standingsCache: PhaseStandingsCache = buildPhaseStandingsCache(
    format, participants, standingsSource, placements, savedGroups,
  )

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
            // Двойное поражение (АР-16) тоже меняет таблицу — обоим засчитано
            // поражение, — значит источник уже «сыграл» и посев не пустой.
            const sourceHasCompleted = standingsSource
              ? standingsSource.some(m =>
                  (m.status === 'Completed' || m.status === 'DoubleLoss') &&
                  sourceIds.has(m.fighter1Id) && m.fighter2Id != null && sourceIds.has(m.fighter2Id))
              : false

            if (!sourceHasCompleted) {
              groups = cached.assignments.map(g => ({ ...g, participants: [] }))
              phaseStandings = undefined
            }
          }

          const isSnakePhase = !p.seeding?.groups
          // Расхождение сохранённого состава с текущей заявкой — только для
          // snake-фаз: состав фазы с явным посевом резолвится из таблиц
          // предыдущей и на сервере не хранится, там расходиться нечему.
          const drift = isSnakePhase
            ? savedGroupsDrift(savedGroups, phase.id, participants)
            : { unassigned: [], withdrawnCount: 0 }
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
              unassigned={drift.unassigned}
              withdrawnCount={drift.withdrawnCount}
            />
          )
        }

        if (phase.type === 'singleElimination') {
          const p = phase as any
          const se = phase as TournamentFormat['phases'][0] & { type: 'singleElimination' }
          const resolvedIds = resolveSESlotIds(se, standingsCache, standingsSource, placements)
          const rounds = buildBracketRounds(se, resolvedIds, participants, standingsSource, placements)
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
          const { ubPairs, lbPairs, grandFinal } =
            resolveDEFromCache(dePhase, standingsCache, allMatches, placements)
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
