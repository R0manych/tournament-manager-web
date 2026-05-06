const BASE_URL = '/api/v1'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

  if (res.status === 204) return undefined as T
  return res.json()
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
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
}
