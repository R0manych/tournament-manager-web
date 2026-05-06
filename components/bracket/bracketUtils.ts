import type { TournamentFormat, TournamentParticipant } from '../../api/types'

export interface GroupAssignment {
  groupIndex: number
  groupLabel: string
  participants: Array<{ seed: number; name: string }>
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
export function buildBracketRounds(
  phase: TournamentFormat['phases'][0] & { type: 'singleElimination' },
): BracketRoundData[] {
  const p = phase as any
  const slots: Array<{ source: string; rank: number }> = p.seeding?.slots ?? []
  const rounds: Array<{ id: string; name: string }> = p.rounds ?? []

  return rounds.map((round, ri) => {
    const matchCount = Math.max(1, slots.length / Math.pow(2, ri + 1))
    const matches: BracketMatchData[] = Array.from({ length: matchCount }, (_, i) => {
      if (ri === 0 && slots.length > 0) {
        return {
          top: formatSlotLabel(slots[i * 2]?.source ?? '?', slots[i * 2]?.rank ?? 1),
          bottom: formatSlotLabel(slots[i * 2 + 1]?.source ?? '?', slots[i * 2 + 1]?.rank ?? 1),
        }
      }
      return { top: { label: 'Победитель' }, bottom: { label: 'Победитель' } }
    })
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
