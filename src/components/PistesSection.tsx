import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { pistesApi } from '../api/pistes'
import type { Piste } from '../api/types'
import { usePistes } from './usePistes'
import { pisteBoardPath } from '../lib/pisteBoard'

/**
 * Ристалища турнира (АР-17, docs/09 §6.1): создание, переименование, порядок,
 * удаление. Порядок отвечает только за то, как площадки перечислены в списках
 * и селекторах: номер из `orderIndex` не выводится, имя задаёт организатор
 * («Ристалище 1», «Синее», «Большой зал»).
 */
export default function PistesSection({ tournamentId }: { tournamentId: string }) {
  const qc = useQueryClient()
  const { data: pistes } = usePistes(tournamentId)
  const [name, setName] = useState('')

  const invalidate = () => qc.invalidateQueries({ queryKey: ['pistes', tournamentId] })
  const onError = (fallback: string) => (err: unknown) =>
    alert((err as { problem?: { detail?: string } })?.problem?.detail ?? fallback)

  const createMut = useMutation({
    mutationFn: () => pistesApi.create(tournamentId, { name: name.trim() }),
    onSuccess: () => {
      setName('')
      invalidate()
    },
    onError: onError('Не удалось создать ристалище'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, name, orderIndex }: { id: string; name: string; orderIndex: number }) =>
      pistesApi.update(id, { name, orderIndex }),
    onSuccess: invalidate,
    onError: onError('Не удалось сохранить ристалище'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => pistesApi.delete(id),
    onSuccess: invalidate,
    // 409 при назначенных встречах (инвариант 57) — сервер объясняет, почему.
    onError: onError('Не удалось удалить ристалище: на нём есть назначенные встречи'),
  })

  const list = pistes ?? []

  // Меняем местами соседей по `orderIndex`: сервер сортирует по нему, и после
  // двух записей порядок в списке совпадает с порядком площадок в зале.
  //
  // Строго последовательно и с откатом: две независимые записи оставляли двум
  // ристалищам ОДИН `orderIndex`, если вторая падала (уникального индекса на
  // бэке нет). Дальше порядок решал `CreatedAt`, и кнопки ↑/↓ для этой пары
  // переставали что-либо менять — с одним лишь alert'ом в объяснение.
  const swapMut = useMutation({
    mutationFn: async ({ a, b }: { a: Piste; b: Piste }) => {
      await pistesApi.update(a.id, { name: a.name, orderIndex: b.orderIndex })
      try {
        await pistesApi.update(b.id, { name: b.name, orderIndex: a.orderIndex })
      } catch (err) {
        // Возвращаем первую площадку на место: одинаковый порядок у двух
        // ристалищ хуже, чем несостоявшаяся перестановка.
        await pistesApi.update(a.id, { name: a.name, orderIndex: a.orderIndex }).catch(() => {})
        throw err
      }
    },
    onSuccess: invalidate,
    onError: (err: unknown) => {
      invalidate()
      onError('Не удалось изменить порядок ристалищ')(err)
    },
  })
  const swap = (a: Piste, b: Piste) => swapMut.mutate({ a, b })

  return (
    <div style={{ margin: '16px 0' }}>
      <h2 style={{ marginBottom: 8 }}>Ристалища {list.length > 0 && `(${list.length})`}</h2>

      {list.length === 0 ? (
        <p style={{ color: '#888', margin: '0 0 8px' }}>
          Ристалища нужны, если бои идут на нескольких площадках одновременно: каждая получает
          своё табло, которое само переключается на бой этой площадки. Турнир на одной площадке
          ристалищ не заводит — всё работает как сейчас.
        </p>
      ) : (
        <table style={{ borderCollapse: 'collapse', fontSize: '0.95em', marginBottom: 8 }}>
          <tbody>
            {list.map((p, i) => (
              <PisteRow
                key={p.id}
                piste={p}
                busy={updateMut.isPending || deleteMut.isPending}
                onRename={next => updateMut.mutate({ id: p.id, name: next, orderIndex: p.orderIndex })}
                onUp={i > 0 ? () => swap(p, list[i - 1]) : undefined}
                onDown={i < list.length - 1 ? () => swap(p, list[i + 1]) : undefined}
                onDelete={() => {
                  if (confirm(`Удалить ристалище «${p.name}»?`)) deleteMut.mutate(p.id)
                }}
              />
            ))}
          </tbody>
        </table>
      )}

      <form
        onSubmit={e => {
          e.preventDefault()
          if (name.trim()) createMut.mutate()
        }}
        style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Название: «Ристалище 1», «Синее»"
          style={{ minWidth: 220 }}
        />
        <button type="submit" disabled={!name.trim() || createMut.isPending}>
          {createMut.isPending ? '…' : '+ Добавить ристалище'}
        </button>
      </form>
    </div>
  )
}

function PisteRow({
  piste,
  busy,
  onRename,
  onUp,
  onDown,
  onDelete,
}: {
  piste: Piste
  busy: boolean
  onRename: (name: string) => void
  onUp?: () => void
  onDown?: () => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(piste.name)

  const occupied = piste.currentMatchId != null || piste.currentEncounterId != null

  return (
    <tr>
      <td style={TD}>
        {editing ? (
          <form
            onSubmit={e => {
              e.preventDefault()
              if (draft.trim() && draft.trim() !== piste.name) onRename(draft.trim())
              setEditing(false)
            }}
            style={{ display: 'flex', gap: 6 }}
          >
            <input value={draft} onChange={e => setDraft(e.target.value)} autoFocus style={{ width: 180 }} />
            <button type="submit" disabled={!draft.trim() || busy}>OK</button>
            <button
              type="button"
              onClick={() => {
                setDraft(piste.name)
                setEditing(false)
              }}
            >
              Отмена
            </button>
          </form>
        ) : (
          <strong>{piste.name}</strong>
        )}
      </td>
      <td style={{ ...TD, color: occupied ? '#0077cc' : '#aaa', whiteSpace: 'nowrap' }}>
        {occupied ? '● занято' : 'свободно'}
      </td>
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        <a
          href={pisteBoardPath(piste.id)}
          target="_blank"
          rel="noopener"
          title="Табло этой площадки: само показывает идущий здесь бой и следующую пару этой же площадки. Перетащите вкладку на монитор ристалища."
          style={{ color: '#888' }}
        >
          🖵 Табло ристалища
        </a>
      </td>
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        <button onClick={onUp} disabled={!onUp || busy} title="Выше в списке">↑</button>
        <button onClick={onDown} disabled={!onDown || busy} title="Ниже в списке">↓</button>
        {!editing && (
          <button onClick={() => setEditing(true)} disabled={busy} style={{ marginLeft: 6 }}>
            Переименовать
          </button>
        )}
        <button
          onClick={onDelete}
          disabled={busy}
          style={{ marginLeft: 6, color: '#c00', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Удалить
        </button>
      </td>
    </tr>
  )
}

const TD: React.CSSProperties = {
  borderBottom: '1px solid #eee',
  padding: '6px 12px 6px 0',
}
