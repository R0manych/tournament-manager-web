import type { TournamentFormat, TournamentParticipant, Match } from '../../api/types'

export interface GroupAssignment {
  groupIndex: number
  groupLabel: string
  participants: Array<{ fighterId: string; seed: number; name: string }>
}

export interface BracketSlot {
  label: string
  sublabel?: string
  isDropdown?: boolean
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
      fighterId: p.fighterId,
      seed: p.seed ?? idx + 1,
      name: `${p.firstName} ${p.lastName}`,
    })
  })

  return groups
}

// ── Shared slot label formatter ────────────────────────────────────────────
export function formatSlotLabel(source: string, rank: number, isDropdown = false): BracketSlot {
  const parts = source.split('.')
  if (parts[0] === 'groups' && parts[1]) {
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

export function buildBracketRounds(
  phase: TournamentFormat['phases'][0] & { type: 'singleElimination' },
  resolvedIds?: (string | null)[],
  participants?: TournamentParticipant[],
  allMatches?: Match[],
): BracketRoundData[] {
  const p = phase as any
  const slots: Array<{ source: string; rank: number }> = p.seeding?.slots ?? []
  const rounds: Array<{ id: string; name: string }> =
    (p.rounds && p.rounds.length > 0) ? p.rounds : getSystemRounds(slots.length)

  const getName = (fid: string | null): string | null => {
    if (!fid || !participants) return null
    const pt = participants.find(x => x.fighterId === fid)
    return pt ? `${pt.firstName} ${pt.lastName}` : null
  }

  const findMatch = (f1: string, f2: string) =>
    allMatches?.find(m =>
      (m.fighter1Id === f1 && m.fighter2Id === f2) ||
      (m.fighter1Id === f2 && m.fighter2Id === f1)
    )

  // currentIds[i] = fighterId for i-th slot of the current round (null = not yet known)
  let currentIds: (string | null)[] = resolvedIds
    ? [...resolvedIds]
    : Array(slots.length).fill(null)

  return rounds.map((round, ri) => {
    const matchCount = Math.max(1, slots.length / Math.pow(2, ri + 1))
    const nextIds: (string | null)[] = []

    const matches: BracketMatchData[] = Array.from({ length: matchCount }, (_, i) => {
      const topId = currentIds[i * 2] ?? null
      const bottomId = currentIds[i * 2 + 1] ?? null

      // Winner feeds into the next round slot
      let winnerId: string | null = null
      if (topId && bottomId) {
        const m = findMatch(topId, bottomId)
        if (m?.status === 'Completed' && m.winnerId) winnerId = m.winnerId
      }
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
  grandFinal: 'simple' | 'reset'
  upperBracket: {
    slots: Array<{ source: string; rank: number }>
    rounds: Array<{ id: string; name: string }>
  }
  lowerBracket: {
    slots: Array<{ source: string; rank: number }>
    rounds: Array<{ id: string; name: string; dropdownsFrom?: string }>
  }
  overrides?: Array<{ roundId: string; roundsPerMatch?: number; roundDurationSeconds?: number }>
}

export function buildUBRounds(phase: DEPhase): BracketRoundData[] {
  const { slots, rounds } = phase.upperBracket
  return rounds.map((round, ri) => {
    const matchCount = Math.max(1, slots.length / Math.pow(2, ri + 1))
    const matches: BracketMatchData[] = Array.from({ length: matchCount }, (_, i) => {
      if (ri === 0 && slots.length > 0) {
        return {
          top: formatSlotLabel(slots[i * 2]?.source ?? '?', slots[i * 2]?.rank ?? 1),
          bottom: formatSlotLabel(slots[i * 2 + 1]?.source ?? '?', slots[i * 2 + 1]?.rank ?? 1),
        }
      }
      return { top: { label: 'Победитель UB' }, bottom: { label: 'Победитель UB' } }
    })
    return { name: round.name, matches }
  })
}

// ── Group standings ────────────────────────────────────────────────────────
export interface GroupStanding {
  fighterId: string
  points: number
  scoreDiff: number
}

export function calculateGroupStandings(
  rrPhase: TournamentFormat['phases'][0],
  groupAssignments: GroupAssignment[],
  allMatches: Match[],
): GroupStanding[][] {
  const p = rrPhase as any
  const ppm = p.pointsPerMatch as { win: number; draw: number; loss: number }
  const tieBreakers: string[] = p.tieBreakers ?? ['random']

  return groupAssignments.map(group => {
    const ids = new Set(group.participants.map(x => x.fighterId))
    const map = new Map<string, GroupStanding>()
    for (const { fighterId } of group.participants) {
      map.set(fighterId, { fighterId, points: 0, scoreDiff: 0 })
    }

    for (const match of allMatches) {
      if (!ids.has(match.fighter1Id) || !ids.has(match.fighter2Id)) continue
      if (match.status !== 'Completed') continue

      const s1 = map.get(match.fighter1Id)!
      const s2 = map.get(match.fighter2Id)!
      s1.scoreDiff += match.score1 - match.score2
      s2.scoreDiff += match.score2 - match.score1

      if (match.winnerId === match.fighter1Id) {
        s1.points += ppm.win; s2.points += ppm.loss
      } else if (match.winnerId === match.fighter2Id) {
        s1.points += ppm.loss; s2.points += ppm.win
      } else {
        s1.points += ppm.draw; s2.points += ppm.draw
      }
    }

    const standings = [...map.values()]
    const randomOrder = new Map(standings.map(s => [s.fighterId, Math.random()]))

    return standings.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      for (const tb of tieBreakers) {
        if (tb === 'scoreDifference' && b.scoreDiff !== a.scoreDiff) {
          return b.scoreDiff - a.scoreDiff
        }
        if (tb === 'random') {
          return randomOrder.get(a.fighterId)! - randomOrder.get(b.fighterId)!
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

export function buildLBRounds(phase: DEPhase): DEBracketRound[] {
  const { slots, rounds } = phase.lowerBracket
  const { upperBracket } = phase

  // Количество матчей в каждом раунде UB (для расчёта числа дропов)
  const ubMatchCounts: Record<string, number> = {}
  upperBracket.rounds.forEach((r, ri) => {
    ubMatchCounts[r.id] = Math.max(1, upperBracket.slots.length / Math.pow(2, ri + 1))
  })

  let currentWinners = slots.length
  return rounds.map((round, ri) => {
    const isDropout = !!round.dropdownsFrom
    const dropFromRoundName = round.dropdownsFrom
      ? (upperBracket.rounds.find(r => r.id === round.dropdownsFrom)?.name ?? round.dropdownsFrom)
      : undefined
    const dropCount = round.dropdownsFrom ? (ubMatchCounts[round.dropdownsFrom] ?? 0) : 0

    const matchCount = Math.max(1, (currentWinners + dropCount) / 2)
    currentWinners = matchCount

    const matches: BracketMatchData[] = Array.from({ length: matchCount }, (_, i) => {
      if (ri === 0 && slots.length > 0) {
        return {
          top: formatSlotLabel(slots[i * 2]?.source ?? '?', slots[i * 2]?.rank ?? 1),
          bottom: formatSlotLabel(slots[i * 2 + 1]?.source ?? '?', slots[i * 2 + 1]?.rank ?? 1),
        }
      }
      if (isDropout) {
        return {
          top: { label: 'Победитель LB' },
          bottom: { label: `↓ из ${dropFromRoundName ?? 'UB'}`, isDropdown: true },
        }
      }
      return { top: { label: 'Победитель LB' }, bottom: { label: 'Победитель LB' } }
    })

    return { name: round.name, matches, isDropout, dropFromRoundName }
  })
}
