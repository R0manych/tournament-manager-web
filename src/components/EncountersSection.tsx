import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { encountersApi } from '../api/encounters'
import { tournamentsApi } from '../api/tournaments'
import { groupEncountersByGroup, resolvePhaseGroups } from './bracket/bracketUtils'
import { groupsApi } from '../api/groups'
import type { Encounter, MatchStatus, TournamentParticipant } from '../api/types'
import { participantName } from '../api/types'

// Типизировано по `MatchStatus`: с `Record<string, string>` новый статус
// отрисовался бы пустым, и компилятор бы промолчал.
const STATUS_LABEL: Record<MatchStatus, string> = {
  Scheduled: 'Запланирована',
  InProgress: 'Идёт',
  Completed: 'Завершена',
  Cancelled: 'Отменена',
  WalkoverWin: 'Тех. победа',
  DoubleLoss: 'Двойное поражение',
}
const STATUS_COLOR: Record<MatchStatus, string> = {
  Scheduled: '#888',
  InProgress: '#0077cc',
  Completed: '#080',
  Cancelled: '#aaa',
  WalkoverWin: '#080',
  DoubleLoss: '#b3261e',
}

interface Props {
  tournamentId: string
  participants: TournamentParticipant[]
}

export default function EncountersSection({ tournamentId, participants }: Props) {
  const qc = useQueryClient()
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')

  const { data: encounters } = useQuery({
    queryKey: ['encounters', tournamentId],
    queryFn: () => encountersApi.listByTournament(tournamentId),
  })

  const { data: format } = useQuery({
    queryKey: ['tournament-format', tournamentId],
    queryFn: () => tournamentsApi.format.get(tournamentId),
    retry: (failureCount, error: unknown) =>
      (error as { status?: number })?.status !== 404 && failureCount < 2,
  })

  const { data: savedGroups } = useQuery({
    queryKey: ['tournament-groups', tournamentId],
    queryFn: () => groupsApi.list(tournamentId),
  })

  const nameOf = (id: string) => {
    const p = participants.find(x => x.participantId === id)
    return p ? participantName(p) : id.slice(0, 8)
  }

  const createMut = useMutation({
    mutationFn: () =>
      encountersApi.create(tournamentId, { participant1Id: p1, participant2Id: p2 }),
    onSuccess: () => {
      setP1(''); setP2('')
      qc.invalidateQueries({ queryKey: ['encounters', tournamentId] })
      // First encounter flips tournament Draft→Scheduled on the server.
      qc.invalidateQueries({ queryKey: ['tournaments', tournamentId] })
    },
    onError: (err: unknown) =>
      alert((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Ошибка создания встречи'),
  })

  // Group encounters by their round-robin group so the list reads in group/schedule
  // order rather than arbitrary creation order (otherwise groups look "mixed").
  // Only snake-seeded roundRobin phases are bucketed here; explicit-seeded phases
  // (seeding.groups) resolve from prior-phase standings and aren't grouped.
  const rrPhase = format?.phases.find(p => p.type === 'roundRobin' && !(p as any).seeding?.groups)
  const groups = rrPhase ? resolvePhaseGroups(rrPhase as any, participants, savedGroups) : []
  const grouped = groupEncountersByGroup(groups, encounters ?? [])
  const showGroupHeaders = groups.length > 1

  return (
    <div>
      <h2>Командные встречи ({encounters?.length ?? 0})</h2>

      {(!encounters || encounters.length === 0) ? (
        <p style={{ color: '#888' }}>Встреч пока нет</p>
      ) : (
        grouped
          .filter(g => g.encounters.length > 0)
          .map(group => (
            <div key={group.label ?? '__other'} style={{ marginBottom: 16 }}>
              {showGroupHeaders && (
                <h3 style={{ margin: '12px 0 6px', fontSize: '1em', color: '#444' }}>
                  {group.label != null ? `Группа ${group.label}` : 'Прочие'}
                  <span style={{ color: '#bbb', fontWeight: 400, marginLeft: 6 }}>
                    ({group.encounters.length})
                  </span>
                </h3>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95em' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5' }}>
                    <th style={TH}>Команда 1</th>
                    <th style={{ ...TH, textAlign: 'center' }}>Счёт</th>
                    <th style={TH}>Команда 2</th>
                    <th style={TH}>Статус</th>
                    <th style={TH} />
                  </tr>
                </thead>
                <tbody>
                  {group.encounters.map((e: Encounter) => (
                    <tr key={e.id}>
                      <td style={TD}><Link to={`/encounters/${e.id}`}>{nameOf(e.participant1Id)}</Link></td>
                      <td style={{ ...TD, textAlign: 'center', fontWeight: 700 }}>
                        {e.status === 'Scheduled' ? 'vs' : `${e.score1} : ${e.score2}`}
                        <span style={{ color: '#bbb', fontWeight: 400, fontSize: '0.8em' }}> / {e.targetTotalScore}</span>
                      </td>
                      <td style={TD}><Link to={`/encounters/${e.id}`}>{nameOf(e.participant2Id)}</Link></td>
                      <td style={{ ...TD, color: STATUS_COLOR[e.status], whiteSpace: 'nowrap' }}>
                        {STATUS_LABEL[e.status] ?? e.status}
                        {e.requiresTieBreak && <span style={{ color: '#a86500', marginLeft: 6 }}>· ничья</span>}
                      </td>
                      <td style={TD}><Link to={`/encounters/${e.id}`}>→</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
      )}

      {participants.length >= 2 && (
        <form
          onSubmit={e => { e.preventDefault(); if (p1 && p2 && p1 !== p2) createMut.mutate() }}
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}
        >
          <select value={p1} onChange={e => setP1(e.target.value)} required style={{ minWidth: 160 }}>
            <option value="">— команда 1 —</option>
            {participants.map(p => (
              <option key={p.participantId} value={p.participantId} disabled={p.participantId === p2}>
                {participantName(p)}
              </option>
            ))}
          </select>
          <span style={{ color: '#888' }}>vs</span>
          <select value={p2} onChange={e => setP2(e.target.value)} required style={{ minWidth: 160 }}>
            <option value="">— команда 2 —</option>
            {participants.map(p => (
              <option key={p.participantId} value={p.participantId} disabled={p.participantId === p1}>
                {participantName(p)}
              </option>
            ))}
          </select>
          <button type="submit" disabled={!p1 || !p2 || p1 === p2 || createMut.isPending}>
            {createMut.isPending ? '…' : '+ Создать встречу'}
          </button>
        </form>
      )}
    </div>
  )
}

const TH: React.CSSProperties = {
  border: '1px solid #ddd', padding: '5px 10px', textAlign: 'left', fontWeight: 600,
}
const TD: React.CSSProperties = {
  border: '1px solid #ddd', padding: '6px 10px',
}
