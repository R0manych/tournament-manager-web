import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { tournamentsApi } from '../api/tournaments'
import { matchesApi } from '../api/matches'
import { encountersApi } from '../api/encounters'
import { teamsApi } from '../api/teams'
import { fightersApi } from '../api/fighters'
import type { TournamentStatus } from '../api/types'
import { participantName, participantClub } from '../api/types'
import TournamentFormatSection from '../components/TournamentFormatSection'
import TeamsSection from '../components/TeamsSection'
import EncountersSection from '../components/EncountersSection'
import { assignGroups, buildSwissPool, calculateGroupStandings, encountersToStandingsMatches, planSwissNextRound, resolvePlayoffSlots } from '../components/bracket/bracketUtils'

const STATUS_LABELS: Record<TournamentStatus, string> = {
  Draft: 'Черновик',
  Active: 'Активен',
  Completed: 'Завершён',
  Cancelled: 'Отменён',
}

const STATUS_TRANSITIONS: Record<TournamentStatus, { status: TournamentStatus; label: string }[]> = {
  Draft:     [{ status: 'Active', label: '▶ Начать' }, { status: 'Cancelled', label: '✕ Отменить' }],
  Active:    [{ status: 'Completed', label: '✓ Завершить' }, { status: 'Cancelled', label: '✕ Отменить' }],
  Completed: [{ status: 'Active', label: '↩ Вернуть в активные' }],
  Cancelled: [{ status: 'Draft', label: '↩ Восстановить' }],
}

// ── Test-data pools (random teams/fighters) ────────────────────────────────
const FIRST_NAMES = ['Иван', 'Пётр', 'Алексей', 'Дмитрий', 'Сергей', 'Андрей', 'Михаил', 'Николай', 'Олег', 'Роман', 'Павел', 'Юрий']
const LAST_NAMES = ['Иванов', 'Петров', 'Смирнов', 'Кузнецов', 'Соколов', 'Попов', 'Лебедев', 'Козлов', 'Новиков', 'Морозов', 'Волков', 'Орлов']
const CLUB_NAMES = ['Сокол', 'Дружина', 'Гвардия', 'Легион', 'Викинг', 'Барс', 'Витязь', 'Орден']
const rnd = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

const TEST_BTN: React.CSSProperties = {
  fontSize: '0.8em', color: '#999', background: 'none',
  border: '1px dashed #ccc', borderRadius: 4, padding: '3px 10px', cursor: 'pointer',
}

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()

  const { data: tournament, isLoading } = useQuery({
    queryKey: ['tournaments', id],
    queryFn: () => tournamentsApi.get(id!),
    enabled: !!id,
  })

  const { data: allFighters } = useQuery({
    queryKey: ['fighters'],
    queryFn: () => fightersApi.list(),
  })

  const { data: format } = useQuery({
    queryKey: ['tournament-format', id],
    queryFn: () => tournamentsApi.format.get(id!),
    enabled: !!id,
    retry: (failureCount, error: unknown) =>
      (error as { status?: number })?.status !== 404 && failureCount < 2,
  })

  const { data: tournamentMatches } = useQuery({
    queryKey: ['tournament-matches', id],
    queryFn: () => matchesApi.listByTournament(id!),
    enabled: !!id,
  })

  // Team group standings score from encounters; loaded only for team tournaments.
  const { data: tournamentEncounters } = useQuery({
    queryKey: ['encounters', id],
    queryFn: () => encountersApi.listByTournament(id!),
    enabled: !!id && tournament?.participantKind === 'Team',
  })

  const statusMut = useMutation({
    mutationFn: (status: TournamentStatus) => tournamentsApi.setStatus(id!, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      qc.invalidateQueries({ queryKey: ['tournaments'] })
    },
  })

  const [selectedFighterId, setSelectedFighterId] = useState('')
  const [seed, setSeed] = useState('')

  useEffect(() => {
    if (tournament) setSeed(String(tournament.participants.length + 1))
  }, [tournament?.participants.length])

  const addParticipantMut = useMutation({
    mutationFn: () =>
      tournamentsApi.addParticipant(id!, selectedFighterId, seed ? +seed : undefined),
    onSuccess: () => {
      setSelectedFighterId('')
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
    },
  })

  const removeParticipantMut = useMutation({
    mutationFn: (fighterId: string) => tournamentsApi.removeParticipant(id!, fighterId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tournaments', id] }),
  })

  const generateMut = useMutation({
    mutationFn: async (phaseId: string) => {
      const phase = format!.phases.find(p => p.id === phaseId)!
      const groupAssignments = assignGroups(phase as any, tournament!.participants)

      // Team tournaments play each pair as an Encounter (series of bouts), not a
      // single flat match — generate one Encounter per in-group pair, idempotently.
      if (tournament!.participantKind === 'Team') {
        const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
        const existing = await encountersApi.listByTournament(id!)
        const existingPairs = new Set(existing.map(e => pairKey(e.participant1Id, e.participant2Id)))

        const toCreate: Array<[string, string]> = []
        let skipped = 0
        for (const group of groupAssignments) {
          const teamIds = group.participants.map(p => p.fighterId)
          for (let i = 0; i < teamIds.length; i++) {
            for (let j = i + 1; j < teamIds.length; j++) {
              if (existingPairs.has(pairKey(teamIds[i], teamIds[j]))) skipped++
              else toCreate.push([teamIds[i], teamIds[j]])
            }
          }
        }
        // Sequential keeps creation order deterministic (by group, then seed).
        // generate-bouts right after create so each new series is ready to judge.
        // Bout generation needs full rosters (3 per team); tolerate failures so
        // every pair still gets its Encounter — incomplete ones can generate later.
        let boutsFailed = 0
        for (const [p1, p2] of toCreate) {
          const enc = await encountersApi.create(id!, { participant1Id: p1, participant2Id: p2 })
          try {
            await encountersApi.generateBouts(enc.id)
          } catch {
            boutsFailed++
          }
        }
        return { created: toCreate.length, skipped, boutsFailed }
      }

      const groups = groupAssignments.map(g => g.participants.map(p => p.fighterId))
      return matchesApi.generateRoundRobin(id!, phaseId, groups)
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['tournament-matches', id] })
      qc.invalidateQueries({ queryKey: ['encounters', id] })
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      const failed = 'boutsFailed' in result ? result.boutsFailed : 0
      if (result.created > 0 || result.skipped > 0) {
        alert(
          `Создано: ${result.created}. Пропущено (уже существуют): ${result.skipped}.` +
          (failed > 0 ? `\nБои не сгенерированы для ${failed} встреч (укомплектуйте составы и сгенерируйте на странице встречи).` : '')
        )
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { problem?: { detail?: string } })?.problem?.detail ?? 'Ошибка генерации'
      alert(msg)
    },
  })

  const generatePlayoffMut = useMutation({
    mutationFn: async (phaseId: string) => {
      const sePhase = format!.phases.find(p => p.id === phaseId)!
      const p = sePhase as any
      const fromPhaseId: string = p.seeding?.from
      const rrPhase = format!.phases.find(ph => ph.id === fromPhaseId)!
      const groupAssignments = assignGroups(rrPhase as any, tournament!.participants)
      const groupStandings = calculateGroupStandings(rrPhase, groupAssignments, tournamentMatches ?? [])
      const slots = resolvePlayoffSlots(sePhase, groupStandings)

      if (slots.some(s => s === null)) {
        throw new Error('Не удалось определить всех участников плейофф. Убедитесь, что все бои группового этапа завершены.')
      }

      const allTournamentMatches = tournamentMatches ?? []
      const findMatch = (f1: string, f2: string) =>
        allTournamentMatches.find(m =>
          (m.fighter1Id === f1 && m.fighter2Id === f2) ||
          (m.fighter1Id === f2 && m.fighter2Id === f1)
        )

      const has3rdPlace: boolean = !!p.thirdPlaceMatch

      // Walk rounds until we find the next one to generate
      let currentSlots = slots as string[]
      let prevPairMatches: ReturnType<typeof findMatch>[] = []

      while (currentSlots.length >= 2) {
        const pairs: [string, string][] = []
        for (let i = 0; i + 1 < currentSlots.length; i += 2) {
          pairs.push([currentSlots[i], currentSlots[i + 1]])
        }

        const isFinalRound = currentSlots.length === 2
        const pairMatches = pairs.map(([f1, f2]) => findMatch(f1, f2))

        // Collect what needs to be created this iteration
        const creates: Array<[string, string]> = []
        for (let i = 0; i < pairs.length; i++) {
          if (!pairMatches[i]) creates.push(pairs[i])
        }

        // 3rd place match: generate alongside the final from semi-final losers
        if (isFinalRound && has3rdPlace && prevPairMatches.length >= 2) {
          const losers = prevPairMatches.slice(0, 2).map(m => {
            if (!m?.winnerId) return null
            return m.fighter1Id === m.winnerId ? m.fighter2Id : m.fighter1Id
          })
          if (losers[0] && losers[1] && !findMatch(losers[0], losers[1])) {
            creates.push([losers[0], losers[1]])
          }
        }

        if (creates.length > 0) {
          return Promise.all(creates.map(([f1, f2]) => matchesApi.create(id!, { fighter1Id: f1, fighter2Id: f2 })))
        }

        const incomplete = pairMatches.filter(m => m && m.status !== 'Completed').length
        if (incomplete > 0) {
          throw new Error(`В текущем раунде плейофф ещё ${incomplete} незавершённых боёв. Завершите их, чтобы сформировать следующий раунд.`)
        }

        if (isFinalRound) {
          // Check 3rd place match completion if applicable
          if (has3rdPlace && prevPairMatches.length >= 2) {
            const losers = prevPairMatches.slice(0, 2).map(m => {
              if (!m?.winnerId) return null
              return m.fighter1Id === m.winnerId ? m.fighter2Id : m.fighter1Id
            })
            if (losers[0] && losers[1]) {
              const thirdMatch = findMatch(losers[0], losers[1])
              if (thirdMatch && thirdMatch.status !== 'Completed') {
                throw new Error('Финал завершён, но матч за 3-е место ещё не сыгран.')
              }
            }
          }
          throw new Error('Плейофф уже полностью сыгран.')
        }

        // Advance to next round with winners
        const winners = pairMatches.map(m => m!.winnerId)
        if (winners.some(w => !w)) {
          throw new Error('Некоторые бои завершены без победителя. Проверьте результаты.')
        }
        prevPairMatches = pairMatches
        currentSlots = winners as string[]
      }

      throw new Error('Плейофф уже полностью сыгран.')
    },
    onSuccess: (results) => {
      qc.invalidateQueries({ queryKey: ['tournament-matches', id] })
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      alert(`Создано встреч: ${results.length}`)
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error
        ? err.message
        : ((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Ошибка генерации плейофф')
      alert(msg)
    },
  })

  // Team single-elimination playoff: mirrors generatePlayoffMut but resolves
  // standings from Encounters and creates Encounters (+ bouts) per pair, advancing
  // by winnerParticipantId. Generates the next not-yet-created round on each click.
  const generateTeamPlayoffMut = useMutation({
    mutationFn: async (phaseId: string) => {
      const sePhase = format!.phases.find(p => p.id === phaseId)!
      const p = sePhase as any
      const fromPhaseId: string = p.seeding?.from
      const rrPhase = format!.phases.find(ph => ph.id === fromPhaseId)!
      const groupAssignments = assignGroups(rrPhase as any, tournament!.participants)

      const encs = await encountersApi.listByTournament(id!)
      const groupStandings = calculateGroupStandings(rrPhase, groupAssignments, encountersToStandingsMatches(encs))
      const slots = resolvePlayoffSlots(sePhase, groupStandings)

      if (slots.some(s => s === null)) {
        throw new Error('Не удалось определить всех участников плейофф. Убедитесь, что все встречи группового этапа завершены.')
      }

      const findEnc = (a: string, b: string) =>
        encs.find(e =>
          (e.participant1Id === a && e.participant2Id === b) ||
          (e.participant1Id === b && e.participant2Id === a))

      const loserOf = (e?: ReturnType<typeof findEnc>) => {
        if (!e?.winnerParticipantId) return null
        return e.participant1Id === e.winnerParticipantId ? e.participant2Id : e.participant1Id
      }

      const has3rdPlace: boolean = !!p.thirdPlaceMatch
      let currentSlots = slots as string[]
      let prevPairEncs: ReturnType<typeof findEnc>[] = []

      while (currentSlots.length >= 2) {
        const pairs: [string, string][] = []
        for (let i = 0; i + 1 < currentSlots.length; i += 2) pairs.push([currentSlots[i], currentSlots[i + 1]])

        const isFinalRound = currentSlots.length === 2
        const pairEncs = pairs.map(([a, b]) => findEnc(a, b))

        const creates: Array<[string, string]> = []
        for (let i = 0; i < pairs.length; i++) if (!pairEncs[i]) creates.push(pairs[i])

        // 3rd-place encounter: alongside the final, from the two semi-final losers.
        if (isFinalRound && has3rdPlace && prevPairEncs.length >= 2) {
          const l1 = loserOf(prevPairEncs[0]), l2 = loserOf(prevPairEncs[1])
          if (l1 && l2 && !findEnc(l1, l2)) creates.push([l1, l2])
        }

        if (creates.length > 0) {
          const created = await Promise.all(
            creates.map(([a, b]) => encountersApi.create(id!, { participant1Id: a, participant2Id: b }))
          )
          for (const enc of created) {
            try { await encountersApi.generateBouts(enc.id) } catch { /* incomplete roster — generate later */ }
          }
          return created.length
        }

        const incomplete = pairEncs.filter(e => e && e.status !== 'Completed').length
        if (incomplete > 0) {
          throw new Error(`В текущем раунде плейофф ещё ${incomplete} незавершённых встреч. Завершите их, чтобы сформировать следующий раунд.`)
        }

        if (isFinalRound) {
          if (has3rdPlace && prevPairEncs.length >= 2) {
            const l1 = loserOf(prevPairEncs[0]), l2 = loserOf(prevPairEncs[1])
            if (l1 && l2) {
              const third = findEnc(l1, l2)
              if (third && third.status !== 'Completed') throw new Error('Финал завершён, но матч за 3-е место ещё не сыгран.')
            }
          }
          throw new Error('Плейофф уже полностью сыгран.')
        }

        const winners = pairEncs.map(e => e!.winnerParticipantId)
        if (winners.some(w => !w)) {
          throw new Error('Некоторые встречи завершены без победителя (ничья — нужен tie-break). Проверьте результаты.')
        }
        prevPairEncs = pairEncs
        currentSlots = winners as string[]
      }

      throw new Error('Плейофф уже полностью сыгран.')
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['encounters', id] })
      qc.invalidateQueries({ queryKey: ['tournament-matches', id] })
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      alert(`Создано встреч плейофф: ${count}`)
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error
        ? err.message
        : ((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Ошибка генерации плейофф')
      alert(msg)
    },
  })

  const generateDEMut = useMutation({
    mutationFn: async (phaseId: string) => {
      const dePhase = format!.phases.find(p => p.id === phaseId)! as any
      const ubSlotDefs: Array<{ source: string; rank: number; entersAt?: string }> = dePhase.upperBracket.slots
      const lbSlotDefs: Array<{ source: string; rank: number }> = dePhase.lowerBracket.slots
      const ubRounds: Array<{ id: string; name: string }> = dePhase.upperBracket.rounds
      const lbRounds: Array<{ id: string; name: string; dropdownsFrom?: string }> = dePhase.lowerBracket.rounds

      // Determine source RR phase from first UB slot
      const fromPhaseId: string | undefined = ubSlotDefs[0]?.source?.split('.')?.[0]
      if (!fromPhaseId) throw new Error('Не удалось определить фазу источника.')
      const rrPhase = format!.phases.find(ph => ph.id === fromPhaseId)
      if (!rrPhase) throw new Error(`Фаза '${fromPhaseId}' не найдена.`)

      const groupAssignments = assignGroups(rrPhase as any, tournament!.participants)
      const groupStandings = calculateGroupStandings(rrPhase, groupAssignments, tournamentMatches ?? [])

      const resolveSlot = (source: string, rank: number): string | null => {
        const parts = source.split('.')
        if (parts.length < 2) return null
        const groupIdx = parts[1].charCodeAt(0) - 65  // 'A'→0, 'B'→1, …
        return groupStandings[groupIdx]?.[rank - 1]?.fighterId ?? null
      }

      const allTMs = tournamentMatches ?? []
      const findMatch = (f1: string, f2: string) =>
        allTMs.find(m =>
          (m.fighter1Id === f1 && m.fighter2Id === f2) ||
          (m.fighter1Id === f2 && m.fighter2Id === f1)
        )
      const matchWinner = (f1: string, f2: string): string | null => {
        const m = findMatch(f1, f2)
        return m?.status === 'Completed' && m.winnerId ? m.winnerId : null
      }
      const matchLoser = (f1: string, f2: string): string | null => {
        const m = findMatch(f1, f2)
        if (m?.status === 'Completed' && m.winnerId)
          return (m.fighter1Id === m.winnerId ? m.fighter2Id : m.fighter1Id) ?? null
        return null
      }

      // Resolve initial fighters
      const ubDirectSlots = ubSlotDefs.filter(s => !s.entersAt).map(s => resolveSlot(s.source, s.rank))
      const ubByesByRound: Record<string, (string | null)[]> = {}
      for (const s of ubSlotDefs.filter(s => s.entersAt)) {
        if (!ubByesByRound[s.entersAt!]) ubByesByRound[s.entersAt!] = []
        ubByesByRound[s.entersAt!].push(resolveSlot(s.source, s.rank))
      }
      const lbDirectSlots = lbSlotDefs.map(s => resolveSlot(s.source, s.rank))

      type Pair = [string | null, string | null]

      // Pre-compute UB round pairs (null where result not yet known)
      const ubRoundPairs: Pair[][] = []
      {
        const r0: Pair[] = []
        for (let i = 0; i + 1 < ubDirectSlots.length; i += 2)
          r0.push([ubDirectSlots[i], ubDirectSlots[i + 1]])
        ubRoundPairs.push(r0)

        for (let ri = 1; ri < ubRounds.length; ri++) {
          const byes = ubByesByRound[ubRounds[ri].id] ?? []
          const prevWinners = ubRoundPairs[ri - 1].map(([f1, f2]) => (f1 && f2) ? matchWinner(f1, f2) : null)
          let pairs: Pair[]
          if (byes.length > 0) {
            pairs = prevWinners.map((w, i) => [w, byes[i] ?? null] as Pair)
          } else {
            pairs = []
            for (let i = 0; i + 1 < prevWinners.length; i += 2)
              pairs.push([prevWinners[i], prevWinners[i + 1]])
          }
          ubRoundPairs.push(pairs)
        }
      }

      // Pre-compute LB round pairs
      const lbRoundPairs: Pair[][] = []
      {
        const r0: Pair[] = []
        for (let i = 0; i + 1 < lbDirectSlots.length; i += 2)
          r0.push([lbDirectSlots[i], lbDirectSlots[i + 1]])
        lbRoundPairs.push(r0)

        for (let ri = 1; ri < lbRounds.length; ri++) {
          const round = lbRounds[ri]
          const prevWinners = lbRoundPairs[ri - 1].map(([f1, f2]) => (f1 && f2) ? matchWinner(f1, f2) : null)
          let slotsForRound: (string | null)[] = [...prevWinners]

          if (round.dropdownsFrom) {
            const ubRi = ubRounds.findIndex(r => r.id === round.dropdownsFrom)
            if (ubRi >= 0) {
              const losers = ubRoundPairs[ubRi].map(([f1, f2]) => (f1 && f2) ? matchLoser(f1, f2) : null)
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
          lbRoundPairs.push(pairs)
        }
      }

      // Helpers
      const isComplete = (pairs: Pair[]): boolean =>
        pairs.every(([f1, f2]) => !!(f1 && f2 && findMatch(f1, f2)?.status === 'Completed'))
      const hasUnfinished = (pairs: Pair[]): boolean =>
        pairs.some(([f1, f2]) => {
          if (!f1 || !f2) return false
          const m = findMatch(f1, f2)
          return !!(m && m.status !== 'Completed')
        })

      const creates: Array<[string, string]> = []
      const generateRound = (pairs: Pair[]): boolean => {
        let made = false
        for (const [f1, f2] of pairs) {
          if (!f1 || !f2) continue
          if (!findMatch(f1, f2)) { creates.push([f1, f2]); made = true }
        }
        return made
      }

      // Walk UB: generate the next round that can be generated
      for (let ri = 0; ri < ubRoundPairs.length; ri++) {
        if (ri > 0 && !isComplete(ubRoundPairs[ri - 1])) break
        if (generateRound(ubRoundPairs[ri])) break
        if (hasUnfinished(ubRoundPairs[ri])) break
      }

      // Walk LB: same logic, also wait for dropdown source in UB to complete
      for (let ri = 0; ri < lbRoundPairs.length; ri++) {
        if (ri > 0 && !isComplete(lbRoundPairs[ri - 1])) break
        const dropFrom = lbRounds[ri]?.dropdownsFrom
        if (dropFrom) {
          const ubRi = ubRounds.findIndex(r => r.id === dropFrom)
          if (ubRi >= 0 && !isComplete(ubRoundPairs[ubRi])) break
        }
        if (generateRound(lbRoundPairs[ri])) break
        if (hasUnfinished(lbRoundPairs[ri])) break
      }

      // Grand Final: after both bracket finals are complete
      const ubFP = ubRoundPairs[ubRoundPairs.length - 1]
      const lbFP = lbRoundPairs[lbRoundPairs.length - 1]
      if (ubFP && lbFP && isComplete(ubFP) && isComplete(lbFP)) {
        const ubW = ubFP[0] ? matchWinner(ubFP[0][0]!, ubFP[0][1]!) : null
        const lbW = lbFP[0] ? matchWinner(lbFP[0][0]!, lbFP[0][1]!) : null
        if (ubW && lbW && !findMatch(ubW, lbW)) creates.push([ubW, lbW])
      }

      if (creates.length === 0)
        throw new Error('Нет встреч для генерации. Завершите текущие бои, чтобы сформировать следующий раунд.')

      return Promise.all(creates.map(([f1, f2]) => matchesApi.create(id!, { fighter1Id: f1, fighter2Id: f2 })))
    },
    onSuccess: (results) => {
      qc.invalidateQueries({ queryKey: ['tournament-matches', id] })
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      alert(`Создано встреч: ${results.length}`)
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error
        ? err.message
        : ((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Ошибка генерации DE плейофф')
      alert(msg)
    },
  })

  const generateSwissMut = useMutation({
    mutationFn: async (phaseId: string) => {
      const phase = format!.phases.find(p => p.id === phaseId)! as any
      const pool = buildSwissPool(tournament!.participants)
      const standings = calculateGroupStandings(phase, [pool], tournamentMatches ?? [])[0]
      const plan = planSwissNextRound(pool, phase, standings, tournamentMatches ?? [])
      const creates = plan.pairs.map(([f1, f2]) => matchesApi.create(id!, { fighter1Id: f1, fighter2Id: f2 }))
      // Bye (odd pool): no opponent — backend auto-completes as a win for the bye fighter.
      if (plan.bye) creates.push(matchesApi.create(id!, { fighter1Id: plan.bye }))
      const results = await Promise.all(creates)
      return { roundNumber: plan.roundNumber, count: results.length, hasBye: !!plan.bye }
    },
    onSuccess: ({ roundNumber, count, hasBye }) => {
      qc.invalidateQueries({ queryKey: ['tournament-matches', id] })
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      alert(`Тур ${roundNumber}: создано встреч ${count}${hasBye ? ' (включая бай)' : ''}`)
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error
        ? err.message
        : ((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Ошибка генерации тура швейцарки')
      alert(msg)
    },
  })

  const addRandomFightersMut = useMutation({
    mutationFn: async (count: number) => {
      const pool = [...available].sort(() => Math.random() - 0.5).slice(0, count)
      if (pool.length === 0) throw new Error('Нет доступных бойцов для добавления')
      const existingCount = tournament!.participants.length
      for (let i = 0; i < pool.length; i++) {
        await tournamentsApi.addParticipant(id!, pool[i].id, existingCount + i + 1)
      }
      return pool.length
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      alert(`Добавлено бойцов: ${count}`)
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error
        ? err.message
        : ((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Ошибка добавления бойцов')
      alert(msg)
    },
  })

  const randomResultsMut = useMutation({
    mutationFn: async () => {
      const pending = (tournamentMatches ?? []).filter(
        m => m.status === 'Scheduled' || m.status === 'InProgress'
      )
      if (pending.length === 0) throw new Error('Нет незавершённых боёв')

      await Promise.all(pending.map(async (m) => {
        if (m.status === 'Scheduled') {
          await matchesApi.setStatus(m.id, 'InProgress')
        }
        // Two different scores to guarantee a winner (no draw)
        const p1 = Math.floor(Math.random() * 3) + 1
        const p2 = (p1 % 3) + 1
        await matchesApi.addExchange(m.id, { roundNumber: 1, points1: p1, points2: p2, isDoubleHit: false })
        await matchesApi.setStatus(m.id, 'Completed')
      }))

      return pending.length
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['tournament-matches', id] })
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      alert(`Завершено боёв: ${count}`)
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error
        ? err.message
        : ((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Ошибка')
      alert(msg)
    },
  })

  // Test data: create N teams, each created+registered with a full 3-fighter roster.
  const addRandomTeamsMut = useMutation({
    mutationFn: async (count: number) => {
      const base = tournament!.participants.length
      for (let i = 0; i < count; i++) {
        const no = base + i + 1
        const team = await teamsApi.create(id!, { name: `${rnd(CLUB_NAMES)}-${no}`, club: rnd(CLUB_NAMES) })
        await tournamentsApi.addParticipant(id!, team.id, no)
        for (let pos = 1; pos <= 3; pos++) {
          const f = await fightersApi.create({ firstName: rnd(FIRST_NAMES), lastName: rnd(LAST_NAMES) })
          await teamsApi.addMember(team.id, { fighterId: f.id, position: pos })
        }
      }
      return count
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['teams', id] })
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      alert(`Добавлено команд: ${count}`)
    },
    onError: (err: unknown) =>
      alert((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Ошибка добавления команд'),
  })

  // Test data: play out every unfinished encounter — generate bouts if missing,
  // start it, fill each bout with a random decisive score, then complete it.
  const randomTeamResultsMut = useMutation({
    mutationFn: async () => {
      const encs = await encountersApi.listByTournament(id!)
      const pending = encs.filter(e => e.status !== 'Completed' && e.status !== 'Cancelled')
      if (pending.length === 0) throw new Error('Нет незавершённых встреч')

      let tieBreaks = 0
      for (const enc of pending) {
        if (enc.bouts.length === 0) await encountersApi.generateBouts(enc.id)
        if (enc.status === 'Scheduled') await encountersApi.setStatus(enc.id, 'InProgress')

        // Re-fetch so bout list/statuses are current regardless of which
        // mutation response repopulates `bouts`.
        const fresh = await encountersApi.get(enc.id)
        for (const b of fresh.bouts) {
          if (b.status === 'Completed' || b.status === 'WalkoverWin') continue
          if (b.fighter2Id == null) continue // bye — auto-resolved
          await matchesApi.setStatus(b.id, 'InProgress')
          const p1 = Math.floor(Math.random() * 3) + 1
          const p2 = (p1 % 3) + 1 // different from p1 → guarantees a bout winner
          await matchesApi.addExchange(b.id, { roundNumber: 1, points1: p1, points2: p2, isDoubleHit: false })
          await matchesApi.setStatus(b.id, 'Completed')
        }
        try {
          await encountersApi.setStatus(enc.id, 'Completed')
        } catch {
          // Aggregate tie → needs a manual tie-break; leave the encounter open.
          tieBreaks++
        }
      }
      return { count: pending.length, tieBreaks }
    },
    onSuccess: ({ count, tieBreaks }) => {
      qc.invalidateQueries({ queryKey: ['encounters', id] })
      qc.invalidateQueries({ queryKey: ['tournament-matches', id] })
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      alert(`Заполнено встреч: ${count}.` + (tieBreaks > 0 ? `\nНичья (нужен tie-break) в ${tieBreaks} — заверши вручную.` : ''))
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error
        ? err.message
        : ((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Ошибка')
      alert(msg)
    },
  })

  if (isLoading) return <p>Загрузка...</p>
  if (!tournament) return <p>Турнир не найден</p>

  const isTeam = tournament.participantKind === 'Team'
  const hasMatches = (tournament.matchesCount ?? 0) > 0
  const transitions = STATUS_TRANSITIONS[tournament.status]
  const roundRobinPhases = format?.phases.filter(p => p.type === 'roundRobin') ?? []
  const sePhases = format?.phases.filter(p => p.type === 'singleElimination') ?? []
  const dePhases = format?.phases.filter(p => p.type === 'doubleElimination') ?? []
  const swissPhases = format?.phases.filter(p => p.type === 'swiss') ?? []

  const registeredIds = new Set(tournament.participants.map(p => p.participantId))
  const available = (allFighters ?? []).filter(f => !registeredIds.has(f.id))

  return (
    <div>
      <h1>{tournament.name}</h1>
      {tournament.nomination && <p>Номинация: {tournament.nomination}</p>}
      {tournament.description && <p>{tournament.description}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span>Статус: <strong>{STATUS_LABELS[tournament.status]}</strong></span>
        {transitions.map(t => (
          <button
            key={t.status}
            onClick={() => statusMut.mutate(t.status)}
            disabled={statusMut.isPending}
          >
            {t.label}
          </button>
        ))}
        {statusMut.isError && <span style={{ color: '#c00' }}>Ошибка смены статуса</span>}
      </div>

      <p>Даты: {tournament.startDate} — {tournament.endDate}</p>

      <TournamentFormatSection
        tournamentId={id!}
        hasMatches={hasMatches}
        participants={tournament.participants}
        defaultFightDurationSeconds={tournament.defaultRoundDurationSeconds}
        allMatches={tournamentMatches}
        encounters={tournamentEncounters}
      />

      <h2>Встречи {tournament.matchesCount > 0 && `(${tournament.matchesCount})`}</h2>

      {roundRobinPhases.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {roundRobinPhases.map(phase => (
            <button
              key={phase.id}
              onClick={() => generateMut.mutate(phase.id)}
              disabled={generateMut.isPending}
              title={isTeam
                ? 'Создать командные встречи (серии боёв) по системе каждый-с-каждым в группах этой фазы'
                : 'Сгенерировать все бои по системе каждый-с-каждым в группах этой фазы'}
            >
              {generateMut.isPending ? '…' : `⚙ Сгенерировать ${isTeam ? 'встречи' : 'бои'}: ${phase.name}`}
            </button>
          ))}
        </div>
      )}

      {!isTeam && sePhases.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {sePhases.map(phase => (
            <button
              key={phase.id}
              onClick={() => generatePlayoffMut.mutate(phase.id)}
              disabled={generatePlayoffMut.isPending}
              title="Сгенерировать встречи текущего раунда плейофф по итогам предыдущего"
            >
              {generatePlayoffMut.isPending ? '…' : `⚙ Сгенерировать плейофф: ${phase.name}`}
            </button>
          ))}
        </div>
      )}

      {isTeam && sePhases.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {sePhases.map(phase => (
            <button
              key={phase.id}
              onClick={() => generateTeamPlayoffMut.mutate(phase.id)}
              disabled={generateTeamPlayoffMut.isPending}
              title="Сгенерировать командные встречи текущего раунда плейофф по итогам предыдущего"
            >
              {generateTeamPlayoffMut.isPending ? '…' : `⚙ Сгенерировать плейофф: ${phase.name}`}
            </button>
          ))}
        </div>
      )}

      {!isTeam && dePhases.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {dePhases.map(phase => (
            <button
              key={phase.id}
              onClick={() => generateDEMut.mutate(phase.id)}
              disabled={generateDEMut.isPending}
              title="Сгенерировать следующий раунд double elimination (UB и LB независимо)"
            >
              {generateDEMut.isPending ? '…' : `⚙ Сгенерировать DE плейофф: ${phase.name}`}
            </button>
          ))}
        </div>
      )}

      {!isTeam && swissPhases.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {swissPhases.map(phase => (
            <button
              key={phase.id}
              onClick={() => generateSwissMut.mutate(phase.id)}
              disabled={generateSwissMut.isPending}
              title="Сгенерировать пары следующего тура швейцарки по текущей таблице"
            >
              {generateSwissMut.isPending ? '…' : `⚙ Сгенерировать тур: ${phase.name}`}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Link to={`/tournaments/${id}/matches`}>Смотреть все встречи →</Link>
        {!isTeam && (
          <button
            onClick={() => randomResultsMut.mutate()}
            disabled={randomResultsMut.isPending}
            title="Тестовая функция: проставить случайные результаты всем незавершённым боям"
            style={{ fontSize: '0.8em', color: '#999', background: 'none', border: '1px dashed #ccc', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}
          >
            {randomResultsMut.isPending ? '…' : '🎲 Случайные результаты (тест)'}
          </button>
        )}
      </div>

      {isTeam ? (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0' }}>
            <span style={{ color: '#999', fontSize: '0.8em' }}>Тест:</span>
            {[4, 8, 16].map(n => (
              <button
                key={n}
                onClick={() => addRandomTeamsMut.mutate(n)}
                disabled={addRandomTeamsMut.isPending}
                title={`Создать и зарегистрировать ${n} случайных команд с полными составами`}
                style={TEST_BTN}
              >
                {addRandomTeamsMut.isPending ? '…' : `+${n} команд`}
              </button>
            ))}
            <button
              onClick={() => randomTeamResultsMut.mutate()}
              disabled={randomTeamResultsMut.isPending}
              title="Проставить случайные результаты всем незавершённым командным встречам"
              style={TEST_BTN}
            >
              {randomTeamResultsMut.isPending ? '…' : '🎲 Случайные результаты'}
            </button>
          </div>
          <TeamsSection tournamentId={id!} participants={tournament.participants} />
          <EncountersSection tournamentId={id!} participants={tournament.participants} />
        </>
      ) : (
        <>
          <h2>
            Участники ({tournament.participants.length})
            <span style={{ marginLeft: 12, display: 'inline-flex', gap: 6 }}>
              {[8, 16, 32, 64].map(n => (
                <button
                  key={n}
                  onClick={() => addRandomFightersMut.mutate(n)}
                  disabled={addRandomFightersMut.isPending}
                  title={`Тестовая функция: создать и добавить ${n} случайных бойцов`}
                  style={{ fontSize: '0.8em', color: '#999', background: 'none', border: '1px dashed #ccc', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}
                >
                  {addRandomFightersMut.isPending ? '…' : `+${n} бойцов (тест)`}
                </button>
              ))}
            </span>
          </h2>

          {tournament.participants.length === 0 ? (
            <p style={{ color: '#888' }}>Участников нет</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {tournament.participants.map(p => (
                <li key={p.participantId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span>
                    {participantName(p)}
                    {p.seed != null && <span style={{ color: '#888', marginLeft: 6 }}>#{p.seed}</span>}
                    {participantClub(p) && <span style={{ color: '#888', marginLeft: 6 }}>({participantClub(p)})</span>}
                  </span>
                  <button
                    onClick={() => removeParticipantMut.mutate(p.participantId)}
                    disabled={removeParticipantMut.isPending}
                    style={{ color: '#c00', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85em' }}
                    title="Снять с турнира"
                  >
                    Снять
                  </button>
                </li>
              ))}
            </ul>
          )}

          {available.length > 0 && (
            <form
              onSubmit={e => { e.preventDefault(); if (selectedFighterId) addParticipantMut.mutate() }}
              style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}
            >
              <select
                value={selectedFighterId}
                onChange={e => setSelectedFighterId(e.target.value)}
                required
                style={{ minWidth: 200 }}
              >
                <option value="">— выбрать бойца —</option>
                {available.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.firstName} {f.lastName}{f.club ? ` (${f.club})` : ''}
                  </option>
                ))}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                Посев
                <input
                  type="number" min={1} value={seed}
                  onChange={e => setSeed(e.target.value)}
                  placeholder="—"
                  style={{ width: 52 }}
                />
              </label>
              <button type="submit" disabled={!selectedFighterId || addParticipantMut.isPending}>
                + Добавить
              </button>
              {addParticipantMut.isError && <span style={{ color: '#c00' }}>Ошибка</span>}
            </form>
          )}
        </>
      )}
    </div>
  )
}
