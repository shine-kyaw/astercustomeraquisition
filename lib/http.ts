import { NextResponse } from 'next/server'

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

/** An error whose message is safe and useful to show the user, with the HTTP status to use. */
export function httpError(status: number, message: string): Error {
  const err = new Error(message) as Error & { status?: number; expose?: boolean }
  err.status = status
  err.expose = true
  return err
}

/**
 * Wrap a handler so an unexpected throw becomes a clean 500 instead of leaking a stack
 * trace to the client. Auth helpers set `status` on their errors, which is honoured here;
 * deliberate 4xx errors and the "database needs migrating" 503 carry a message meant for
 * people, so that is passed through.
 */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (e) {
    const err = e as Error & { status?: number; expose?: boolean }
    if (err.status === 401) return fail('Not signed in', 401)
    if (err.status && (err.expose || err.status === 403 || err.status === 503)) {
      return fail(err.message, err.status, err.status === 503 ? { code: 'SCHEMA_OUT_OF_DATE' } : undefined)
    }
    console.error('[aster-lead-engine]', err)
    const detail =
      process.env.NODE_ENV === 'production'
        ? 'Something went wrong. Check the Vercel function logs.'
        : err.message
    return fail(detail, 500)
  }
}
