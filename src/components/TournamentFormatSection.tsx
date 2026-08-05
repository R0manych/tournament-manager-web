import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tournamentsApi } from '../api/tournaments'
import { groupsApi, type SaveGroupItem } from '../api/groups'
import TournamentBracketView from './bracket/TournamentBracketView'
import type { Encounter, Match, TournamentParticipant, TournamentStatus } from '../api/types'

interface Props {
  tournamentId: string
  status: TournamentStatus
  hasMatches: boolean
  participants: TournamentParticipant[]
  defaultFightDurationSeconds?: number
  allMatches?: Match[]
  encounters?: Encounter[]
  // Single group-panel action: persist composition + generate group-stage fights.
  groupsGenerating?: boolean
  generateGroupsLabel?: string
  onGenerateGroups?: (phaseId: string, groups: SaveGroupItem[]) => void
}

export default function TournamentFormatSection({
  tournamentId, status, hasMatches, participants, defaultFightDurationSeconds,
  allMatches, encounters, groupsGenerating, generateGroupsLabel, onGenerateGroups,
}: Props) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [showBracket, setShowBracket] = useState(true)

  const { data: format, isLoading, isError } = useQuery({
    queryKey: ['tournament-format', tournamentId],
    queryFn: () => tournamentsApi.format.get(tournamentId),
    retry: (failureCount, error: unknown) => {
      const err = error as { status?: number }
      if (err?.status === 404) return false
      return failureCount < 2
    },
  })

  const { data: savedGroups } = useQuery({
    queryKey: ['tournament-groups', tournamentId],
    queryFn: () => groupsApi.list(tournamentId),
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => tournamentsApi.format.upload(tournamentId, file),
    onSuccess: () => {
      setUploadError(null)
      qc.invalidateQueries({ queryKey: ['tournament-format', tournamentId] })
    },
    onError: (err: unknown) => {
      const e = err as { problem?: { detail?: string; title?: string } }
      setUploadError(e?.problem?.detail ?? e?.problem?.title ?? 'Ошибка загрузки')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => tournamentsApi.format.delete(tournamentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tournament-format', tournamentId] })
    },
  })

  const [downloading, setDownloading] = useState(false)
  const handleDownload = async () => {
    setDownloading(true)
    try {
      await tournamentsApi.format.downloadRaw(tournamentId, 'format.yaml')
    } finally {
      setDownloading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    uploadMutation.mutate(file)
    e.target.value = ''
  }

  if (isLoading) return <section><h2>Формат турнира</h2><p>Загрузка...</p></section>

  const formatLoaded = !isError && format != null

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Формат турнира</h2>
        {formatLoaded && (
          <button
            onClick={() => setShowBracket(v => !v)}
            style={{ fontSize: 13, padding: '2px 10px' }}
          >
            {showBracket ? 'Скрыть сетку' : 'Показать сетку'}
          </button>
        )}
      </div>

      {formatLoaded ? (
        <div>
          <p style={{ marginBottom: 6 }}><strong>{format.name}</strong></p>
          {format.description && (
            <p style={{ color: '#555', fontSize: '0.9em', marginBottom: 6 }}>{format.description}</p>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button onClick={handleDownload} disabled={downloading}>
              {downloading ? 'Скачивание...' : 'Скачать YAML'}
            </button>
            {!hasMatches && (
              <>
                <button onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending}>
                  Заменить
                </button>
                <button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  style={{ color: '#cc0000' }}
                >
                  Удалить
                </button>
              </>
            )}
          </div>

          {showBracket && (
            <div style={{
              border: '1px solid #e8e8e8',
              borderRadius: 8,
              padding: 20,
              background: '#fafafa',
            }}>
              <TournamentBracketView
                format={format}
                participants={participants}
                fightDurationSeconds={defaultFightDurationSeconds}
                allMatches={allMatches}
                encounters={encounters}
                savedGroups={savedGroups}
                groupsEditable={status === 'Draft'}
                groupsGenerating={groupsGenerating}
                groupsLockedNote={
                  status === 'Scheduled'
                    ? 'Группы заблокированы: бои сгенерированы. Чтобы изменить состав, вернитесь к группам кнопкой у статуса турнира (сгенерированные бои будут удалены).'
                    : status === 'Active'
                      ? 'Группы заблокированы: бои начались. Изменение возможно только после сброса боёв (кнопка у статуса турнира).'
                      : undefined
                }
                generateGroupsLabel={generateGroupsLabel}
                onGenerateGroups={onGenerateGroups}
              />
            </div>
          )}
        </div>
      ) : (
        <div>
          <p style={{ color: '#666', marginBottom: 8 }}>Формат не загружен</p>
          <button onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending || hasMatches}>
            {uploadMutation.isPending ? 'Загрузка...' : 'Загрузить YAML'}
          </button>
          {hasMatches && (
            <p style={{ fontSize: '0.85em', color: '#999', marginTop: 4 }}>
              Формат заморожен — у турнира уже есть встречи
            </p>
          )}
        </div>
      )}

      {uploadError && <p style={{ color: '#cc0000', marginTop: 8 }}>{uploadError}</p>}

      <input
        ref={fileRef}
        type="file"
        accept=".yaml,.yml"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </section>
  )
}
