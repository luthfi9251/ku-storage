export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Fired on any 401 UNAUTHENTICATED so the auth layer can drop the session and go to /login. */
export const UNAUTHENTICATED_EVENT = 'ku-storage:unauthenticated'

export function notifyUnauthenticated() {
  window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT))
}

/** Parses a ku-storage error body ({ error, message }); falls back to status text. */
export function parseErrorBody(status: number, statusText: string, text: string): ApiError {
  let code = 'ERROR'
  let message = statusText || `HTTP ${status}`
  try {
    const body = JSON.parse(text) as { error?: string; message?: string }
    if (body.error) code = body.error
    if (body.message) message = body.message
  } catch {
    /* keep defaults */
  }
  return new ApiError(status, code, message)
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init })
  if (!res.ok) {
    const err = parseErrorBody(res.status, res.statusText, await res.text().catch(() => ''))
    if (res.status === 401 && err.code === 'UNAUTHENTICATED') notifyUnauthenticated()
    throw err
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

function json(method: string, body?: unknown): RequestInit {
  return body === undefined
    ? { method }
    : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export const api = {
  get: <T>(path: string) => req<T>(path),
  post: <T>(path: string, body?: unknown) => req<T>(path, json('POST', body)),
  put: <T>(path: string, body: unknown) => req<T>(path, json('PUT', body)),
  del: <T = void>(path: string, body?: unknown) => req<T>(path, json('DELETE', body)),
}

export function errMsg(err: unknown, fallback = 'request failed'): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error && err.message) return err.message
  return fallback
}

/** Build a query string, dropping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function downloadUrl(bucketId: string, key: string, inline = false): string {
  const p = new URLSearchParams({ bucket: bucketId, key })
  if (inline) p.set('inline', '1')
  return `/api/objects/download?${p.toString()}`
}
