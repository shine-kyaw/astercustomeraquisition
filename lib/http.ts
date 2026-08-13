import { NextResponse } from 'next/server'

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

/**
 * Wrap a handler so an unexpected throw becomes a clean 500 instead of leaking a stack
 * trace to the client. Auth helpers set `status` on their errors, which is honoured here.
 */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (e) {
    const err = e as Error & { status?: number }
    if (err.status === 401) return fail('Not signed in', 401)
    console.error('[aster-lead-engine]', err)
    const detail =
      process.env.NODE_ENV === 'production'
        ? 'Something went wrong. Check the Vercel function logs.'
        : err.message
    return fail(detail, 500)
  }
}
