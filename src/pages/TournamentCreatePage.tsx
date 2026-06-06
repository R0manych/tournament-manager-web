import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, Link } from 'react-router-dom'
import { tournamentsApi } from '../api/tournaments'
import type { CreateTournamentRequest } from '../api/types'

export default function TournamentCreatePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [form, setForm] = useState<CreateTournamentRequest>({
    name: '',
    description: '',
    nomination: '',
    location: '',
    startDate: '',
    endDate: '',
    participantKind: 'Fighter',
    defaultRoundDurationSeconds: undefined,
    defaultMaxDoubles: undefined,
    defaultMaxWarnings: undefined,
    defaultTeamTargetScore: undefined,
    defaultTeamBoutDurationSeconds: undefined,
  })

  const isTeam = form.participantKind === 'Team'

  const mut = useMutation({
    mutationFn: () => {
      const payload: CreateTournamentRequest = {
        name: form.name,
        ...(form.description && { description: form.description }),
        ...(form.nomination && { nomination: form.nomination }),
        ...(form.location && { location: form.location }),
        startDate: form.startDate,
        endDate: form.endDate,
        participantKind: form.participantKind,
        ...(form.defaultRoundDurationSeconds != null && { defaultRoundDurationSeconds: form.defaultRoundDurationSeconds }),
        ...(form.defaultMaxDoubles != null && { defaultMaxDoubles: form.defaultMaxDoubles }),
        ...(form.defaultMaxWarnings != null && { defaultMaxWarnings: form.defaultMaxWarnings }),
        ...(isTeam && form.defaultTeamTargetScore != null && { defaultTeamTargetScore: form.defaultTeamTargetScore }),
        ...(isTeam && form.defaultTeamBoutDurationSeconds != null && { defaultTeamBoutDurationSeconds: form.defaultTeamBoutDurationSeconds }),
      }
      return tournamentsApi.create(payload)
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['tournaments'] })
      navigate(`/tournaments/${created.id}`)
    },
  })

  function setField<K extends keyof CreateTournamentRequest>(key: K, value: CreateTournamentRequest[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleNumericField(key: keyof CreateTournamentRequest, raw: string) {
    setField(key, raw === '' ? undefined : Number(raw))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    mut.mutate()
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Link to="/">← Назад</Link>
        <h1 style={{ margin: 0 }}>Новый турнир</h1>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={labelStyle}>
          Название *
          <input
            required
            value={form.name}
            onChange={e => setField('name', e.target.value)}
            style={inputStyle}
            placeholder="Открытый чемпионат по лонгсворду"
          />
        </label>

        <label style={labelStyle}>
          Режим участия *
          <select
            value={form.participantKind ?? 'Fighter'}
            onChange={e => setField('participantKind', e.target.value as CreateTournamentRequest['participantKind'])}
            style={inputStyle}
          >
            <option value="Fighter">Одиночный (бойцы)</option>
            <option value="Team">Командный (команды 3×3, FIE relay)</option>
          </select>
        </label>

        <label style={labelStyle}>
          Номинация
          <input
            value={form.nomination ?? ''}
            onChange={e => setField('nomination', e.target.value)}
            style={inputStyle}
            placeholder="Лонгсворд, сабля…"
          />
        </label>

        <label style={labelStyle}>
          Место проведения
          <input
            value={form.location ?? ''}
            onChange={e => setField('location', e.target.value)}
            style={inputStyle}
            placeholder="Москва, зал «Арсенал»"
          />
        </label>

        <label style={labelStyle}>
          Описание
          <textarea
            value={form.description ?? ''}
            onChange={e => setField('description', e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </label>

        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            Дата начала *
            <input
              required
              type="date"
              value={form.startDate}
              onChange={e => setField('startDate', e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={{ ...labelStyle, flex: 1 }}>
            Дата окончания *
            <input
              required
              type="date"
              value={form.endDate}
              min={form.startDate}
              onChange={e => setField('endDate', e.target.value)}
              style={inputStyle}
            />
          </label>
        </div>

        <details>
          <summary style={{ cursor: 'pointer', color: '#555', marginBottom: 8 }}>
            Настройки боёв по умолчанию
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
            <label style={labelStyle}>
              Длительность раунда (сек)
              <input
                type="number" min={1}
                value={form.defaultRoundDurationSeconds ?? ''}
                onChange={e => handleNumericField('defaultRoundDurationSeconds', e.target.value)}
                style={{ ...inputStyle, width: 100 }}
                placeholder="180"
              />
            </label>
            <label style={labelStyle}>
              Макс. двойных ударов
              <input
                type="number" min={0}
                value={form.defaultMaxDoubles ?? ''}
                onChange={e => handleNumericField('defaultMaxDoubles', e.target.value)}
                style={{ ...inputStyle, width: 100 }}
                placeholder="3"
              />
            </label>
            <label style={labelStyle}>
              Макс. предупреждений
              <input
                type="number" min={0}
                value={form.defaultMaxWarnings ?? ''}
                onChange={e => handleNumericField('defaultMaxWarnings', e.target.value)}
                style={{ ...inputStyle, width: 100 }}
                placeholder="3"
              />
            </label>
            {isTeam && (
              <>
                <label style={labelStyle}>
                  Целевой счёт серии (командная)
                  <input
                    type="number" min={1}
                    value={form.defaultTeamTargetScore ?? ''}
                    onChange={e => handleNumericField('defaultTeamTargetScore', e.target.value)}
                    style={{ ...inputStyle, width: 100 }}
                    placeholder="45"
                  />
                </label>
                <label style={labelStyle}>
                  Длительность bout (сек)
                  <input
                    type="number" min={1}
                    value={form.defaultTeamBoutDurationSeconds ?? ''}
                    onChange={e => handleNumericField('defaultTeamBoutDurationSeconds', e.target.value)}
                    style={{ ...inputStyle, width: 100 }}
                    placeholder="60"
                  />
                </label>
              </>
            )}
          </div>
        </details>

        {mut.isError && (
          <p style={{ color: '#c00', margin: 0 }}>
            {(mut.error as { problem?: { detail?: string } })?.problem?.detail ?? 'Ошибка создания турнира'}
          </p>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
          <button type="submit" disabled={mut.isPending}>
            {mut.isPending ? 'Создание…' : 'Создать турнир'}
          </button>
          <Link to="/">Отмена</Link>
        </div>
      </form>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: '0.95em',
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: '1em',
  borderRadius: 4,
  border: '1px solid #ccc',
}
