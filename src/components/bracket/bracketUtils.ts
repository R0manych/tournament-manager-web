import type { TournamentFormat, TournamentParticipant, Match, Encounter, MatchPlacement } from '../../api/types'
import { participantName } from '../../api/types'
import type { TournamentGroup } from '../../api/groups'

// ── Ячейки сетки (B-5, docs/08) ────────────────────────────────────────────
// Встреча резолвится по ячейке `(phaseId, roundId, slotIndex)`, а не по паре
// участников: одна и та же пара может сойтись в группе и в плейофф, в UB и в
// LB, в гранд-финале и в матче-сбросе. Пара осталась только подписью.
//
// Откат на резолв по паре сохранён для турниров, созданных до размещений
// (инвариант 46), но ограничен встречами, которые не стоят ни в одной ячейке:
// размещённая встреча принадлежит своей ячейке и не может быть подставлена в
// чужую (дефект Д-2). Это же делает безопасной смешанную ситуацию, когда
// размещения появляются у турнира, часть встреч которого создана раньше.

export const THIRD_PLACE_ROUND_ID = 'thirdPlace'
export const GRAND_FINAL_ROUND_ID = 'grandFinal'
export const GRAND_FINAL_RESET_ROUND_ID = 'grandFinalReset'

// Ключ ячейки через JSON, а не склейкой разделителем: `roundId` группового
// этапа — это метка группы, свободный текст организатора.
const cellKey = (roundId: string, slotIndex: number) => JSON.stringify([roundId, slotIndex])

export interface PlaceableMatch {
  id: string
  fighter1Id: string
  fighter2Id?: string
}

export interface PhaseCellLookup<M> {
  /** true — в фазе занята хотя бы одна ячейка; иначе фаза живёт на резолве по паре. */
  placed: boolean
  /** Встреча ячейки; undefined, если ячейка пуста. */
  at: (roundId: string, slotIndex: number) => M | undefined
  /** Ячейка, а если она пуста — неразмещённая встреча этой пары (legacy). */
  find: (
    roundId: string,
    slotIndex: number,
    f1: string | null | undefined,
    f2: string | null | undefined,
  ) => M | undefined
}

export function createCellLookup<M extends PlaceableMatch>(
  phaseId: string,
  matches: M[] | undefined,
  placements: MatchPlacement[] | undefined,
): PhaseCellLookup<M> {
  const all = matches ?? []
  const byId = new Map(all.map(m => [m.id, m]))
  const placedIds = new Set((placements ?? []).map(pl => pl.matchId))

  const cells = new Map<string, M>()
  for (const pl of placements ?? []) {
    if (pl.phaseId !== phaseId) continue
    const m = byId.get(pl.matchId)
    if (m) cells.set(cellKey(pl.roundId, pl.slotIndex), m)
  }

  const at = (roundId: string, slotIndex: number) => cells.get(cellKey(roundId, slotIndex))

  const byPair = (f1: string, f2: string) =>
    all.find(m =>
      !placedIds.has(m.id) &&
      ((m.fighter1Id === f1 && m.fighter2Id === f2) ||
       (m.fighter1Id === f2 && m.fighter2Id === f1)),
    )

  return {
    placed: cells.size > 0,
    at,
    find: (roundId, slotIndex, f1, f2) =>
      at(roundId, slotIndex) ?? (f1 && f2 ? byPair(f1, f2) : undefined),
  }
}

// Размещение приезжает внутри самой встречи (`MatchResponse.placement`), поэтому
// отдельный `GET /placements` фронту не нужен: один источник — один кэш, и
// размещения не могут разъехаться со списком встреч между инвалидациями.
// Эндпоинт остаётся в `placementsApi` для тех, кому нужна только раскладка.
export function placementsOf(matches: Match[] | undefined): MatchPlacement[] {
  return (matches ?? [])
    .map(m => m.placement)
    .filter((pl): pl is MatchPlacement => pl != null)
}

export function hasPhasePlacements(phaseId: string, placements: MatchPlacement[] | undefined): boolean {
  return (placements ?? []).some(pl => pl.phaseId === phaseId)
}

// Встречи фазы: размещённые в ней плюс те, что не стоят ни в одной ячейке.
// Этим чинится Д-3 — переигровка одногруппников в плейофф размещена в фазе
// плейофф и больше не попадает в групповую таблицу, — и при этом турниры без
// размещений (и встречи, заведённые вручную) считаются как раньше.
export function matchesOfPhase<M extends { id: string }>(
  phaseId: string,
  matches: M[],
  placements: MatchPlacement[] | undefined,
): M[] {
  const all = placements ?? []
  if (all.length === 0) return matches
  const inPhase = new Set(all.filter(pl => pl.phaseId === phaseId).map(pl => pl.matchId))
  const placedAnywhere = new Set(all.map(pl => pl.matchId))
  return matches.filter(m => inPhase.has(m.id) || !placedAnywhere.has(m.id))
}

// NOTE: `fighterId` here is an opaque participant id — a Fighter.Id in singles
// tournaments and a Team.Id in team tournaments. The name is kept for minimal
// churn; bracket logic treats it as an interchangeable slot identifier.
export interface GroupAssignment {
  groupIndex: number
  groupLabel: string
  participants: Array<{ fighterId: string; seed: number; name: string }>
}

export interface BracketSlot {
  label: string
  sublabel?: string
  isDropdown?: boolean
  isBye?: boolean
}

export interface BracketMatchData {
  top: BracketSlot
  bottom: BracketSlot
}

export interface BracketRoundData {
  name: string
  matches: BracketMatchData[]
}

export interface DEBracketRound extends BracketRoundData {
  isDropout: boolean          // true = этот раунд принимает выбывших из UB
  dropFromRoundName?: string  // название раунда UB, откуда пришли дропы
}

// ── Phase standings cache ─────────────────────────────────────────────────
// Built in phase-declaration order so later phases can resolve from earlier ones.
export type PhaseStandingsCache = Map<string, {
  assignments: GroupAssignment[]
  standings: GroupStanding[][]
}>

// ── Snake seeding ──────────────────────────────────────────────────────────
// seed 1→A, 2→B, 3→C, 4→D, 5→D, 6→C, 7→B, 8→A, 9→A, ...
export function assignGroups(
  phase: TournamentFormat['phases'][0] & { type: 'roundRobin' },
  participants: TournamentParticipant[],
): GroupAssignment[] {
  const groupCount = (phase as any).groups?.count ?? 1
  const groups: GroupAssignment[] = Array.from({ length: groupCount }, (_, i) => ({
    groupIndex: i,
    groupLabel: String.fromCharCode(65 + i),
    participants: [],
  }))

  const sorted = [...participants].sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999))

  sorted.forEach((p, idx) => {
    const row = Math.floor(idx / groupCount)
    const col = row % 2 === 0 ? idx % groupCount : groupCount - 1 - (idx % groupCount)
    groups[col].participants.push({
      fighterId: p.participantId,
      seed: p.seed ?? idx + 1,
      name: participantName(p),
    })
  })

  return groups
}

// ── Saved groups (persisted on the server) ─────────────────────────────────
// Maps the saved composition of one phase to GroupAssignment[]. Returns null
// when nothing is saved for the phase — caller falls back to snake seeding.
// Participants no longer registered in the tournament are silently dropped.
export function groupsFromSaved(
  saved: TournamentGroup[] | undefined,
  phaseId: string,
  participants: TournamentParticipant[],
): GroupAssignment[] | null {
  const phaseGroups = (saved ?? []).filter(g => g.phaseId === phaseId)
  if (phaseGroups.length === 0) return null

  const byId = new Map(participants.map(p => [p.participantId, p]))
  return phaseGroups.map((g, gi) => ({
    groupIndex: gi,
    groupLabel: g.label,
    participants: g.participantIds
      .map(pid => byId.get(pid))
      .filter((p): p is TournamentParticipant => p != null)
      .map((p, idx) => ({
        fighterId: p.participantId,
        seed: p.seed ?? idx + 1,
        name: participantName(p),
      })),
  }))
}

// Saved composition wins; otherwise snake seeding. Explicit-seeded phases
// (phase.seeding.groups) are resolved from standings elsewhere and are not
// persisted.
export function resolvePhaseGroups(
  phase: TournamentFormat['phases'][0] & { type: 'roundRobin' },
  participants: TournamentParticipant[],
  saved: TournamentGroup[] | undefined,
): GroupAssignment[] {
  return groupsFromSaved(saved, phase.id, participants) ?? assignGroups(phase, participants)
}

// ── Team encounters → round-robin groups ────────────────────────────────────
export interface EncounterGroup {
  label: string | null   // group label (e.g. 'A'); null = ungrouped / cross-group bucket
  encounters: Encounter[]
}

// Buckets team encounters into their round-robin group (both teams in the same
// group) and orders each bucket by the canonical pair sequence — (0,1),(0,2),…,
// (1,2),… over the group's seed order — so the list reads in schedule order
// instead of arbitrary creation order. Encounters whose two teams aren't in the
// same group fall into a trailing `label: null` bucket.
export function groupEncountersByGroup(
  groups: GroupAssignment[],
  encounters: Encounter[],
): EncounterGroup[] {
  const groupIdxOf = new Map<string, number>()
  groups.forEach((g, gi) => g.participants.forEach(p => groupIdxOf.set(p.fighterId, gi)))

  const orderInGroup = (gi: number, e: Encounter): number => {
    const ids = groups[gi].participants.map(p => p.fighterId)
    const i1 = ids.indexOf(e.participant1Id)
    const i2 = ids.indexOf(e.participant2Id)
    const a = Math.min(i1, i2), b = Math.max(i1, i2)
    let idx = 0
    for (let k = 0; k < a; k++) idx += ids.length - 1 - k
    return idx + (b - a - 1)
  }

  const buckets: Encounter[][] = groups.map(() => [])
  const other: Encounter[] = []
  for (const e of encounters) {
    const g1 = groupIdxOf.get(e.participant1Id)
    const g2 = groupIdxOf.get(e.participant2Id)
    if (g1 != null && g1 === g2) buckets[g1].push(e)
    else other.push(e)
  }
  buckets.forEach((arr, gi) => arr.sort((x, y) => orderInGroup(gi, x) - orderInGroup(gi, y)))

  const result: EncounterGroup[] = groups.map((g, gi) => ({ label: g.groupLabel, encounters: buckets[gi] }))
  if (other.length) result.push({ label: null, encounters: other })
  return result
}

// ── Explicit group seeding (phase.seeding.groups is defined) ──────────────
// Resolves participants from previous-phase standings stored in the cache.
// Falls back to placeholder names for unresolved slots.
export function assignGroupsFromExplicitSeeding(
  phase: TournamentFormat['phases'][0] & { type: 'roundRobin' },
  cache: PhaseStandingsCache,
): GroupAssignment[] {
  const p = phase as any
  const groupCount = p.groups?.count ?? 1
  const seedingGroups = p.seeding?.groups as Record<string, Array<{ source: string; rank: number }>> | undefined

  const groups: GroupAssignment[] = Array.from({ length: groupCount }, (_, i) => ({
    groupIndex: i,
    groupLabel: String.fromCharCode(65 + i),
    participants: [],
  }))

  if (!seedingGroups) return groups

  Object.entries(seedingGroups).forEach(([groupLabel, slots]) => {
    const groupIndex = groupLabel.charCodeAt(0) - 65
    if (groupIndex < 0 || groupIndex >= groups.length) return

    slots.forEach((slot, slotIdx) => {
      const parts = slot.source.split('.')
      if (parts.length < 2) return
      const sourcePhaseId = parts[0]
      const sourceGroupLabel = parts[1]
      const sourceGroupIndex = sourceGroupLabel.charCodeAt(0) - 65

      const sourceData = cache.get(sourcePhaseId)
      if (sourceData) {
        const standingEntry = sourceData.standings[sourceGroupIndex]?.[slot.rank - 1]
        if (standingEntry) {
          const participantInfo = sourceData.assignments[sourceGroupIndex]?.participants
            .find(px => px.fighterId === standingEntry.fighterId)
          if (participantInfo) {
            groups[groupIndex].participants.push(participantInfo)
            return
          }
        }
      }

      // Source phase not yet resolved — show a labelled placeholder
      groups[groupIndex].participants.push({
        fighterId: `__placeholder__${slot.source}:${slot.rank}`,
        seed: slotIdx + 1,
        name: `Гр. ${sourceGroupLabel} #${slot.rank}`,
      })
    })
  })

  return groups
}

// ── Swiss (simple, single pool) ─────────────────────────────────────────────
// Builds one pool from all participants ordered by seed. Group-swiss (multiple
// pools via `groups`) is deferred — the simple version uses a single pool.
// Standings are computed by reusing calculateGroupStandings (swiss phases carry
// both `pointsPerMatch` and `tieBreakers`).
export function buildSwissPool(participants: TournamentParticipant[]): GroupAssignment {
  const sorted = [...participants].sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999))
  return {
    groupIndex: 0,
    groupLabel: 'A',
    participants: sorted.map((p, idx) => ({
      fighterId: p.participantId,
      seed: p.seed ?? idx + 1,
      name: participantName(p),
    })),
  }
}

// ── Swiss round pairing (simple, single pool, fixed rounds) ─────────────────
// Plans the next swiss round: validates the pool is ready, then produces the
// pairs (and, for an odd pool, the bye). Scope of the preliminary version:
//   • single pool; odd pools get one bye per round (auto-win, see below);
//   • fixed-rounds termination (`rounds`); `qualification` mode not handled here;
//   • round 1 paired by `pairing.firstRound`; later rounds Monrad-style
//     (sort by standing, pair adjacently) with rematch avoidance.
// A bye is created as a match with no opponent (fighter2Id omitted) — the
// backend auto-completes it as a win for the bye fighter (score 0:0).
export type ByePolicy = 'lowestRank' | 'highestRank' | 'random'

export interface SwissPairingPhase {
  rounds?: number
  qualification?: unknown
  pairing?: {
    firstRound?: 'fold' | 'adjacent' | 'random'
    avoidRematch?: boolean
    byePolicy?: ByePolicy
  }
}

export interface SwissRoundPlan {
  roundNumber: number          // 1-based round about to be generated
  pairs: [string, string][]
  bye: string | null           // fighter granted a bye this round (odd pool), else null
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

// Greedy backtracking pairing over an ordered list, optionally avoiding rematches.
function backtrackPairs(order: string[], played: Set<string>, avoidRematch: boolean): [string, string][] | null {
  if (order.length === 0) return []
  const [first, ...rest] = order
  for (let i = 0; i < rest.length; i++) {
    const opp = rest[i]
    if (avoidRematch && played.has(pairKey(first, opp))) continue
    const sub = backtrackPairs(rest.filter((_, j) => j !== i), played, avoidRematch)
    if (sub) return [[first, opp], ...sub]
  }
  return null
}

// First-round pairing over a (seed-ordered, even-length) list.
function firstRoundPairs(order: string[], policy: 'fold' | 'adjacent' | 'random'): [string, string][] {
  const pairs: [string, string][] = []
  if (policy === 'fold') {
    const half = order.length / 2
    for (let i = 0; i < half; i++) pairs.push([order[i], order[i + half]])
  } else if (policy === 'random') {
    const shuffled = [...order]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    for (let i = 0; i + 1 < shuffled.length; i += 2) pairs.push([shuffled[i], shuffled[i + 1]])
  } else { // adjacent
    for (let i = 0; i + 1 < order.length; i += 2) pairs.push([order[i], order[i + 1]])
  }
  return pairs
}

// Picks the bye recipient from a standings/seed-ordered list, preferring fighters
// who have not had a bye yet.
function pickBye(order: string[], hadBye: Set<string>, policy: ByePolicy): string {
  const eligible = order.filter(id => !hadBye.has(id))
  const candidates = eligible.length > 0 ? eligible : order
  if (policy === 'highestRank') return candidates[0]
  if (policy === 'random') return candidates[Math.floor(Math.random() * candidates.length)]
  return candidates[candidates.length - 1] // lowestRank (default)
}

const isByeMatch = (m: Match) => m.fighter2Id == null

export function planSwissNextRound(
  pool: GroupAssignment,
  phase: SwissPairingPhase,
  standings: GroupStanding[] | undefined,
  allMatches: Match[],
): SwissRoundPlan {
  if (phase.qualification) {
    throw new Error('Режим отсечки (qualification) пока не поддерживается — используйте фиксированное число туров (rounds).')
  }

  const ids = pool.participants.map(p => p.fighterId)
  const n = ids.length
  if (n < 2) throw new Error('В пуле меньше двух участников.')

  const idSet = new Set(ids)
  // Pool matches: both fighters in the pool, or a bye whose single fighter is.
  const swissMatches = allMatches.filter(m =>
    idSet.has(m.fighter1Id) && (isByeMatch(m) || idSet.has(m.fighter2Id!))
  )
  // A round is "incomplete" only while a real match still awaits a result.
  // Byes are created already resolved (WalkoverWin) and never block.
  const incomplete = swissMatches.filter(m => m.status === 'Scheduled' || m.status === 'InProgress').length
  if (incomplete > 0) {
    throw new Error(`В текущем туре ещё ${incomplete} незавершённых боёв. Завершите их, чтобы сформировать следующий тур.`)
  }

  // Rounds played = games each fighter has had (equal across the pool in a clean
  // swiss; byes count as a game). Use the minimum to avoid over-advancing.
  const games = new Map<string, number>(ids.map(x => [x, 0]))
  for (const m of swissMatches) {
    games.set(m.fighter1Id, (games.get(m.fighter1Id) ?? 0) + 1)
    if (m.fighter2Id && idSet.has(m.fighter2Id)) games.set(m.fighter2Id, (games.get(m.fighter2Id) ?? 0) + 1)
  }
  const roundsPlayed = Math.min(...games.values())
  if (phase.rounds != null && roundsPlayed >= phase.rounds) {
    throw new Error('Все туры швейцарки уже сыграны.')
  }

  const played = new Set(
    swissMatches.filter(m => !isByeMatch(m)).map(m => pairKey(m.fighter1Id, m.fighter2Id!))
  )
  const hadBye = new Set(swissMatches.filter(isByeMatch).map(m => m.fighter1Id))
  const roundNumber = roundsPlayed + 1

  // Round 1 ordered by seed; later rounds by current standings.
  let order = roundsPlayed === 0
    ? [...ids]
    : (standings ? standings.map(s => s.fighterId) : [...ids])

  // Odd pool → one fighter sits out with a bye.
  let bye: string | null = null
  if (order.length % 2 === 1) {
    bye = pickBye(order, hadBye, phase.pairing?.byePolicy ?? 'lowestRank')
    order = order.filter(x => x !== bye)
  }

  let pairs: [string, string][]
  if (roundsPlayed === 0) {
    pairs = firstRoundPairs(order, phase.pairing?.firstRound ?? 'fold')
  } else {
    const avoidRematch = phase.pairing?.avoidRematch ?? true
    const resolved = backtrackPairs(order, played, avoidRematch)
      // Fallback: if a rematch-free pairing is impossible, allow rematches.
      ?? backtrackPairs(order, played, false)
    if (!resolved) throw new Error('Не удалось составить пары для следующего тура.')
    pairs = resolved
  }
  return { roundNumber, pairs, bye }
}

// ── Shared slot label formatter ────────────────────────────────────────────
// Handles any phaseId.GroupLabel pattern (e.g. groups.A, groups1.A, groups2.B)
export function formatSlotLabel(source: string, rank: number, isDropdown = false): BracketSlot {
  const parts = source.split('.')
  if (parts.length === 2 && /^[A-Z]$/.test(parts[1])) {
    return { label: `Группа ${parts[1]}`, sublabel: `место ${rank}`, isDropdown }
  }
  return { label: source, sublabel: `место ${rank}`, isDropdown }
}

// ── Single Elimination ─────────────────────────────────────────────────────

// Mirrors backend GetSystemRounds() — used when YAML omits the `rounds` field.
function getSystemRounds(slotCount: number): Array<{ id: string; name: string }> {
  switch (slotCount) {
    case 2:  return [{ id: 'final',        name: 'Финал' }]
    case 4:  return [{ id: 'semiFinal',    name: 'Полуфинал' },    { id: 'final',         name: 'Финал' }]
    case 8:  return [{ id: 'quarterFinal', name: 'Четвертьфинал' }, { id: 'semiFinal',    name: 'Полуфинал' },    { id: 'final', name: 'Финал' }]
    case 16: return [{ id: 'roundOf16',    name: '1/8 финала' },   { id: 'quarterFinal', name: 'Четвертьфинал' }, { id: 'semiFinal', name: 'Полуфинал' }, { id: 'final', name: 'Финал' }]
    case 32: return [{ id: 'roundOf32',    name: '1/16 финала' },  { id: 'roundOf16',    name: '1/8 финала' },   { id: 'quarterFinal', name: 'Четвертьфинал' }, { id: 'semiFinal', name: 'Полуфинал' }, { id: 'final', name: 'Финал' }]
    default: return Array.from({ length: Math.round(Math.log2(slotCount)) }, (_, i) => ({
      id: `round${i + 1}`, name: `Раунд ${i + 1}`,
    }))
  }
}

// Раунды фазы singleElimination в порядке сетки: явные из YAML либо системные
// по числу слотов. Тот же список даёт `roundId` для размещений — мирроринг
// FormatRoundCatalog.SingleEliminationRoundIds на бэке.
interface SEPhaseShape {
  seeding?: { slots?: Array<{ source: string; rank: number }> }
  rounds?: Array<{ id: string; name: string }>
}

export function seRounds(phase: TournamentFormat['phases'][0]): Array<{ id: string; name: string }> {
  const p = phase as unknown as SEPhaseShape
  const slots = p.seeding?.slots ?? []
  return (p.rounds && p.rounds.length > 0) ? p.rounds : getSystemRounds(slots.length)
}

export function buildBracketRounds(
  phase: TournamentFormat['phases'][0] & { type: 'singleElimination' },
  resolvedIds?: (string | null)[],
  participants?: TournamentParticipant[],
  allMatches?: StandingsMatch[],   // singles Matches or mapped team Encounters
  placements?: MatchPlacement[],
): BracketRoundData[] {
  const p = phase as any
  const slots: Array<{ source: string; rank: number }> = p.seeding?.slots ?? []
  const rounds = seRounds(phase)

  const getName = (fid: string | null): string | null => {
    if (!fid || !participants) return null
    const pt = participants.find(x => x.participantId === fid)
    return pt ? participantName(pt) : null
  }

  const lookup = createCellLookup(phase.id, allMatches, placements)

  // currentIds[i] = fighterId for i-th slot of the current round (null = not yet known)
  let currentIds: (string | null)[] = resolvedIds
    ? [...resolvedIds]
    : Array(slots.length).fill(null)

  return rounds.map((round, ri) => {
    const matchCount = Math.max(1, slots.length / Math.pow(2, ri + 1))
    const nextIds: (string | null)[] = []

    const matches: BracketMatchData[] = Array.from({ length: matchCount }, (_, i) => {
      let topId = currentIds[i * 2] ?? null
      let bottomId = currentIds[i * 2 + 1] ?? null

      const m = lookup.find(round.id, i, topId, bottomId)

      // Ячейка занята, а посадка не резолвится (посев ещё/уже не считается) —
      // участников показываем по самой встрече: она уже создана и авторитетна.
      if (m && !topId && !bottomId) {
        topId = m.fighter1Id
        bottomId = m.fighter2Id ?? null
      }

      // Winner feeds into the next round slot
      const winnerId: string | null =
        m?.status === 'Completed' && m.winnerId ? m.winnerId : null
      nextIds.push(winnerId)

      const topName = getName(topId)
      const bottomName = getName(bottomId)

      if (ri === 0 && slots.length > 0) {
        return {
          top: topName ? { label: topName } : formatSlotLabel(slots[i * 2]?.source ?? '?', slots[i * 2]?.rank ?? 1),
          bottom: bottomName ? { label: bottomName } : formatSlotLabel(slots[i * 2 + 1]?.source ?? '?', slots[i * 2 + 1]?.rank ?? 1),
        }
      }
      return {
        top: topName ? { label: topName } : { label: 'Победитель' },
        bottom: bottomName ? { label: bottomName } : { label: 'Победитель' },
      }
    })

    currentIds = nextIds
    return { name: round.name, matches }
  })
}

// ── Double Elimination ─────────────────────────────────────────────────────
export interface DEPhase {
  id: string
  name: string
  type: 'doubleElimination'
  grandFinal: 'simple' | 'reset' | 'advantage'
  upperBracket: {
    slots: Array<{ source: string; rank: number; entersAt?: string }>
    rounds: Array<{ id: string; name: string }>
  }
  lowerBracket: {
    slots: Array<{ source: string; rank: number }>
    rounds: Array<{ id: string; name: string; dropdownsFrom?: string }>
  }
  overrides?: Array<{ roundId: string; roundDurationSeconds?: number }>
}

// ── Гранд-финал DE: серия до двух побед (АР-15, инварианты 37-40) ───────────
// Отдельной сущности серии нет: гранд-финал — это одна или две обычные встречи
// в ячейках `grandFinal#0` и `grandFinalReset#0`, а счёт серии вычисляется, не
// хранится.
//
// `reset` и `advantage` дают ОДИН И ТОТ ЖЕ граф встреч (спека формата §4.8):
// победитель верхней сетки входит со счётом 1:0 и ему достаточно одной победы,
// победитель нижней обязан выиграть оба матча. Различие — только в подписи:
// `advantage` показывает счёт серии, `reset` — названия матчей. Форы по счёту
// ВНУТРИ боя нет и быть не может: `score1/score2` считаются из сходов, стартовый
// счёт хранить негде (АР-15, ТЗ §5.5) — гандикап отыгрывается тем, что
// представителю UB хватает одной победы.
export type GrandFinalMode = DEPhase['grandFinal']

export type GrandFinalRoundId = typeof GRAND_FINAL_ROUND_ID | typeof GRAND_FINAL_RESET_ROUND_ID

export interface GrandFinalCreate {
  roundId: GrandFinalRoundId
  slotIndex: number
  fighter1Id: string   // всегда представитель верхней сетки
  fighter2Id: string   // всегда представитель нижней сетки
}

export type GrandFinalState =
  | 'waiting'      // сетки не доиграны — пара гранд-финала ещё неизвестна
  | 'toCreate'     // есть что создать (`next`)
  | 'inProgress'   // встреча создана, победителя пока нет
  | 'completed'    // чемпион определён (инвариант 40)

export interface GrandFinalSeries<M> {
  mode: GrandFinalMode
  /** `reset` | `advantage` — серия до двух побед с форой верхней сетки. */
  isSeries: boolean
  ubWinnerId: string | null
  lbWinnerId: string | null
  gf?: M       // ячейка `grandFinal#0`
  reset?: M    // ячейка `grandFinalReset#0`
  /** Гранд-финал выиграл представитель нижней сетки → нужен второй матч (инвариант 39). */
  resetRequired: boolean
  /** Счёт серии `[UB, LB]`. В серии стартует 1:0, в `simple` — 0:0. */
  score: [number, number]
  championId: string | null
  next: GrandFinalCreate | null
  state: GrandFinalState
}

type DecidableMatch = PlaceableMatch & Pick<Match, 'status' | 'winnerId'>

const decidedWinner = (m: DecidableMatch | undefined): string | null =>
  m && (m.status === 'Completed' || m.status === 'WalkoverWin') ? m.winnerId ?? null : null

export function resolveGrandFinalSeries<M extends DecidableMatch>(
  mode: GrandFinalMode,
  lookup: PhaseCellLookup<M>,
  ubWinnerId: string | null,
  lbWinnerId: string | null,
): GrandFinalSeries<M> {
  const isSeries = mode === 'reset' || mode === 'advantage'
  // Фора верхней сетки — это стартовый счёт СЕРИИ, а не очки внутри боя.
  const score: [number, number] = isSeries ? [1, 0] : [0, 0]

  if (!ubWinnerId || !lbWinnerId) {
    return {
      mode, isSeries, ubWinnerId, lbWinnerId,
      resetRequired: false, score, championId: null, next: null, state: 'waiting',
    }
  }

  // Строго по ячейке: в матче-сбросе та же пара, что и в гранд-финале, поэтому
  // резолв по паре подставил бы одну встречу в обе ячейки (дефект Д-2, docs/08).
  // Фолбэк по паре остаётся только для турниров без размещений (инвариант 46);
  // там матч-сброс не создаётся, подменять нечего.
  const gf = lookup.placed
    ? lookup.at(GRAND_FINAL_ROUND_ID, 0)
    : lookup.find(GRAND_FINAL_ROUND_ID, 0, ubWinnerId, lbWinnerId)
  const reset = lookup.placed ? lookup.at(GRAND_FINAL_RESET_ROUND_ID, 0) : undefined

  const gfWinner = decidedWinner(gf)
  const resetWinner = decidedWinner(reset)

  if (gfWinner === ubWinnerId) score[0]++
  else if (gfWinner === lbWinnerId) score[1]++
  if (resetWinner === ubWinnerId) score[0]++
  else if (resetWinner === lbWinnerId) score[1]++

  // Инвариант 39: матч-сброс — тогда и только тогда, когда гранд-финал выиграл
  // представитель нижней сетки.
  const resetRequired = isSeries && gfWinner != null && gfWinner === lbWinnerId
  // Инвариант 40: чемпион — победитель гранд-финала, если он из верхней сетки;
  // иначе победитель матча-сброса.
  const championId = isSeries
    ? (gfWinner === ubWinnerId ? ubWinnerId : resetWinner)
    : gfWinner

  let next: GrandFinalCreate | null = null
  if (!gf) {
    next = { roundId: GRAND_FINAL_ROUND_ID, slotIndex: 0, fighter1Id: ubWinnerId, fighter2Id: lbWinnerId }
  } else if (resetRequired && !reset && lookup.placed) {
    // Только в размещённой фазе: без ячеек матч-сброс неотличим от самого
    // гранд-финала (та же пара подряд) — старый турнир остаётся без него.
    next = { roundId: GRAND_FINAL_RESET_ROUND_ID, slotIndex: 0, fighter1Id: ubWinnerId, fighter2Id: lbWinnerId }
  }

  return {
    mode, isSeries, ubWinnerId, lbWinnerId, gf, reset, resetRequired, score, championId, next,
    state: next ? 'toCreate' : championId ? 'completed' : 'inProgress',
  }
}

// Сообщение генератора, когда создавать нечего: «Нет встреч для генерации»
// одинаково звучит и для недоигранного полуфинала, и для уже определённого
// чемпиона. null = гранд-финалу сказать нечего, вызывающий даёт общий текст.
export function grandFinalHint<M extends DecidableMatch>(
  series: GrandFinalSeries<M>,
  nameOf: (participantId: string) => string,
): string | null {
  if (series.state === 'waiting' || series.state === 'toCreate') return null

  const scoreText = series.isSeries ? ` Счёт серии ${series.score[0]}:${series.score[1]}.` : ''

  if (series.championId) {
    return series.isSeries
      ? `Серия гранд-финала сыграна.${scoreText} Чемпион — ${nameOf(series.championId)}.`
      : `Гранд-финал сыгран. Чемпион — ${nameOf(series.championId)}.`
  }
  if (series.reset && !decidedWinner(series.reset)) {
    return series.reset.status === 'Completed'
      ? 'Матч-сброс завершён без победителя — проставьте результат, иначе чемпион не определяется.'
      : `Матч-сброс создан, но ещё не сыгран.${scoreText}`
  }
  if (series.resetRequired && !series.reset) {
    return 'Гранд-финал выиграл представитель нижней сетки — нужен матч-сброс, но фаза не размещена ' +
           'в ячейках сетки (турнир создан до размещений). Заведите второй матч вручную.'
  }
  if (series.gf) {
    return series.gf.status === 'Completed'
      ? 'Гранд-финал завершён без победителя — проставьте результат, иначе чемпион не определяется.'
      : `Гранд-финал создан, но ещё не сыгран.${scoreText}`
  }
  return null
}

// Computes match count per UB round using the same round-by-round logic as the backend validator.
// directSlots (no entersAt) enter round 1; bye slots (entersAt) enter the named round.
// Match count = winners = losers for each round (used by buildLBRounds for dropdown sizing).
function computeUBMatchCounts(phase: DEPhase): Record<string, number> {
  const { slots, rounds } = phase.upperBracket
  if (rounds.length === 0) return {}

  const byeCountByRound: Record<string, number> = {}
  let directCount = 0
  for (const slot of slots) {
    if (slot.entersAt) byeCountByRound[slot.entersAt] = (byeCountByRound[slot.entersAt] ?? 0) + 1
    else directCount++
  }

  const counts: Record<string, number> = {}
  let prevWinners = Math.floor(directCount / 2)
  counts[rounds[0].id] = prevWinners

  for (let i = 1; i < rounds.length; i++) {
    const roundId = rounds[i].id
    prevWinners = Math.floor((prevWinners + (byeCountByRound[roundId] ?? 0)) / 2)
    counts[roundId] = prevWinners
  }
  return counts
}

export function buildUBRounds(
  phase: DEPhase,
  resolvedPairs?: ([string | null, string | null])[][],
  participants?: TournamentParticipant[],
): DEBracketRound[] {
  const { slots, rounds } = phase.upperBracket

  const directSlots = slots.filter(s => !s.entersAt)
  const byesByRound: Record<string, typeof slots> = {}
  for (const slot of slots) {
    if (slot.entersAt) {
      if (!byesByRound[slot.entersAt]) byesByRound[slot.entersAt] = []
      byesByRound[slot.entersAt].push(slot)
    }
  }

  const ubMatchCounts = computeUBMatchCounts(phase)

  const getName = (fid: string | null): string | null => {
    if (!fid || !participants) return null
    const pt = participants.find(x => x.participantId === fid)
    return pt ? participantName(pt) : null
  }

  return rounds.map((round, ri) => {
    const matchCount = ubMatchCounts[round.id] ?? 1
    const byes = byesByRound[round.id] ?? []
    const prevRoundName = ri > 0 ? rounds[ri - 1].name : ''

    const matches: BracketMatchData[] = Array.from({ length: matchCount }, (_, i) => {
      const rp = resolvedPairs?.[ri]?.[i]
      const topName = getName(rp?.[0] ?? null)
      const botName = getName(rp?.[1] ?? null)

      if (ri === 0) {
        const topFallback = formatSlotLabel(directSlots[i * 2]?.source ?? '?', directSlots[i * 2]?.rank ?? 1)
        const botFallback = formatSlotLabel(directSlots[i * 2 + 1]?.source ?? '?', directSlots[i * 2 + 1]?.rank ?? 1)
        return {
          top:    topName ? { label: topName } : topFallback,
          bottom: botName ? { label: botName } : botFallback,
        }
      }
      if (byes[i]) {
        const byeSlot = { ...formatSlotLabel(byes[i].source, byes[i].rank), isBye: true }
        return {
          top:    topName ? { label: topName } : { label: `Победитель ${prevRoundName}` },
          bottom: botName ? { ...byeSlot, label: botName } : byeSlot,
        }
      }
      return {
        top:    topName ? { label: topName } : { label: 'Победитель UB' },
        bottom: botName ? { label: botName } : { label: 'Победитель UB' },
      }
    })

    return { name: round.name, matches, isDropout: false }
  })
}

// ── Group standings ────────────────────────────────────────────────────────
export interface GroupStanding {
  fighterId: string
  points: number
  scoreDiff: number
  wins: number
  draws: number
  losses: number
}

// Standings are computed from anything that looks like a head-to-head result:
// singles Matches, or team Encounters mapped via `encountersToStandingsMatches`.
// `id` нужен для резолва по ячейке: размещение ссылается на встречу по id.
export type StandingsMatch = Pick<Match, 'id' | 'fighter1Id' | 'fighter2Id' | 'status' | 'score1' | 'score2' | 'winnerId'>

// Maps team Encounters onto the StandingsMatch shape so the same round-robin
// standings logic works for team group stages (team id ↔ participant id, the
// encounter aggregate score ↔ match score, winnerParticipantId ↔ winnerId).
// Размещений у серий нет (бэкенд размещает только `Match`), поэтому командные
// фазы остаются на резолве по паре — как турниры без размещений.
export function encountersToStandingsMatches(encounters: Encounter[]): StandingsMatch[] {
  return encounters.map(e => ({
    id: e.id,
    fighter1Id: e.participant1Id,
    fighter2Id: e.participant2Id,
    status: e.status,
    score1: e.score1,
    score2: e.score2,
    winnerId: e.winnerParticipantId,
  }))
}

export function calculateGroupStandings(
  rrPhase: TournamentFormat['phases'][0],
  groupAssignments: GroupAssignment[],
  allMatches: StandingsMatch[],
): GroupStanding[][] {
  const p = rrPhase as any
  const ppm = p.pointsPerMatch as { win: number; draw: number; loss: number }
  const tieBreakers: string[] = p.tieBreakers ?? ['random']

  return groupAssignments.map(group => {
    const ids = new Set(group.participants.map(x => x.fighterId))
    const map = new Map<string, GroupStanding>()
    for (const { fighterId } of group.participants) {
      map.set(fighterId, { fighterId, points: 0, scoreDiff: 0, wins: 0, draws: 0, losses: 0 })
    }

    for (const match of allMatches) {
      // Bye / walkover (no opponent): a win for fighter1, score difference untouched.
      if (match.fighter2Id == null) {
        if (match.status !== 'WalkoverWin' && match.status !== 'Completed') continue
        if (!ids.has(match.fighter1Id)) continue
        const sb = map.get(match.fighter1Id)!
        sb.points += ppm.win
        sb.wins++
        continue
      }

      if (match.status !== 'Completed') continue
      if (!ids.has(match.fighter1Id) || !ids.has(match.fighter2Id)) continue

      const s1 = map.get(match.fighter1Id)!
      const s2 = map.get(match.fighter2Id)!
      s1.scoreDiff += match.score1 - match.score2
      s2.scoreDiff += match.score2 - match.score1

      if (match.winnerId === match.fighter1Id) {
        s1.points += ppm.win; s1.wins++
        s2.points += ppm.loss; s2.losses++
      } else if (match.winnerId === match.fighter2Id) {
        s1.points += ppm.loss; s1.losses++
        s2.points += ppm.win; s2.wins++
      } else {
        s1.points += ppm.draw; s1.draws++
        s2.points += ppm.draw; s2.draws++
      }
    }

    const standings = [...map.values()]

    return standings.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      for (const tb of tieBreakers) {
        if (tb === 'scoreDifference' && b.scoreDiff !== a.scoreDiff) {
          return b.scoreDiff - a.scoreDiff
        }
        if (tb === 'random') {
          // Use fighterId as stable tiebreaker so bracket ordering is consistent across renders
          return a.fighterId < b.fighterId ? -1 : a.fighterId > b.fighterId ? 1 : 0
        }
      }
      return 0
    })
  })
}

// ── Playoff slot resolution ────────────────────────────────────────────────
// Maps singleElimination seeding slots to fighterIds using group standings.
// Returns null for unresolved slots (e.g. not enough completed matches).
export function resolvePlayoffSlots(
  sePhase: TournamentFormat['phases'][0],
  groupStandings: GroupStanding[][],
): (string | null)[] {
  const p = sePhase as any
  const slots: Array<{ source: string; rank: number }> = p.seeding?.slots ?? []
  return slots.map(slot => {
    const parts = slot.source.split('.')
    if (parts.length < 2) return null
    const groupIdx = parts[1].charCodeAt(0) - 65  // 'A' → 0, 'B' → 1, …
    return groupStandings[groupIdx]?.[slot.rank - 1]?.fighterId ?? null
  })
}

export function resolveDERoundPairs(
  phase: DEPhase,
  groupStandings: GroupStanding[][],
  allMatches: Match[],
  placements?: MatchPlacement[],
): {
  ubPairs: ([string | null, string | null])[][]
  lbPairs: ([string | null, string | null])[][]
  grandFinal: GrandFinalSeries<Match>
} {
  type Pair = [string | null, string | null]
  const { slots: ubSlots, rounds: ubRounds } = phase.upperBracket
  const { slots: lbSlots, rounds: lbRounds } = phase.lowerBracket

  const resolveSlot = (source: string, rank: number): string | null => {
    const parts = source.split('.')
    if (parts.length < 2) return null
    const groupIdx = parts[1].charCodeAt(0) - 65
    return groupStandings[groupIdx]?.[rank - 1]?.fighterId ?? null
  }

  // Резолв по ячейке: в DE переигровки штатны (одногруппники в UB и LB,
  // гранд-финал и матч-сброс — та же пара подряд), поэтому пара как
  // идентификатор здесь ломается структурно.
  const lookup = createCellLookup(phase.id, allMatches, placements)

  const matchWinner = (roundId: string, slot: number, f1: string, f2: string): string | null => {
    const m = lookup.find(roundId, slot, f1, f2)
    return m?.status === 'Completed' && m.winnerId ? m.winnerId : null
  }

  const matchLoser = (roundId: string, slot: number, f1: string, f2: string): string | null => {
    const m = lookup.find(roundId, slot, f1, f2)
    if (m?.status === 'Completed' && m.winnerId)
      return (m.fighter1Id === m.winnerId ? m.fighter2Id : m.fighter1Id) ?? null
    return null
  }

  const ubDirectSlots = ubSlots.filter(s => !s.entersAt).map(s => resolveSlot(s.source, s.rank))
  const ubByesByRound: Record<string, (string | null)[]> = {}
  for (const s of ubSlots.filter(s => s.entersAt)) {
    if (!ubByesByRound[s.entersAt!]) ubByesByRound[s.entersAt!] = []
    ubByesByRound[s.entersAt!].push(resolveSlot(s.source, s.rank))
  }
  const lbDirectSlots = lbSlots.map(s => resolveSlot(s.source, s.rank))

  const hasRoundMatches = (pairs: Pair[], roundId: string): boolean =>
    pairs.some(([f1, f2], i) => !!lookup.find(roundId, i, f1, f2))

  const ubPairs: Pair[][] = []
  {
    const r0: Pair[] = []
    for (let i = 0; i + 1 < ubDirectSlots.length; i += 2)
      r0.push([ubDirectSlots[i], ubDirectSlots[i + 1]])
    // Only resolve names if UB first-round matches actually exist in the DB
    if (ubRounds.length > 0 && hasRoundMatches(r0, ubRounds[0].id)) {
      ubPairs.push(r0)
      for (let ri = 1; ri < ubRounds.length; ri++) {
        const byes = ubByesByRound[ubRounds[ri].id] ?? []
        const prevWinners = ubPairs[ri - 1].map(([f1, f2], i) =>
          (f1 && f2) ? matchWinner(ubRounds[ri - 1].id, i, f1, f2) : null)
        let pairs: Pair[]
        if (byes.length > 0) {
          pairs = prevWinners.map((w, idx) => [w, byes[idx] ?? null] as Pair)
        } else {
          pairs = []
          for (let i = 0; i + 1 < prevWinners.length; i += 2)
            pairs.push([prevWinners[i], prevWinners[i + 1]])
        }
        ubPairs.push(pairs)
      }
    }
  }

  const lbPairs: Pair[][] = []
  {
    const r0: Pair[] = []
    for (let i = 0; i + 1 < lbDirectSlots.length; i += 2)
      r0.push([lbDirectSlots[i], lbDirectSlots[i + 1]])
    // Only resolve names if LB first-round matches actually exist in the DB
    if (lbRounds.length > 0 && hasRoundMatches(r0, lbRounds[0].id)) {
      lbPairs.push(r0)
      for (let ri = 1; ri < lbRounds.length; ri++) {
        const round = lbRounds[ri]
        const prevWinners = lbPairs[ri - 1].map(([f1, f2], i) =>
          (f1 && f2) ? matchWinner(lbRounds[ri - 1].id, i, f1, f2) : null)
        let slotsForRound: (string | null)[] = [...prevWinners]
        if (round.dropdownsFrom) {
          const ubRi = ubRounds.findIndex(r => r.id === round.dropdownsFrom)
          if (ubRi >= 0 && ubPairs[ubRi]) {
            const losers = ubPairs[ubRi].map(([f1, f2], i) =>
              (f1 && f2) ? matchLoser(ubRounds[ubRi].id, i, f1, f2) : null)
            slotsForRound = []
            for (let i = 0; i < prevWinners.length; i++) {
              slotsForRound.push(prevWinners[i])
              slotsForRound.push(losers[i] ?? null)
            }
          }
        }
        const pairs: Pair[] = []
        for (let i = 0; i + 1 < slotsForRound.length; i += 2)
          pairs.push([slotsForRound[i], slotsForRound[i + 1]])
        lbPairs.push(pairs)
      }
    }
  }

  // Гранд-финал сводит победителей финалов обеих сеток. Раунды сеток
  // заполняются только до тех пор, пока их встречи существуют, поэтому пустой
  // хвост `ubPairs`/`lbPairs` сам по себе значит «финал ещё не сыгран».
  const bracketFinalWinner = (rounds: Array<{ id: string }>, pairs: Pair[][]): string | null => {
    const last = rounds.length - 1
    if (last < 0 || pairs.length <= last) return null
    const pair = pairs[last][0]
    const m = lookup.find(rounds[last].id, 0, pair?.[0], pair?.[1])
    return m?.status === 'Completed' && m.winnerId ? m.winnerId : null
  }

  const grandFinal = resolveGrandFinalSeries(
    phase.grandFinal,
    lookup,
    bracketFinalWinner(ubRounds, ubPairs),
    bracketFinalWinner(lbRounds, lbPairs),
  )

  return { ubPairs, lbPairs, grandFinal }
}

export function buildLBRounds(
  phase: DEPhase,
  resolvedPairs?: ([string | null, string | null])[][],
  participants?: TournamentParticipant[],
): DEBracketRound[] {
  const { slots, rounds } = phase.lowerBracket

  const ubMatchCounts = computeUBMatchCounts(phase)

  const getName = (fid: string | null): string | null => {
    if (!fid || !participants) return null
    const pt = participants.find(x => x.participantId === fid)
    return pt ? participantName(pt) : null
  }

  let currentWinners = slots.length
  return rounds.map((round, ri) => {
    const isDropout = !!round.dropdownsFrom
    const dropFromRoundName = round.dropdownsFrom
      ? (phase.upperBracket.rounds.find(r => r.id === round.dropdownsFrom)?.name ?? round.dropdownsFrom)
      : undefined
    const dropCount = round.dropdownsFrom ? (ubMatchCounts[round.dropdownsFrom] ?? 0) : 0

    const matchCount = Math.max(1, (currentWinners + dropCount) / 2)
    currentWinners = matchCount

    const matches: BracketMatchData[] = Array.from({ length: matchCount }, (_, i) => {
      const rp = resolvedPairs?.[ri]?.[i]
      const topName = getName(rp?.[0] ?? null)
      const botName = getName(rp?.[1] ?? null)

      if (ri === 0 && slots.length > 0) {
        const topFallback = formatSlotLabel(slots[i * 2]?.source ?? '?', slots[i * 2]?.rank ?? 1)
        const botFallback = formatSlotLabel(slots[i * 2 + 1]?.source ?? '?', slots[i * 2 + 1]?.rank ?? 1)
        return {
          top:    topName ? { label: topName } : topFallback,
          bottom: botName ? { label: botName } : botFallback,
        }
      }
      if (isDropout) {
        return {
          top:    topName ? { label: topName } : { label: 'Победитель LB' },
          bottom: botName
            ? { label: botName, isDropdown: true }
            : { label: `↓ из ${dropFromRoundName ?? 'UB'}`, isDropdown: true },
        }
      }
      return {
        top:    topName ? { label: topName } : { label: 'Победитель LB' },
        bottom: botName ? { label: botName } : { label: 'Победитель LB' },
      }
    })

    return { name: round.name, matches, isDropout, dropFromRoundName }
  })
}
