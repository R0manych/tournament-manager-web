// Выбор оператора «этот бой — на табло зала», переживающий F5 обеих вкладок.
//
// Зачем отдельно от канала (АР-14): `show` — событие, а решение оператора живёт
// дольше события. Табло, открытое или перезагруженное после нажатия, ничего по
// каналу уже не услышит, а на `hello` отвечать некому: карточка боя больше не
// вещает `show` при открытии — иначе зал переключался бы на любой бой, в
// который оператор просто заглянул (B-12, docs/09 §7).
//
// Скоуп тот же, что у `BroadcastChannel` и у сдвига таймера (B-3): один
// браузер. Для нескольких площадок это не замена ристалищу — там табло знает
// свой бой из данных (`/display/piste/:id`), а этот выбор нужен турнирам без
// ристалищ (docs/09 §3.3).

const KEY_PREFIX = 'zettel-display-show:'

/** Запись старше этого срока — мусор от прошлых турниров. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000

export function displayShowKey(tournamentId: string): string {
  return `${KEY_PREFIX}${tournamentId}`
}

/** `null`, если записи нет, она протухла или испорчена. */
export function parseDisplayShow(raw: string | null): string | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as { matchId?: unknown; updatedMs?: unknown }
    if (typeof o.matchId !== 'string') return null
    if (typeof o.updatedMs === 'number' && Date.now() - o.updatedMs > MAX_AGE_MS) return null
    return o.matchId
  } catch {
    return null
  }
}

export function readDisplayShow(tournamentId: string): string | null {
  try {
    return parseDisplayShow(localStorage.getItem(displayShowKey(tournamentId)))
  } catch {
    // Приватный режим / отключённое хранилище: табло обязано работать и без
    // выбора — оно упадёт на бой, начатый последним.
    return null
  }
}

export function writeDisplayShow(tournamentId: string, matchId: string): void {
  try {
    localStorage.setItem(
      displayShowKey(tournamentId),
      JSON.stringify({ matchId, updatedMs: Date.now() })
    )
  } catch {
    /* см. readDisplayShow */
  }
  emit(tournamentId)
}

export function clearDisplayShow(tournamentId: string): void {
  try {
    localStorage.removeItem(displayShowKey(tournamentId))
  } catch {
    /* см. readDisplayShow */
  }
  emit(tournamentId)
}

// ── Подписка ────────────────────────────────────────────────────────────────
// Событие `storage` приходит только в ЧУЖИЕ вкладки, поэтому собственная
// запись доезжает до своего же UI через этот список. Один путь на оба случая:
// кнопка «Вывести на табло зала» показывает состояние одинаково и в той
// вкладке, где нажали, и в соседней.

const listeners = new Map<string, Set<() => void>>()

function emit(tournamentId: string): void {
  for (const cb of listeners.get(tournamentId) ?? []) cb()
}

export function subscribeDisplayShow(tournamentId: string, onChange: () => void): () => void {
  let set = listeners.get(tournamentId)
  if (!set) {
    set = new Set()
    listeners.set(tournamentId, set)
  }
  set.add(onChange)

  const onStorage = (e: StorageEvent) => {
    if (e.key === displayShowKey(tournamentId)) onChange()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    window.removeEventListener('storage', onStorage)
    set.delete(onChange)
    if (set.size === 0) listeners.delete(tournamentId)
  }
}
