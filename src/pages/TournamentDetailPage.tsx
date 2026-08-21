import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useState, useEffect, useMemo } from 'react'
import { tournamentsApi } from '../api/tournaments'
import { matchesApi } from '../api/matches'
import { encountersApi } from '../api/encounters'
import { teamsApi } from '../api/teams'
import { fightersApi } from '../api/fighters'
import type { CreateMatchRequest, Match, TournamentStatus } from '../api/types'
import { participantName, participantClub, TOURNAMENT_STATUS_LABELS } from '../api/types'
import TournamentFormatSection from '../components/TournamentFormatSection'
import TeamsSection from '../components/TeamsSection'
import EncountersSection from '../components/EncountersSection'
import { groupsApi, type SaveGroupItem } from '../api/groups'
import { isProduction } from '../lib/env'
import {
  buildSwissPool, calculateGroupStandings, createCellLookup, encountersToStandingsMatches,
  grandFinalHint, matchesOfPhase, placementsOf, planSwissNextRound, resolveGrandFinalSeries,
  resolvePhaseGroups, resolvePlayoffSlots, seRounds,
  GRAND_FINAL_RESET_ROUND_ID, GRAND_FINAL_ROUND_ID, THIRD_PLACE_ROUND_ID,
} from '../components/bracket/bracketUtils'

// Flow: Draft (формат/участники/группы) → Scheduled (бои сгенерированы, группы
// заблокированы) → Active (бои идут). Откаты к Draft удаляют бои на сервере и
// требуют подтверждения.
const STATUS_TRANSITIONS: Record<TournamentStatus, { status: TournamentStatus; label: string; confirm?: string }[]> = {
  Draft:     [{ status: 'Cancelled', label: '✕ Отменить' }],
  Scheduled: [
    { status: 'Active', label: '▶ Начать бои' },
    {
      status: 'Draft', label: '↩ Вернуться к группам',
      confirm: 'Вернуться к редактированию групп?\nВсе сгенерированные (несыгранные) бои будут удалены.',
    },
    { status: 'Cancelled', label: '✕ Отменить' },
  ],
  Active: [
    { status: 'Completed', label: '✓ Завершить' },
    {
      status: 'Draft', label: '⟲ Сбросить бои',
      confirm: 'СБРОС БОЁВ!\nВсе бои и их результаты (сходы, счёт) будут безвозвратно удалены, турнир вернётся к редактированию групп.\nПродолжить?',
    },
    { status: 'Cancelled', label: '✕ Отменить' },
  ],
  Completed: [{ status: 'Active', label: '↩ Вернуть в активные' }],
  Cancelled: [], // терминальный статус: сервер запрещает любой переход из Cancelled
}

// ── Test-data pools (random team names) ─────────────────────────────────────
const CLUB_NAMES = ['Сокол', 'Дружина', 'Гвардия', 'Легион', 'Викинг', 'Барс', 'Витязь', 'Орден']
const rnd = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

// Сообщение об ошибке генерации. 409 от `POST /matches` — это занятая ячейка
// сетки: раунд уже сгенерирован (другой вкладкой или прошлым кликом). Именно на
// этом ответе держится идемпотентность генерации плейофф (docs/08 §8), поэтому
// показываем его отдельной, понятной организатору фразой.
function generationError(err: unknown, fallback: string): string {
  const e = err as { status?: number; problem?: { detail?: string } }
  if (e?.status === 409) {
    return 'Ячейка сетки уже занята другой встречей — похоже, этот раунд уже сгенерирован. Обновите страницу.'
  }
  if (e?.status == null && err instanceof Error) return err.message
  return e?.problem?.detail ?? fallback
}

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

  // Saved group composition — shared by all clients, used for display and generation.
  const { data: savedGroups } = useQuery({
    queryKey: ['tournament-groups', id],
    queryFn: () => groupsApi.list(id!),
    enabled: !!id,
  })

  // Ячейки сетки: какая встреча стоит в `(фаза, раунд, слот)` (B-5). Резолв идёт
  // по ним, а не по паре участников. Пустой список = турнир, созданный до
  // размещений: рисуется и генерируется по-старому (инвариант 46). Источник —
  // сами встречи, поэтому отдельной инвалидации размещения не требуют.
  const placements = useMemo(() => placementsOf(tournamentMatches), [tournamentMatches])

  const statusMut = useMutation({
    mutationFn: (status: TournamentStatus) => tournamentsApi.setStatus(id!, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      qc.invalidateQueries({ queryKey: ['tournaments'] })
      // Rollback to Draft deletes generated fights server-side — а с ними
      // каскадом уходят и их ячейки сетки (инвариант 44).
      qc.invalidateQueries({ queryKey: ['tournament-matches', id] })
      qc.invalidateQueries({ queryKey: ['encounters', id] })
    },
    onError: (err: unknown) =>
      alert((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Ошибка смены статуса'),
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

  // Single group-panel action: persist the composition dragged together in the
  // panel, then generate the group-stage fights from it.
  const generateMut = useMutation({
    mutationFn: async ({ phaseId, groups }: { phaseId: string; groups: SaveGroupItem[] }) => {
      await groupsApi.save(id!, phaseId, groups)

      // Team tournaments play each pair as an Encounter (series of bouts), not a
      // single flat match — generate one Encounter per in-group pair, idempotently.
      if (tournament!.participantKind === 'Team') {
        const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
        const existing = await encountersApi.listByTournament(id!)
        const existingPairs = new Set(existing.map(e => pairKey(e.participant1Id, e.participant2Id)))

        const toCreate: Array<[string, string]> = []
        let skipped = 0
        for (const group of groups) {
          const teamIds = group.participantIds
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

      // Singles: the server reads the saved composition itself.
      return matchesApi.generateRoundRobin(id!, phaseId)
    },
    onSuccess: (result) => {
      // generate-round-robin размещает групповые встречи по ячейкам (группа, пара);
      // размещения приезжают внутри самих встреч.
      qc.invalidateQueries({ queryKey: ['tournament-matches', id] })
      qc.invalidateQueries({ queryKey: ['encounters', id] })
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      qc.invalidateQueries({ queryKey: ['tournament-groups', id] })
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
      const groupAssignments = resolvePhaseGroups(rrPhase as any, tournament!.participants, savedGroups)
      const allTournamentMatches = tournamentMatches ?? []
      // Таблица группы считается только по встречам, размещённым в групповой
      // фазе: переигровка одногруппников в плейофф не должна двигать посев
      // задним числом (Д-3).
      const groupStandings = calculateGroupStandings(
        rrPhase, groupAssignments, matchesOfPhase(rrPhase.id, allTournamentMatches, placements))
      const slots = resolvePlayoffSlots(sePhase, groupStandings)

      if (slots.some(s => s === null)) {
        throw new Error('Не удалось определить всех участников плейофф. Убедитесь, что все бои группового этапа завершены.')
      }

      // Встреча раунда ищется по ячейке `(фаза, раунд, слот)`, а не по паре:
      // те же двое могли сойтись в группе и снова сходятся в плейофф (Д-1, Д-2).
      const lookup = createCellLookup(phaseId, allTournamentMatches, placements)
      const rounds = seRounds(sePhase)

      const has3rdPlace: boolean = !!p.thirdPlaceMatch
      const loserOf = (m: Match | undefined): string | null => {
        if (!m?.winnerId) return null
        return (m.fighter1Id === m.winnerId ? m.fighter2Id : m.fighter1Id) ?? null
      }

      // Walk rounds until we find the next one to generate
      let currentSlots = slots as string[]
      let prevPairMatches: (Match | undefined)[] = []
      let ri = 0

      while (currentSlots.length >= 2) {
        const round = rounds[ri]
        if (!round) {
          throw new Error('В формате не описан раунд для этой стадии сетки — проверьте список rounds в YAML.')
        }

        const pairs: [string, string][] = []
        for (let i = 0; i + 1 < currentSlots.length; i += 2) {
          pairs.push([currentSlots[i], currentSlots[i + 1]])
        }

        const isFinalRound = currentSlots.length === 2
        const pairMatches = pairs.map(([f1, f2], i) => lookup.find(round.id, i, f1, f2))

        // Collect what needs to be created this iteration
        const creates: CreateMatchRequest[] = []
        for (let i = 0; i < pairs.length; i++) {
          if (!pairMatches[i]) {
            creates.push({
              fighter1Id: pairs[i][0],
              fighter2Id: pairs[i][1],
              placement: { phaseId, roundId: round.id, slotIndex: i },
            })
          }
        }

        // 3rd place match: generate alongside the final from semi-final losers.
        // Своя ячейка `thirdPlace` — системный раунд формата v0.3.1 (ОВ-4).
        const semiFinalLosers = (): [string | null, string | null] =>
          [loserOf(prevPairMatches[0]), loserOf(prevPairMatches[1])]

        if (isFinalRound && has3rdPlace && prevPairMatches.length >= 2) {
          const [l1, l2] = semiFinalLosers()
          if (l1 && l2 && !lookup.find(THIRD_PLACE_ROUND_ID, 0, l1, l2)) {
            creates.push({
              fighter1Id: l1,
              fighter2Id: l2,
              placement: { phaseId, roundId: THIRD_PLACE_ROUND_ID, slotIndex: 0 },
            })
          }
        }

        if (creates.length > 0) {
          return Promise.all(creates.map(req => matchesApi.create(id!, req)))
        }

        // Двойное поражение — завершённый бой (АР-16), в «незавершённые» не идёт.
        // Победителя из него нет, поэтому генерация упирается ниже — с указанием
        // конкретной ячейки, а не общим «проверьте результаты».
        const incomplete = pairMatches.filter(
          m => m && m.status !== 'Completed' && m.status !== 'DoubleLoss'
        ).length
        if (incomplete > 0) {
          throw new Error(`В текущем раунде плейофф ещё ${incomplete} незавершённых боёв. Завершите их, чтобы сформировать следующий раунд.`)
        }

        const doubleLossAt = pairMatches.findIndex(m => m?.status === 'DoubleLoss')
        if (doubleLossAt >= 0) {
          throw new Error(
            `Ячейка «${round.name ?? round.id}», пара ${doubleLossAt + 1}: двойное поражение — победителя нет, ` +
            'и следующий раунд из этой ячейки не формируется. Либо верните бой в работу и доиграйте, ' +
            'либо создайте встречу следующего раунда вручную.'
          )
        }

        if (isFinalRound) {
          // Check 3rd place match completion if applicable
          if (has3rdPlace && prevPairMatches.length >= 2) {
            const [l1, l2] = semiFinalLosers()
            if (l1 && l2) {
              const thirdMatch = lookup.find(THIRD_PLACE_ROUND_ID, 0, l1, l2)
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
        ri++
      }

      throw new Error('Плейофф уже полностью сыгран.')
    },
    onSuccess: (results) => {
      qc.invalidateQueries({ queryKey: ['tournament-matches', id] })
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      alert(`Создано встреч: ${results.length}`)
    },
    onError: (err: unknown) => alert(generationError(err, 'Ошибка генерации плейофф')),
  })

  // Team single-elimination playoff: mirrors generatePlayoffMut but resolves
  // standings from Encounters and creates Encounters (+ bouts) per pair, advancing
  // by winnerParticipantId. Generates the next not-yet-created round on each click.
  //
  // Размещений (B-5) здесь нет: бэкенд размещает только `Match`, а серия — это
  // `Encounter`. Командный плейофф остаётся на резолве по паре со всеми его
  // ограничениями (переигровка одногруппников не создастся) — размещение серий
  // требует решения на бэке и в этот скоуп не входит.
  const generateTeamPlayoffMut = useMutation({
    mutationFn: async (phaseId: string) => {
      const sePhase = format!.phases.find(p => p.id === phaseId)!
      const p = sePhase as any
      const fromPhaseId: string = p.seeding?.from
      const rrPhase = format!.phases.find(ph => ph.id === fromPhaseId)!
      const groupAssignments = resolvePhaseGroups(rrPhase as any, tournament!.participants, savedGroups)

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

        // Серия с двойным поражением (АР-16) закончена, но победителя не даёт.
        const incomplete = pairEncs.filter(
          e => e && e.status !== 'Completed' && e.status !== 'DoubleLoss'
        ).length
        if (incomplete > 0) {
          throw new Error(`В текущем раунде плейофф ещё ${incomplete} незавершённых встреч. Завершите их, чтобы сформировать следующий раунд.`)
        }

        const encDoubleLossAt = pairEncs.findIndex(e => e?.status === 'DoubleLoss')
        if (encDoubleLossAt >= 0) {
          throw new Error(
            `Пара ${encDoubleLossAt + 1} текущего раунда: двойное поражение — победителя нет, ` +
            'и следующий раунд из этой пары не формируется. Либо верните встречу в работу, ' +
            'либо создайте встречу следующего раунда вручную.'
          )
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

      const groupAssignments = resolvePhaseGroups(rrPhase as any, tournament!.participants, savedGroups)
      const allTMs = tournamentMatches ?? []
      const groupStandings = calculateGroupStandings(
        rrPhase, groupAssignments, matchesOfPhase(rrPhase.id, allTMs, placements))

      const resolveSlot = (source: string, rank: number): string | null => {
        const parts = source.split('.')
        if (parts.length < 2) return null
        const groupIdx = parts[1].charCodeAt(0) - 65  // 'A'→0, 'B'→1, …
        return groupStandings[groupIdx]?.[rank - 1]?.fighterId ?? null
      }

      // В DE переигровки штатны: одногруппники сходятся в UB и LB, а гранд-финал
      // и матч-сброс — это вообще одна пара подряд. Поэтому встреча ищется строго
      // по ячейке `(фаза, раунд, слот)`; пара осталась подписью (B-5).
      const lookup = createCellLookup(phaseId, allTMs, placements)
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
          const prevWinners = ubRoundPairs[ri - 1].map(([f1, f2], i) =>
            (f1 && f2) ? matchWinner(ubRounds[ri - 1].id, i, f1, f2) : null)
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
          const prevWinners = lbRoundPairs[ri - 1].map(([f1, f2], i) =>
            (f1 && f2) ? matchWinner(lbRounds[ri - 1].id, i, f1, f2) : null)
          let slotsForRound: (string | null)[] = [...prevWinners]

          if (round.dropdownsFrom) {
            const ubRi = ubRounds.findIndex(r => r.id === round.dropdownsFrom)
            if (ubRi >= 0) {
              const losers = ubRoundPairs[ubRi].map(([f1, f2], i) =>
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
          lbRoundPairs.push(pairs)
        }
      }

      // Helpers. Раунд адресуется своим id, ячейка — индексом пары в раунде.
      const isComplete = (pairs: Pair[], roundId: string): boolean =>
        pairs.every(([f1, f2], i) => lookup.find(roundId, i, f1, f2)?.status === 'Completed')
      // Двойное поражение — бой законченный (АР-16), «незавершённым» он не
      // считается. Но и победителя из него нет, поэтому `isComplete` его не
      // засчитывает, и обход останавливается — с объяснением ниже.
      const hasUnfinished = (pairs: Pair[], roundId: string): boolean =>
        pairs.some(([f1, f2], i) => {
          const m = lookup.find(roundId, i, f1, f2)
          return !!(m && m.status !== 'Completed' && m.status !== 'DoubleLoss')
        })

      const doubleLossCell = (): string | null => {
        const scan = (rows: Pair[][], rounds: Array<{ id: string; name: string }>) => {
          for (let ri = 0; ri < rows.length && ri < rounds.length; ri++) {
            for (let i = 0; i < rows[ri].length; i++) {
              const [f1, f2] = rows[ri][i]
              if (lookup.find(rounds[ri].id, i, f1, f2)?.status === 'DoubleLoss') {
                return `${rounds[ri].name}, пара ${i + 1}`
              }
            }
          }
          return null
        }
        return scan(ubRoundPairs, ubRounds) ?? scan(lbRoundPairs, lbRounds)
      }

      const creates: CreateMatchRequest[] = []
      const generateRound = (pairs: Pair[], roundId: string): boolean => {
        let made = false
        pairs.forEach(([f1, f2], i) => {
          if (!f1 || !f2) return
          if (!lookup.find(roundId, i, f1, f2)) {
            creates.push({
              fighter1Id: f1,
              fighter2Id: f2,
              placement: { phaseId, roundId, slotIndex: i },
            })
            made = true
          }
        })
        return made
      }

      // Walk UB: generate the next round that can be generated
      for (let ri = 0; ri < ubRoundPairs.length; ri++) {
        if (ri > 0 && !isComplete(ubRoundPairs[ri - 1], ubRounds[ri - 1].id)) break
        if (generateRound(ubRoundPairs[ri], ubRounds[ri].id)) break
        if (hasUnfinished(ubRoundPairs[ri], ubRounds[ri].id)) break
      }

      // Walk LB: same logic, also wait for dropdown source in UB to complete
      for (let ri = 0; ri < lbRoundPairs.length; ri++) {
        if (ri > 0 && !isComplete(lbRoundPairs[ri - 1], lbRounds[ri - 1].id)) break
        const dropFrom = lbRounds[ri]?.dropdownsFrom
        if (dropFrom) {
          const ubRi = ubRounds.findIndex(r => r.id === dropFrom)
          if (ubRi >= 0 && !isComplete(ubRoundPairs[ubRi], ubRounds[ubRi].id)) break
        }
        if (generateRound(lbRoundPairs[ri], lbRounds[ri].id)) break
        if (hasUnfinished(lbRoundPairs[ri], lbRounds[ri].id)) break
      }

      // Гранд-финал (АР-15, инварианты 37-40). В режимах `reset`/`advantage` это
      // серия до двух побед с форой верхней сетки: победитель UB входит со
      // счётом 1:0 и ему хватает одной победы, победителю LB нужны обе. Граф
      // встреч у обоих режимов один (спека формата §4.8) — расходятся только
      // подписи в интерфейсе, поэтому генерация у них общая.
      //
      // Порядок слотов существенный: `fighter1Id` — всегда представитель
      // верхней сетки, на нём же держится счёт серии и определение чемпиона.
      const ubFinalRound = ubRounds[ubRounds.length - 1]
      const lbFinalRound = lbRounds[lbRounds.length - 1]
      const bracketFinalWinner = (round: { id: string } | undefined, pairs: Pair[][]): string | null => {
        if (!round || pairs.length === 0) return null
        const pair = pairs[pairs.length - 1][0]
        const m = lookup.find(round.id, 0, pair?.[0], pair?.[1])
        return m?.status === 'Completed' && m.winnerId ? m.winnerId : null
      }

      const gfSeries = resolveGrandFinalSeries(
        dePhase.grandFinal,
        lookup,
        bracketFinalWinner(ubFinalRound, ubRoundPairs),
        bracketFinalWinner(lbFinalRound, lbRoundPairs),
      )
      if (gfSeries.next) {
        creates.push({
          fighter1Id: gfSeries.next.fighter1Id,
          fighter2Id: gfSeries.next.fighter2Id,
          placement: { phaseId, roundId: gfSeries.next.roundId, slotIndex: gfSeries.next.slotIndex },
        })
      }

      if (creates.length === 0) {
        // Гранд-финал знает про себя больше, чем общая фраза: чемпион уже
        // определён, счёт серии 1:1 и ждём матч-сброс, и т. п.
        const nameOf = (pid: string) => {
          const p = tournament!.participants.find(x => x.participantId === pid)
          return p ? participantName(p) : pid.slice(0, 8)
        }
        // Двойное поражение объясняем отдельно: «завершите текущие бои» здесь
        // сбивает с толку — завершать нечего, из ячейки просто никто не выходит.
        const stuck = doubleLossCell()
        throw new Error(
          grandFinalHint(gfSeries, nameOf)
          ?? (stuck
            ? `Ячейка «${stuck}»: двойное поражение — из неё не выходит ни победитель в верхнюю сетку, ` +
              'ни проигравший в нижнюю, поэтому сетка дальше не строится. Либо верните бой в работу и ' +
              'доиграйте, либо создайте встречи следующего раунда вручную.'
            : 'Нет встреч для генерации. Завершите текущие бои, чтобы сформировать следующий раунд.'),
        )
      }

      const created = await Promise.all(creates.map(req => matchesApi.create(id!, req)))
      return { count: created.length, gfStage: gfSeries.next?.roundId ?? null, isSeries: gfSeries.isSeries }
    },
    onSuccess: ({ count, gfStage, isSeries }) => {
      qc.invalidateQueries({ queryKey: ['tournament-matches', id] })
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      // Правило серии стоит проговорить ровно в тот момент, когда организатор
      // её начинает: гандикап верхней сетки нигде в самой встрече не виден —
      // стартовый счёт хранить негде (АР-15), он живёт только в счёте серии.
      if (gfStage === GRAND_FINAL_RESET_ROUND_ID) {
        alert('Создан матч-сброс: победитель нижней сетки сравнял серию 1:1. Победитель второго матча — чемпион.')
      } else if (gfStage === GRAND_FINAL_ROUND_ID && isSeries) {
        alert('Создан гранд-финал. Счёт серии 1:0 в пользу победителя верхней сетки: ему достаточно одной победы, победителю нижней нужны обе.')
      } else {
        alert(`Создано встреч: ${count}`)
      }
    },
    onError: (err: unknown) => alert(generationError(err, 'Ошибка генерации DE плейофф')),
  })

  const generateSwissMut = useMutation({
    mutationFn: async (phaseId: string) => {
      const phase = format!.phases.find(p => p.id === phaseId)! as any
      const pool = buildSwissPool(tournament!.participants)
      // Только встречи самой швейцарки: чужие фазы не должны попадать ни в
      // таблицу, ни в подсчёт сыгранных туров.
      const phaseMatches = matchesOfPhase(phaseId, tournamentMatches ?? [], placements)
      const standings = calculateGroupStandings(phase, [pool], phaseMatches)[0]
      const plan = planSwissNextRound(pool, phase, standings, phaseMatches)

      // `round1..roundN` — системные id туров швейцарки (docs/08 §6). Режим
      // qualification planSwissNextRound не поддерживает и уже бросил бы ошибку.
      const roundId = `round${plan.roundNumber}`
      const creates = plan.pairs.map(([f1, f2], i) => matchesApi.create(id!, {
        fighter1Id: f1,
        fighter2Id: f2,
        placement: { phaseId, roundId, slotIndex: i },
      }))
      // Bye (odd pool): no opponent — backend auto-completes as a win for the bye
      // fighter. Ячейка байа идёт следом за парами тура.
      if (plan.bye) creates.push(matchesApi.create(id!, {
        fighter1Id: plan.bye,
        placement: { phaseId, roundId, slotIndex: plan.pairs.length },
      }))
      const results = await Promise.all(creates)
      return { roundNumber: plan.roundNumber, count: results.length, hasBye: !!plan.bye }
    },
    onSuccess: ({ roundNumber, count, hasBye }) => {
      qc.invalidateQueries({ queryKey: ['tournament-matches', id] })
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      alert(`Тур ${roundNumber}: создано встреч ${count}${hasBye ? ' (включая бай)' : ''}`)
    },
    onError: (err: unknown) => alert(generationError(err, 'Ошибка генерации тура швейцарки')),
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

  // Test data: create N teams, each filled with a full 3-fighter roster taken from
  // EXISTING fighters not already used in another team of this tournament.
  const addRandomTeamsMut = useMutation({
    mutationFn: async (count: number) => {
      const [allF, teams] = await Promise.all([fightersApi.list(), teamsApi.listByTournament(id!)])
      const used = new Set(teams.flatMap(t => t.members.map(m => m.fighterId)))
      const pool = allF.filter(f => !used.has(f.id)).sort(() => Math.random() - 0.5)

      const need = count * 3
      if (pool.length < need) {
        throw new Error(`Недостаточно свободных бойцов: нужно ${need}, доступно ${pool.length}. Создайте бойцов на странице «Бойцы».`)
      }

      const base = tournament!.participants.length
      let pi = 0
      for (let i = 0; i < count; i++) {
        const no = base + i + 1
        const team = await teamsApi.create(id!, { name: `${rnd(CLUB_NAMES)}-${no}`, club: rnd(CLUB_NAMES) })
        await tournamentsApi.addParticipant(id!, team.id, no)
        for (let pos = 1; pos <= 3; pos++) {
          await teamsApi.addMember(team.id, { fighterId: pool[pi++].id, position: pos })
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
      // `DoubleLoss` — терминальный статус (АР-16): такие встречи не доигрываем.
      const pending = encs.filter(
        e => e.status !== 'Completed' && e.status !== 'Cancelled' && e.status !== 'DoubleLoss'
      )
      if (pending.length === 0) throw new Error('Нет незавершённых встреч')

      let tieBreaks = 0
      for (const enc of pending) {
        if (enc.bouts.length === 0) await encountersApi.generateBouts(enc.id)
        if (enc.status === 'Scheduled') await encountersApi.setStatus(enc.id, 'InProgress')

        // Re-fetch so bout list/statuses are current regardless of which
        // mutation response repopulates `bouts`.
        const fresh = await encountersApi.get(enc.id)
        for (const b of fresh.bouts) {
          if (b.status === 'Completed' || b.status === 'WalkoverWin' || b.status === 'DoubleLoss') continue
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
  const transitions = STATUS_TRANSITIONS[tournament.status]
  // Кнопки генерации по этапам: групповые бои формируются из панели групп (Draft);
  // плейофф/DE/швейцарка — по ходу турнира.
  const canGeneratePlayoff = tournament.status === 'Scheduled' || tournament.status === 'Active'
  const canGenerateSwiss = tournament.status === 'Draft' || tournament.status === 'Scheduled' || tournament.status === 'Active'
  const sePhases = format?.phases.filter(p => p.type === 'singleElimination') ?? []
  const dePhases = format?.phases.filter(p => p.type === 'doubleElimination') ?? []
  const swissPhases = format?.phases.filter(p => p.type === 'swiss') ?? []

  const registeredIds = new Set(tournament.participants.map(p => p.participantId))
  const available = (allFighters ?? []).filter(f => !registeredIds.has(f.id))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{tournament.name}</h1>
        {/* Табло для зала (АР-14): вкладка того же браузера на второй монитор.
            Сама находит текущий бой турнира и слушает пульт. */}
        <a
          href={`/display/tournament/${tournament.id}`}
          target="_blank"
          rel="noopener"
          title="Табло, которое следует за организатором этого турнира: показывает бой, открытый на пульте, иначе начатый последним. Для параллельных ристалищ откройте на каждое своё табло с карточки боя."
          style={{ color: '#888', fontSize: '0.9em', whiteSpace: 'nowrap' }}
        >
          🖵 Табло для зала
        </a>
      </div>
      {tournament.nomination && <p>Номинация: {tournament.nomination}</p>}
      {tournament.description && <p>{tournament.description}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span>Статус: <strong>{TOURNAMENT_STATUS_LABELS[tournament.status]}</strong></span>
        {transitions.map(t => (
          <button
            key={t.status}
            onClick={() => {
              if (t.confirm && !window.confirm(t.confirm)) return
              statusMut.mutate(t.status)
            }}
            disabled={statusMut.isPending}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p>Даты: {tournament.startDate} — {tournament.endDate}</p>

      <TournamentFormatSection
        tournamentId={id!}
        status={tournament.status}
        participants={tournament.participants}
        defaultFightDurationSeconds={tournament.defaultRoundDurationSeconds}
        allMatches={tournamentMatches}
        encounters={tournamentEncounters}
        placements={placements}
        groupsGenerating={generateMut.isPending}
        generateGroupsLabel={isTeam ? 'Сформировать встречи группового этапа' : 'Сформировать бои группового этапа'}
        onGenerateGroups={(phaseId, groups) => generateMut.mutate({ phaseId, groups })}
      />

      <h2>Встречи {tournament.matchesCount > 0 && `(${tournament.matchesCount})`}</h2>

      {!isTeam && canGeneratePlayoff && sePhases.length > 0 && (
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

      {isTeam && canGeneratePlayoff && sePhases.length > 0 && (
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

      {!isTeam && canGeneratePlayoff && dePhases.length > 0 && (
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

      {!isTeam && canGenerateSwiss && swissPhases.length > 0 && (
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
        {!isTeam && !isProduction && (
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
          {/* Тестовые кнопки — только вне прода (см. lib/env.ts): на живом
              турнире случайные команды и результаты рядом с настоящими данными
              это заряженное ружьё. */}
          {!isProduction && (
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
          )}
          <TeamsSection tournamentId={id!} participants={tournament.participants} />
          <EncountersSection tournamentId={id!} participants={tournament.participants} />
        </>
      ) : (
        <>
          <h2>
            Участники ({tournament.participants.length})
            <span style={{ marginLeft: 12, display: 'inline-flex', gap: 6 }}>
              {!isProduction && [8, 16, 32, 64].map(n => (
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
