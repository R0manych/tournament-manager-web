const BASE_URL = '/api/v1'

// Body plus headers, for the few endpoints that say something outside the body
// (X-Groups-Cleared on a forced format replace/delete — see B-2).
export interface ApiResult<T> {
  data: T
  headers: Headers
}

async function requestWithMeta<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const isFormData = init?.body instanceof FormData
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: isFormData
      ? (init?.headers ?? {})
      : { 'Content-Type': 'application/json', ...init?.headers },
  })

  if (!res.ok) {
    const problem = await res.json().catch(() => ({ title: res.statusText }))
    throw Object.assign(new Error(problem.title ?? res.statusText), { status: res.status, problem })
  }

  if (res.status === 204) return { data: undefined as T, headers: res.headers }
  return { data: await res.json(), headers: res.headers }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await requestWithMeta<T>(path, init)
  return data
}

async function getRaw(path: string): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) {
    const problem = await res.json().catch(() => ({ title: res.statusText }))
    throw Object.assign(new Error(problem.title ?? res.statusText), { status: res.status, problem })
  }
  return res
}

export const api = {
  get: <T>(path: string) => request<T>(path),
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
