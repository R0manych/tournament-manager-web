import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tournamentsApi } from '../api/tournaments'
import { groupsApi, type SaveGroupItem } from '../api/groups'
import TournamentBracketView from './bracket/TournamentBracketView'
import type { Encounter, Match, MatchPlacement, TournamentParticipant, TournamentStatus } from '../api/types'
import { TOURNAMENT_STATUS_LABELS } from '../api/types'

// Which forced write the organiser is being asked to confirm (B-2).
type ForcedWrite = 'replace' | 'delete'

interface Props {
  tournamentId: string
  status: TournamentStatus
  participants: TournamentParticipant[]
  defaultFightDurationSeconds?: number
  allMatches?: Match[]
  encounters?: Encounter[]
  placements?: MatchPlacement[]
  // Single group-panel action: persist composition + generate group-stage fights.
  groupsGenerating?: boolean
  generateGroupsLabel?: string
  onGenerateGroups?: (phaseId: string, groups: SaveGroupItem[]) => void
}

export default function TournamentFormatSection({
  tournamentId, status, participants, defaultFightDurationSeconds,
  allMatches, encounters, placements, groupsGenerating, generateGroupsLabel, onGenerateGroups,
}: Props) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [showBracket, setShowBracket] = useState(true)

  // The server freezes the format outside Draft (TournamentSetupGuard) and only
  // lets it through with ?force=true — mirror that criterion, not matchesCount.
  const isDraft = status === 'Draft'
  const [pendingForce, setPendingForce] = useState<ForcedWrite | null>(null)
  // The file is chosen before the warning, so a cancelled picker can never leave
  // a "force" flag armed for the next, unrelated replace.
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [clearedNote, setClearedNote] = useState<string | null>(null)

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

  // A forced write prunes TournamentGroups server-side, and with them the bracket
  // placements of phases the new format no longer describes (инвариант 45); the cached
  // composition would otherwise keep drawing groups and cells that no longer exist.
  // X-Groups-Cleared / X-Placements-Cleared tell how many.
  const afterFormatWrite = (groupsCleared: number, placementsCleared: number) => {
    qc.invalidateQueries({ queryKey: ['tournament-format', tournamentId] })
    qc.invalidateQueries({ queryKey: ['tournament-groups', tournamentId] })
    // Размещения живут внутри встреч, поэтому обнулившиеся ячейки видны только
    // после перечитывания списка встреч.
    qc.invalidateQueries({ queryKey: ['tournament-matches', tournamentId] })
    const parts = [
      groupsCleared > 0 ? `составов групп: ${groupsCleared}` : null,
      placementsCleared > 0 ? `размещений встреч в сетке: ${placementsCleared}` : null,
    ].filter(Boolean)
    setClearedNote(parts.length > 0 ? `Удалено — ${parts.join('; ')}.` : null)
  }

  const problemMessage = (err: unknown, fallback: string) => {
    const e = err as { problem?: { detail?: string; title?: string } }
    return e?.problem?.detail ?? e?.problem?.title ?? fallback
  }

  const uploadMutation = useMutation({
    mutationFn: ({ file, force }: { file: File; force: boolean }) =>
      tournamentsApi.format.upload(tournamentId, file, force),
    onSuccess: (res) => {
      setUploadError(null)
      afterFormatWrite(res.groupsCleared, res.placementsCleared)
    },
    onError: (err: unknown) => setUploadError(problemMessage(err, 'Ошибка загрузки')),
  })

  const deleteMutation = useMutation({
    mutationFn: (force: boolean) => tournamentsApi.format.delete(tournamentId, force),
    onSuccess: (res) => {
      setUploadError(null)
      afterFormatWrite(res.groupsCleared, res.placementsCleared)
    },
    onError: (err: unknown) => setUploadError(problemMessage(err, 'Ошибка удаления формата')),
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

  // In Draft the upload is the plain, unforced call; outside it the file waits for
  // the organiser to confirm the consequences.
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadError(null)
    setClearedNote(null)
    if (isDraft) uploadMutation.mutate({ file, force: false })
    else {
      setPendingFile(file)
      setPendingForce('replace')
    }
  }

  const handleDeleteClick = () => {
    setUploadError(null)
    setClearedNote(null)
    if (isDraft) deleteMutation.mutate(false)
    else setPendingForce('delete')
  }

  const cancelForced = () => {
    setPendingForce(null)
    setPendingFile(null)
  }

  const confirmForced = () => {
    if (pendingForce === 'replace') {
      if (pendingFile) uploadMutation.mutate({ file: pendingFile, force: true })
    } else if (pendingForce === 'delete') {
      deleteMutation.mutate(true)
    }
    cancelForced()
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
            <button type="button" onClick={handleDownload} disabled={downloading}>
              {downloading ? 'Скачивание...' : 'Скачать YAML'}
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending ? 'Загрузка...' : isDraft ? 'Заменить' : 'Заменить...'}
            </button>
            <button
              type="button"
              onClick={handleDeleteClick}
              disabled={deleteMutation.isPending}
              style={{ color: '#cc0000' }}
            >
              {isDraft ? 'Удалить' : 'Удалить...'}
            </button>
          </div>

          {!isDraft && <FrozenNote status={status} />}

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
                placements={placements}
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
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploadMutation.isPending}
          >
            {uploadMutation.isPending ? 'Загрузка...' : isDraft ? 'Загрузить YAML' : 'Загрузить YAML...'}
          </button>
          {!isDraft && <FrozenNote status={status} />}
        </div>
      )}

      {uploadError && <p style={{ color: '#cc0000', marginTop: 8 }} role="alert">{uploadError}</p>}
      {clearedNote && <p style={{ color: '#8a6d00', marginTop: 8 }} role="status">{clearedNote}</p>}

      <input
        ref={fileRef}
        type="file"
        accept=".yaml,.yml"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {pendingForce && (
        <ForceConfirmDialog
          action={pendingForce}
          status={status}
          fileName={pendingFile?.name}
          onCancel={cancelForced}
          onConfirm={confirmForced}
        />
      )}
    </section>
  )
}

// Same criterion as the server: everything outside Draft is frozen, and the honest
// way back is the rollback at the tournament status (it deletes generated matches).
function FrozenNote({ status }: { status: TournamentStatus }) {
  return (
    <p style={{ fontSize: '0.85em', color: '#8a6d00', marginTop: 4 }}>
      Формат заморожен: турнир в статусе «{TOURNAMENT_STATUS_LABELS[status]}», правки
      возможны только в черновике. Верните турнир в черновик кнопкой у статуса —
      либо замените формат принудительно, приняв последствия.
    </p>
  )
}

interface ForceConfirmDialogProps {
  action: ForcedWrite
  status: TournamentStatus
  fileName?: string
  onCancel: () => void
  onConfirm: () => void
}

function ForceConfirmDialog({ action, status, fileName, onCancel, onConfirm }: ForceConfirmDialogProps) {
  const isReplace = action === 'replace'
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 100,
      }}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="format-force-title"
        style={{
          background: '#fff', borderRadius: 8, padding: 20,
          maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <h3 id="format-force-title" style={{ marginTop: 0 }}>
          {isReplace ? 'Заменить формат начатого турнира?' : 'Удалить формат начатого турнира?'}
        </h3>
        <p style={{ marginBottom: 8 }}>
          Турнир в статусе «{TOURNAMENT_STATUS_LABELS[status]}» — обычно формат в нём
          заморожен. Принудительная операция сделает следующее:
        </p>
        <ul style={{ marginTop: 0, paddingLeft: 20 }}>
          <li>
            {isReplace
              ? 'Сохранённые составы групп фаз, которых нет в новом формате, будут удалены (составы совпавших фаз сохранятся).'
              : 'Все сохранённые составы групп турнира будут удалены.'}
          </li>
          <li>
            {isReplace
              ? 'Размещения встреч в ячейках сетки для исчезнувших фаз тоже будут удалены — эти встречи выпадут из сетки.'
              : 'Все размещения встреч в ячейках сетки будут удалены — сетка опустеет.'}
          </li>
          <li>
            Уже сгенерированные встречи и серии останутся как есть — они могут не
            соответствовать новой сетке.
          </li>
          <li>Отменить операцию нельзя.</li>
        </ul>
        <p style={{ color: '#555', fontSize: '0.9em' }}>
          Безопасный путь — вернуть турнир в черновик кнопкой у статуса: сгенерированные
          встречи будут удалены, и формат станет редактируемым штатно.
        </p>
        {isReplace && fileName && (
          <p style={{ fontSize: '0.9em' }}>Файл: <strong>{fileName}</strong></p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={onCancel} autoFocus>Отмена</button>
          <button type="button" onClick={onConfirm} style={{ color: '#cc0000' }}>
            {isReplace ? 'Понимаю риски — заменить' : 'Понимаю риски — удалить'}
          </button>
        </div>
      </div>
    </div>
  )
}
