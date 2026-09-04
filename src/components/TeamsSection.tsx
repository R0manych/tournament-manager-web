import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { teamsApi } from '../api/teams'
import { tournamentsApi } from '../api/tournaments'
import { fightersApi } from '../api/fighters'
import type { Team, TournamentParticipant } from '../api/types'

const POSITIONS = [1, 2, 3]

interface Props {
  tournamentId: string
  participants: TournamentParticipant[]
}

export default function TeamsSection({ tournamentId, participants }: Props) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [club, setClub] = useState('')
  const [city, setCity] = useState('')

  const { data: teams, isLoading: teamsLoading, isError: teamsFailed } = useQuery({
    queryKey: ['teams', tournamentId],
    queryFn: () => teamsApi.listByTournament(tournamentId),
  })

  const { data: allFighters } = useQuery({
    queryKey: ['fighters'],
    queryFn: () => fightersApi.list(),
  })

  const registeredIds = new Set(participants.map(p => p.participantId))

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['teams', tournamentId] })
    qc.invalidateQueries({ queryKey: ['tournaments', tournamentId] })
  }

  // Создание и заявка — два разных действия (ТЗ §5.2): состав из трёх бойцов
  // проверяется «при попытке зарегистрировать команду на турнир».
  //
  // Раньше это был один шаг, и он давал две поломки сразу: пустая команда
  // попадала в жеребьёвку и в группы, а ломалась только в разгар турнира —
  // 409 на `generate-bouts`; а если падал второй вызов, команда оставалась
  // созданной, но не заявленной, и заявить её было уже нечем.
  const createTeamMut = useMutation({
    mutationFn: () => teamsApi.create(tournamentId, {
      name,
      club: club || undefined,
      city: city || undefined,
    }),
    onSuccess: () => {
      setName(''); setClub(''); setCity('')
      invalidate()
    },
    onError: (err: unknown) =>
      alert((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Ошибка создания команды'),
  })

  const registerTeamMut = useMutation({
    mutationFn: (teamId: string) =>
      tournamentsApi.addParticipant(tournamentId, teamId, participants.length + 1),
    onSuccess: invalidate,
    onError: (err: unknown) =>
      alert((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Не удалось заявить команду'),
  })

  const deleteTeamMut = useMutation({
    mutationFn: async (teamId: string) => {
      // Unregister first (participant row references the team id), then delete.
      if (registeredIds.has(teamId)) {
        await tournamentsApi.removeParticipant(tournamentId, teamId).catch(() => {})
      }
      await teamsApi.delete(teamId)
    },
    onSuccess: invalidate,
    onError: (err: unknown) =>
      alert((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Не удалось удалить команду (есть встречи?)'),
  })

  // Fighters already used in any team of this tournament — cannot be reused.
  const usedFighterIds = new Set((teams ?? []).flatMap(t => t.members.map(m => m.fighterId)))

  return (
    <div>
      <h2>Команды ({teams?.length ?? 0})</h2>

      {teamsLoading && <p style={{ color: '#888' }}>Загрузка команд…</p>}
      {/* Ошибка загрузки не должна выглядеть как «команд нет»: иначе команды
          заводят повторно поверх уже существующих. */}
      {teamsFailed && (
        <p style={{ color: '#c00' }} role="alert">
          Не удалось загрузить команды. Обновите страницу — список ниже не полон.
        </p>
      )}
      {!teamsLoading && !teamsFailed && (teams?.length ?? 0) === 0 && (
        <p style={{ color: '#888' }}>Команд пока нет</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(teams ?? []).map(team => (
          <TeamCard
            key={team.id}
            team={team}
            registered={registeredIds.has(team.id)}
            availableFighters={(allFighters ?? []).filter(
              f => !usedFighterIds.has(f.id) || team.members.some(m => m.fighterId === f.id)
            )}
            onDelete={() => {
              if (confirm(`Удалить команду «${team.name}»?`)) deleteTeamMut.mutate(team.id)
            }}
            onRegister={() => registerTeamMut.mutate(team.id)}
            registering={registerTeamMut.isPending}
          />
        ))}
      </div>

      <form
        onSubmit={e => { e.preventDefault(); if (name.trim()) createTeamMut.mutate() }}
        style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 }}
      >
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder="Название команды *" required style={{ minWidth: 180 }}
        />
        <input value={club} onChange={e => setClub(e.target.value)} placeholder="Клуб" style={{ width: 130 }} />
        <input value={city} onChange={e => setCity(e.target.value)} placeholder="Город" style={{ width: 110 }} />
        <button type="submit" disabled={!name.trim() || createTeamMut.isPending}>
          {createTeamMut.isPending ? '…' : '+ Создать команду'}
        </button>
        <span style={{ color: '#888', fontSize: '0.85em' }}>
          Заявить на турнир — кнопкой на карточке, когда в составе трое
        </span>
      </form>
    </div>
  )
}

// ─── Team card with roster (3 positions) ────────────────────────────────────

function TeamCard({
  team, registered, availableFighters, onDelete, onRegister, registering,
}: {
  team: Team
  registered: boolean
  availableFighters: Array<{ id: string; firstName: string; lastName: string; club?: string }>
  onDelete: () => void
  onRegister: () => void
  registering: boolean
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const invalidate = () => qc.invalidateQueries({ queryKey: ['teams', team.tournamentId] })

  const addMemberMut = useMutation({
    mutationFn: ({ fighterId, position }: { fighterId: string; position: number }) =>
      teamsApi.addMember(team.id, { fighterId, position }),
    onSuccess: invalidate,
    onError: (err: unknown) =>
      alert((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Ошибка добавления бойца'),
  })
  const removeMemberMut = useMutation({
    mutationFn: (fighterId: string) => teamsApi.removeMember(team.id, fighterId),
    onSuccess: invalidate,
    onError: (err: unknown) =>
      alert((err as { problem?: { detail?: string } })?.problem?.detail ?? 'Ошибка удаления бойца'),
  })

  const byPosition = new Map(team.members.map(m => [m.position, m]))
  const full = team.members.length === 3

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
          cursor: 'pointer', background: '#f7f7f7',
        }}
      >
        <span style={{ color: '#888' }}>{open ? '▾' : '▸'}</span>
        <strong>{team.name}</strong>
        {(team.club || team.city) && (
          <span style={{ color: '#888', fontSize: '0.85em' }}>
            {[team.club, team.city].filter(Boolean).join(', ')}
          </span>
        )}
        <span style={{
          fontSize: '0.78em', padding: '1px 8px', borderRadius: 10,
          background: full ? '#e8f9ec' : '#fff4e5',
          color: full ? '#2e7d32' : '#a86500',
        }}>
          {team.members.length}/3
        </span>
        {!registered && (
          <span style={{ fontSize: '0.78em', color: '#c00' }}>не зарегистрирована</span>
        )}
        <span style={{ flex: 1 }} />
        {!registered && (
          <button
            onClick={e => { e.stopPropagation(); onRegister() }}
            disabled={!full || registering}
            title={full
              ? 'Заявить команду на турнир'
              : 'Сначала укомплектуйте состав: ровно три бойца на позициях 1–3 (ТЗ §5.2). ' +
                'Неукомплектованная команда доедет до групп и сломается на генерации боёв серии.'}
            style={{ fontSize: '0.85em', marginRight: 8 }}
          >
            {registering ? '…' : 'Заявить на турнир'}
          </button>
        )}
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          style={{ color: '#c00', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85em' }}
        >
          Удалить
        </button>
      </div>

      {open && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
          <tbody>
            {POSITIONS.map(pos => {
              const m = byPosition.get(pos)
              return (
                <tr key={pos} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '6px 12px', width: 40, color: '#888' }}>#{pos}</td>
                  {m ? (
                    <>
                      <td style={{ padding: '6px 12px' }}>
                        {m.firstName} {m.lastName}
                        {m.club && <span style={{ color: '#888', marginLeft: 6 }}>({m.club})</span>}
                      </td>
                      <td style={{ padding: '6px 12px', textAlign: 'right' }}>
                        <button
                          onClick={() => removeMemberMut.mutate(m.fighterId)}
                          disabled={removeMemberMut.isPending}
                          style={{ color: '#c00', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85em' }}
                        >
                          Убрать
                        </button>
                      </td>
                    </>
                  ) : (
                    <td style={{ padding: '6px 12px' }} colSpan={2}>
                      <AddMemberControl
                        fighters={availableFighters}
                        disabled={addMemberMut.isPending}
                        onAdd={fighterId => addMemberMut.mutate({ fighterId, position: pos })}
                      />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function AddMemberControl({
  fighters, disabled, onAdd,
}: {
  fighters: Array<{ id: string; firstName: string; lastName: string; club?: string }>
  disabled: boolean
  onAdd: (fighterId: string) => void
}) {
  const [sel, setSel] = useState('')
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <select value={sel} onChange={e => setSel(e.target.value)} style={{ minWidth: 180 }}>
        <option value="">— выбрать бойца —</option>
        {fighters.map(f => (
          <option key={f.id} value={f.id}>
            {f.firstName} {f.lastName}{f.club ? ` (${f.club})` : ''}
          </option>
        ))}
      </select>
      <button
        disabled={!sel || disabled}
        onClick={() => { if (sel) { onAdd(sel); setSel('') } }}
      >
        + В состав
      </button>
    </div>
  )
}
