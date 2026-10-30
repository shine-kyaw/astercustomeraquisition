'use client'

export class ApiError extends Error {
  status: number
  errors?: string[]
  constructor(status: number, message: string, errors?: string[]) {
    super(message)
    this.status = status
    this.errors = errors
  }
}

/**
 * Every client request goes through here. A 401 sends you to sign in; anything else that
 * fails throws an ApiError carrying the server's own message, which is written for people.
 */
export async function api<T = Record<string, unknown>>(
  path: string,
  opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'Network error. Check your connection and try again.')
  }
  if (res.status === 401) {
    window.location.href = '/login'
    throw new ApiError(401, 'Not signed in')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const errors = Array.isArray(data.errors) ? (data.errors as string[]) : undefined
    throw new ApiError(res.status, String(data.error ?? `Request failed (${res.status})`) + (errors ? `: ${errors.join('; ')}` : ''), errors)
  }
  return data as T
}

/** The user's own calendar date, so "due today" means their today. */
export function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Read a localStorage preference without ever throwing (private windows, blocked storage). */
export function pref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`aster:${key}`)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}
export function setPref(key: string, value: unknown) {
  try { localStorage.setItem(`aster:${key}`, JSON.stringify(value)) } catch { /* storage unavailable */ }
}
