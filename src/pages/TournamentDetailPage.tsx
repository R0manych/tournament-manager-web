import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { tournamentsApi } from '../api/tournaments'
import { matchesApi } from '../api/matches'
import { fightersApi } from '../api/fighters'
import type { TournamentStatus } from '../api/types'
import TournamentFormatSection from '../components/TournamentFormatSection'
import { assignGroups, calculateGroupStandings, resolvePlayoffSlots } from '../components/bracket/bracketUtils'

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
    mutationFn: (phaseId: string) => {
      const phase = format!.phases.find(p => p.id === phaseId)!
      const groupAssignments = assignGroups(phase as any, tournament!.participants)
      const groups = groupAssignments.map(g => g.participants.map(p => p.fighterId))
      return matchesApi.generateRoundRobin(id!, phaseId, groups)
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['matches', id] })
      qc.invalidateQueries({ queryKey: ['tournaments', id] })
      if (result.skipped > 0) {
        alert(`Создано боёв: ${result.created}. Пропущено (уже существуют): ${result.skipped}.`)
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

  if (isLoading) return <p>Загрузка...</p>
  if (!tournament) return <p>Турнир не найден</p>

  const hasMatches = (tournament.matchesCount ?? 0) > 0
  const transitions = STATUS_TRANSITIONS[tournament.status]
  const roundRobinPhases = format?.phases.filter(p => p.type === 'roundRobin') ?? []
  const sePhases = format?.phases.filter(p => p.type === 'singleElimination') ?? []

  const registeredIds = new Set(tournament.participants.map(p => p.fighterId))
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
      />

      <h2>Встречи {tournament.matchesCount > 0 && `(${tournament.matchesCount})`}</h2>

      {roundRobinPhases.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {roundRobinPhases.map(phase => (
            <button
              key={phase.id}
              onClick={() => generateMut.mutate(phase.id)}
              disabled={generateMut.isPending}
              title="Сгенерировать все бои по системе каждый-с-каждым в группах этой фазы"
            >
              {generateMut.isPending ? '…' : `⚙ Сгенерировать бои: ${phase.name}`}
            </button>
          ))}
        </div>
      )}

      {sePhases.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {sePhases.map(phase => (
            <button
              key={phase.id}
              onClick={() => generatePlayoffMut.mutate(phase.id)}
              disabled={generatePlayoffMut.isPending}
              title="Сгенерировать встречи первого раунда плейофф по итогам группового этапа"
            >
              {generatePlayoffMut.isPending ? '…' : `⚙ Сгенерировать плейофф: ${phase.name}`}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Link to={`/tournaments/${id}/matches`}>Смотреть все встречи →</Link>
        <button
          onClick={() => randomResultsMut.mutate()}
          disabled={randomResultsMut.isPending}
          title="Тестовая функция: проставить случайные результаты всем незавершённым боям"
          style={{ fontSize: '0.8em', color: '#999', background: 'none', border: '1px dashed #ccc', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}
        >
          {randomResultsMut.isPending ? '…' : '🎲 Случайные результаты (тест)'}
        </button>
      </div>

      <h2>Участники ({tournament.participants.length})</h2>

      {tournament.participants.length === 0 ? (
        <p style={{ color: '#888' }}>Участников нет</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {tournament.participants.map(p => (
            <li key={p.fighterId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span>
                {p.firstName} {p.lastName}
                {p.seed != null && <span style={{ color: '#888', marginLeft: 6 }}>#{p.seed}</span>}
                {p.club && <span style={{ color: '#888', marginLeft: 6 }}>({p.club})</span>}
              </span>
              <button
                onClick={() => removeParticipantMut.mutate(p.fighterId)}
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
    </div>
  )
}
