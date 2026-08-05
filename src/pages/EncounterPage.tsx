import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { encountersApi } from '../api/encounters'
import { tournamentsApi } from '../api/tournaments'
import { teamsApi } from '../api/teams'
import { groupEncountersByGroup, resolvePhaseGroups } from '../components/bracket/bracketUtils'
import { groupsApi } from '../api/groups'
import type { Match, MatchStatus, Team } from '../api/types'
import { participantName } from '../api/types'

const BOUT_STATUS_LABEL: Record<MatchStatus, string> = {
  Scheduled: 'Запланирован',
  InProgress: 'Идёт',
  Completed: 'Завершён',
  Cancelled: 'Отменён',
  WalkoverWin: 'Тех. победа',
}
const BOUT_STATUS_COLOR: Record<MatchStatus, string> = {
  Scheduled: '#888',
  InProgress: '#0077cc',
  Completed: '#080',
  Cancelled: '#aaa',
  WalkoverWin: '#080',
}

export default function EncounterPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()

  const { data: encounter, isLoading } = useQuery({
    queryKey: ['encounters', id],
    queryFn: () => encountersApi.get(id!),
    enabled: !!id,
    refetchOnWindowFocus: true,
    refetchInterval: q => (q.state.data?.status === 'InProgress' ? 5000 : false),
  })

  const { data: tournament } = useQuery({
    queryKey: ['tournaments', encounter?.tournamentId],
    queryFn: () => tournamentsApi.get(encounter!.tournamentId),
    enabled: !!encounter?.tournamentId,
  })

  const { data: teams } = useQuery({
    queryKey: ['teams', encounter?.tournamentId],
    queryFn: () => teamsApi.listByTournament(encounter!.tournamentId),
    enabled: !!encounter?.tournamentId,
  })

  const { data: format } = useQuery({
    queryKey: ['tournament-format', encounter?.tournamentId],
    queryFn: () => tournamentsApi.format.get(encounter!.tournamentId),
    enabled: !!encounter?.tournamentId,
    retry: (failureCount, error: unknown) =>
      (error as { status?: number })?.status !== 404 && failureCount < 2,
  })

  // Sibling encounters for in-group navigation ("→ следующая встреча в группе").
  const { data: allEncounters } = useQuery({
    queryKey: ['encounters', encounter?.tournamentId],
    queryFn: () => encountersApi.listByTournament(encounter!.tournamentId),
    enabled: !!encounter?.tournamentId,
  })

  const { data: savedGroups } = useQuery({
    queryKey: ['tournament-groups', encounter?.tournamentId],
    queryFn: () => groupsApi.list(encounter!.tournamentId),
    enabled: !!encounter?.tournamentId,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['encounters', id] })

  const statusMut = useMutation({
    mutationFn: (s: MatchStatus) => encountersApi.setStatus(id!, s),
    onSuccess: invalidate,
    onError: (err: unknown) =>
      alert((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Не удалось сменить статус встречи'),
  })

  const generateMut = useMutation({
    mutationFn: () => encountersApi.generateBouts(id!),
    onSuccess: invalidate,
    onError: (err: unknown) =>
      alert((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Не удалось сгенерировать бои (укомплектованы ли составы?)'),
  })

  if (isLoading) return <p>Загрузка...</p>
  if (!encounter) return <p>Встреча не найдена</p>

  const teamName = (teamId: string) => {
    const p = tournament?.participants.find(x => x.participantId === teamId)
    if (p) return participantName(p)
    return teams?.find(t => t.id === teamId)?.name ?? teamId.slice(0, 8)
  }

  // fighterId → "First Last" from team rosters
  const fighterNames = new Map<string, string>()
  for (const t of teams ?? []) {
    for (const m of t.members) fighterNames.set(m.fighterId, `${m.firstName} ${m.lastName}`)
  }
  const fighterName = (fid?: string) => (fid ? fighterNames.get(fid) ?? fid.slice(0, 8) : '—')

  const name1 = teamName(encounter.participant1Id)
  const name2 = teamName(encounter.participant2Id)

  const bouts = [...encounter.bouts].sort((a, b) => (a.boutNumber ?? 0) - (b.boutNumber ?? 0))
  // Current bout: the one InProgress, else first Scheduled.
  const currentBout =
    bouts.find(b => b.status === 'InProgress') ?? bouts.find(b => b.status === 'Scheduled')

  const isScheduled = encounter.status === 'Scheduled'
  const isInProgress = encounter.status === 'InProgress'
  const isCompleted = encounter.status === 'Completed'

  const winnerName =
    encounter.winnerParticipantId === encounter.participant1Id ? name1
    : encounter.winnerParticipantId === encounter.participant2Id ? name2
    : null

  const team1 = teams?.find(t => t.id === encounter.participant1Id)
  const team2 = teams?.find(t => t.id === encounter.participant2Id)

  // In-group encounter navigation: order the current group's encounters by the
  // round-robin schedule and find the previous/next sibling.
  const rrPhase = format?.phases.find(p => p.type === 'roundRobin' && !(p as any).seeding?.groups)
  const groups = rrPhase && tournament ? resolvePhaseGroups(rrPhase as any, tournament.participants, savedGroups) : []
  const grouped = groupEncountersByGroup(groups, allEncounters ?? [])
  const myGroup = grouped.find(g => g.encounters.some(e => e.id === encounter.id))
  const groupEncounters = myGroup?.encounters ?? []
  const myIdx = groupEncounters.findIndex(e => e.id === encounter.id)
  const prevEnc = myIdx > 0 ? groupEncounters[myIdx - 1] : null
  const nextEnc = myIdx >= 0 && myIdx < groupEncounters.length - 1 ? groupEncounters[myIdx + 1] : null
  const encLabel = (e: typeof encounter) => `${teamName(e.participant1Id)} – ${teamName(e.participant2Id)}`

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0 4px', fontSize: '0.9em', flexWrap: 'wrap' }}>
        <Link to={`/tournaments/${encounter.tournamentId}`} style={{ color: '#888', whiteSpace: 'nowrap' }}>
          ← {tournament?.name ?? 'Турнир'}
        </Link>
        {myGroup?.label != null && (
          <span style={{ color: '#888' }}>· Группа {myGroup.label}</span>
        )}
        <span style={{ flex: 1 }} />
        {prevEnc && (
          <Link to={`/encounters/${prevEnc.id}`} title={encLabel(prevEnc)} style={{ color: '#888', whiteSpace: 'nowrap' }}>
            ← {encLabel(prevEnc)}
          </Link>
        )}
        {prevEnc && nextEnc && <span style={{ color: '#ddd' }}>|</span>}
        {nextEnc && (
          <Link
            to={`/encounters/${nextEnc.id}`}
            title={encLabel(nextEnc)}
            style={{
              whiteSpace: 'nowrap',
              fontWeight: nextEnc.status !== 'Completed' ? 600 : undefined,
              color: nextEnc.status === 'Scheduled' ? '#1976d2'
                : nextEnc.status === 'InProgress' ? '#2e7d32'
                : '#888',
            }}
          >
            {encLabel(nextEnc)} →
          </Link>
        )}
      </div>

      {/* Header: teams + aggregate score */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '18px 20px',
        border: '1px solid #e0e0e0', borderRadius: 8, background: '#fafafa', margin: '4px 0 16px',
      }}>
        <div style={{ flex: 1, textAlign: 'right', fontSize: '1.25em', fontWeight: 700 }}>{name1}</div>
        <div style={{ textAlign: 'center', minWidth: 150 }}>
          <div style={{ fontSize: '3em', fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {encounter.score1}
            <span style={{ color: '#ccc', margin: '0 6px', fontWeight: 300 }}>:</span>
            {encounter.score2}
          </div>
          <div style={{ fontSize: '0.8em', color: '#aaa', marginTop: 4 }}>
            до {encounter.targetTotalScore}
          </div>
        </div>
        <div style={{ flex: 1, fontSize: '1.25em', fontWeight: 700 }}>{name2}</div>
      </div>

      {/* Status + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={{
          padding: '2px 10px', borderRadius: 12, fontSize: '0.8em', fontWeight: 600,
          background: isScheduled ? '#e8f4fd' : isInProgress ? '#e8f9ec' : '#f0f0f0',
          color: isScheduled ? '#1976d2' : isInProgress ? '#2e7d32' : '#555',
        }}>
          {BOUT_STATUS_LABEL[encounter.status]}
        </span>

        {isScheduled && bouts.length === 0 && (
          <button onClick={() => generateMut.mutate()} disabled={generateMut.isPending}>
            {generateMut.isPending ? '…' : '⚙ Сгенерировать бои (9)'}
          </button>
        )}
        {isScheduled && bouts.length > 0 && (
          <button onClick={() => statusMut.mutate('InProgress')} disabled={statusMut.isPending}>
            ▶ Начать встречу
          </button>
        )}
        {isInProgress && (
          <button onClick={() => statusMut.mutate('Completed')} disabled={statusMut.isPending}>
            ✓ Завершить встречу
          </button>
        )}
        {isCompleted && (
          <button onClick={() => statusMut.mutate('InProgress')} disabled={statusMut.isPending}>
            ↩ Вернуть в активную
          </button>
        )}
      </div>

      {/* Winner */}
      {isCompleted && (
        <p style={{ textAlign: 'center', fontWeight: 700, fontSize: '1.2em', color: winnerName ? '#2e7d32' : '#555', margin: '0 0 16px' }}>
          {winnerName ? `Победитель: ${winnerName}` : 'Ничья'}
        </p>
      )}

      {/* Tie-break section */}
      {encounter.requiresTieBreak && (
        <TieBreakSection
          encounterId={id!}
          team1={team1}
          team2={team2}
          name1={name1}
          name2={name2}
          onCreated={invalidate}
        />
      )}

      {/* Bouts list */}
      {bouts.length === 0 ? (
        <p style={{ color: '#888' }}>Бои ещё не сгенерированы.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95em' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ ...TH, width: 40, textAlign: 'center' }}>#</th>
              <th style={TH}>{name1}</th>
              <th style={{ ...TH, textAlign: 'center' }}>Счёт</th>
              <th style={TH}>{name2}</th>
              <th style={TH}>Статус</th>
              <th style={{ ...TH, width: 30 }} />
            </tr>
          </thead>
          <tbody>
            {bouts.map((b: Match) => {
              const isCurrent = currentBout?.id === b.id
              const isTieBreak = b.boutNumber === 10
              return (
                <tr key={b.id} style={{ background: isCurrent ? '#fffbe6' : undefined }}>
                  <td style={{ ...TD, textAlign: 'center', fontWeight: 700, color: isTieBreak ? '#a86500' : '#555' }}>
                    {isTieBreak ? 'ТБ' : b.boutNumber}
                  </td>
                  <td style={TD}><Link to={`/matches/${b.id}`}>{fighterName(b.fighter1Id)}</Link></td>
                  <td style={{ ...TD, textAlign: 'center', fontWeight: 700 }}>
                    {b.status === 'Scheduled' ? 'vs' : `${b.score1} : ${b.score2}`}
                  </td>
                  <td style={TD}><Link to={`/matches/${b.id}`}>{fighterName(b.fighter2Id)}</Link></td>
                  <td style={{ ...TD, color: BOUT_STATUS_COLOR[b.status], whiteSpace: 'nowrap' }}>
                    {BOUT_STATUS_LABEL[b.status]}
                    {isCurrent && <span style={{ color: '#a86500', marginLeft: 6 }}>· текущий</span>}
                  </td>
                  <td style={TD}><Link to={`/matches/${b.id}`}>→</Link></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Tie-break: pick one fighter from each team ─────────────────────────────

function TieBreakSection({
  encounterId, team1, team2, name1, name2, onCreated,
}: {
  encounterId: string
  team1?: Team
  team2?: Team
  name1: string
  name2: string
  onCreated: () => void
}) {
  const [f1, setF1] = useState('')
  const [f2, setF2] = useState('')

  const mut = useMutation({
    mutationFn: () =>
      encountersApi.createTieBreak(encounterId, { participant1Id: f1, participant2Id: f2 }),
    onSuccess: () => { setF1(''); setF2(''); onCreated() },
    onError: (err: unknown) =>
      alert((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Не удалось создать tie-break'),
  })

  return (
    <div style={{ border: '1px solid #f0c000', background: '#fffbe6', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 8px', color: '#a86500' }}>Ничья — нужен tie-break</h3>
      <p style={{ margin: '0 0 12px', fontSize: '0.9em', color: '#777' }}>
        Выберите по одному бойцу от каждой команды для решающего боя (до первого touche, 60 секунд).
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={f1} onChange={e => setF1(e.target.value)} style={{ minWidth: 160 }}>
          <option value="">— {name1} —</option>
          {(team1?.members ?? []).map(m => (
            <option key={m.fighterId} value={m.fighterId}>{m.firstName} {m.lastName}</option>
          ))}
        </select>
        <span style={{ color: '#888' }}>vs</span>
        <select value={f2} onChange={e => setF2(e.target.value)} style={{ minWidth: 160 }}>
          <option value="">— {name2} —</option>
          {(team2?.members ?? []).map(m => (
            <option key={m.fighterId} value={m.fighterId}>{m.firstName} {m.lastName}</option>
          ))}
        </select>
        <button disabled={!f1 || !f2 || mut.isPending} onClick={() => mut.mutate()}>
          {mut.isPending ? '…' : 'Создать tie-break'}
        </button>
      </div>
    </div>
  )
}

const TH: React.CSSProperties = {
  border: '1px solid #ddd', padding: '5px 10px', textAlign: 'left', fontWeight: 600,
}
const TD: React.CSSProperties = {
  border: '1px solid #ddd', padding: '6px 10px',
}
