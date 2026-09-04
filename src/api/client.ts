const BASE_URL = '/api/v1'

// Потолок на любой запрос. Без него зависшее соединение висит до сетевого
// таймаута браузера: поллинг табло (3 с) новый запрос не шлёт, `isError` не
// поднимается, и зал молча показывает устаревший бой минутами.
const REQUEST_TIMEOUT_MS = 15_000

// Body plus headers, for the few endpoints that say something outside the body
// (X-Groups-Cleared on a forced format replace/delete — see B-2).
export interface ApiResult<T> {
  data: T
  headers: Headers
}

/** Ошибка RFC 7807. Форма ответа одна на весь API — объявляем её один раз. */
export interface ProblemDetails {
  title?: string
  detail?: string
  status?: number
  /** Ошибки валидации формата: `{ path, code, message }` (см. парсер DSL). */
  errors?: unknown
}

export interface ApiError extends Error {
  status: number
  problem: ProblemDetails
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof Error && 'status' in err && 'problem' in err
}

/** Текст ошибки для пользователя: `detail`, иначе `title`, иначе запасной. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (!isApiError(err)) return err instanceof Error ? err.message : fallback
  return err.problem.detail ?? err.problem.title ?? fallback
}

async function toApiError(res: Response): Promise<ApiError> {
  const problem: ProblemDetails = await res.json().catch(() => ({ title: res.statusText }))
  return Object.assign(new Error(problem.title ?? res.statusText), {
    status: res.status,
    problem,
  }) as ApiError
}

// Собственный таймаут запроса плюс отмена от вызывающего (TanStack Query даёт
// `signal` в `queryFn`): рвётся по любому из двух.
function withTimeout(signal?: AbortSignal | null): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  if (!signal) return timeout
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal
}

async function requestWithMeta<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const isFormData = init?.body instanceof FormData
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    signal: withTimeout(init?.signal),
    headers: isFormData
      ? (init?.headers ?? {})
      : { 'Content-Type': 'application/json', ...init?.headers },
  })

  if (!res.ok) throw await toApiError(res)

  if (res.status === 204) return { data: undefined as T, headers: res.headers }
  return { data: await res.json(), headers: res.headers }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await requestWithMeta<T>(path, init)
  return data
}

async function getRaw(path: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, { signal: withTimeout(signal) })
  if (!res.ok) throw await toApiError(res)
  return res
}

export const api = {
  // `signal` — из `queryFn({ signal })`: TanStack рвёт запрос, когда экран
  // ушёл или запрос устарел.
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  getRaw,
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  putForm: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: 'PUT', body: formData }),
  putFormWithMeta: <T>(path: string, formData: FormData) =>
    requestWithMeta<T>(path, { method: 'PUT', body: formData }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  // Обычный DELETE отвечает 204 (T = void), но `DELETE /exchanges/{id}` отдаёт
  // пересчитанную встречу — тому, кто её ждёт, нужен типизированный ответ.
  delete: <T = void>(path: string) => request<T>(path, { method: 'DELETE' }),
  deleteWithMeta: (path: string) => requestWithMeta<void>(path, { method: 'DELETE' }),
}
