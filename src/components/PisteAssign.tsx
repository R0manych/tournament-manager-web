import { useMutation, useQueryClient } from '@tanstack/react-query'
import { encountersApi } from '../api/encounters'
import { matchesApi } from '../api/matches'
import type { Match } from '../api/types'
import { usePistes } from './usePistes'

type Target =
  | { kind: 'match'; match: Match }
  | { kind: 'encounter'; id: string; tournamentId: string; pisteId?: string }

/**
 * Селектор ристалища для встречи или серии (docs/09 §6.2). Подтверждения нет:
 * операция обратима (инвариант 58).
 *
 * Турнир без ристалищ (§3.3) — основной сценарий маленького турнира, а не
 * недонастроенный: там селектор не показывается вовсе, чтобы не навязывать
 * площадку, которой нет.
 */
export default function PisteAssign({
  target,
  disabled,
  disabledTitle,
  compact,
}: {
  target: Target
  /** Терминальный статус: назначать некуда, историю переписывать нельзя (инв. 55). */
  disabled?: boolean
  disabledTitle?: string
  compact?: boolean
}) {
  const qc = useQueryClient()
  const tournamentId =
    target.kind === 'match' ? target.match.tournamentId : target.tournamentId
  // Текущее назначение — собственное, не эффективное: у боута оно всегда пусто
  // (инвариант 54), и селектор ему не показывается вовсе.
  const pisteId = target.kind === 'match' ? target.match.pisteId : target.pisteId
  const { data: pistes } = usePistes(tournamentId)

  const assignMut = useMutation({
    mutationFn: (next: string | null) =>
      target.kind === 'match'
        ? matchesApi.assignPiste(target.match, next)
        : encountersApi.assignPiste(target.id, next),
    onSuccess: () => {
      const t = tournamentId
      // Ристалища — ради `currentMatchId`; списки встреч — ради подписи
      // площадки в строках; боуты серии наследуют её, поэтому обновляем и их.
      qc.invalidateQueries({ queryKey: ['pistes', t] })
      qc.invalidateQueries({ queryKey: ['tournament-matches', t] })
      qc.invalidateQueries({ queryKey: ['matches', t] })
      if (target.kind === 'match') {
        qc.invalidateQueries({ queryKey: ['matches', target.match.id] })
      } else {
        qc.invalidateQueries({ queryKey: ['encounters', target.id] })
        qc.invalidateQueries({ queryKey: ['encounters', t] })
      }
    },
    onError: (err: unknown) =>
      alert(
        (err as { problem?: { detail?: string } })?.problem?.detail ??
          'Не удалось назначить ристалище'
      ),
  })

  if (!pistes || pistes.length === 0) return null

  return (
    <select
      value={pisteId ?? ''}
      onChange={e => assignMut.mutate(e.target.value || null)}
      disabled={disabled || assignMut.isPending}
      title={disabled ? disabledTitle : 'Ристалище, на котором идёт встреча'}
      style={{
        fontSize: compact ? '0.85em' : undefined,
        maxWidth: compact ? 150 : undefined,
        color: pisteId ? undefined : '#888',
      }}
    >
      <option value="">— без ристалища —</option>
      {pistes.map(p => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  )
}
