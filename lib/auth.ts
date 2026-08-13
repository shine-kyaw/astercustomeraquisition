import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { TEAM_NAMES } from './constants'

const COOKIE = 'aster_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14 // two weeks

function secret(name: 'SESSION_SECRET' | 'TEAM_PASSWORD' | 'INGEST_TOKEN'): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set. Add it in Vercel → Settings → Environment Variables.`)
  return v
}

/**
 * Constant-time compare. A plain === leaks length and position through timing,
 * which is a real (if slow) way to guess a shared password.
 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) {
    // Still burn a comparison so the failure path costs the same.
    timingSafeEqual(ba, ba)
    return false
  }
  return timingSafeEqual(ba, bb)
}

function sign(payload: string): string {
  return createHmac('sha256', secret('SESSION_SECRET')).update(payload).digest('base64url')
}

export type Session = { name: string; exp: number }

function encode(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url')
  return `${payload}.${sign(payload)}`
}

function decode(raw: string | undefined): Session | null {
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot < 1) return null

  const payload = raw.slice(0, dot)
  const mac = raw.slice(dot + 1)
  if (!safeEqual(mac, sign(payload))) return null

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session
    if (!session?.name || typeof session.exp !== 'number') return null
    if (session.exp < Date.now()) return null
    // Only names on the roster are valid, so a forged-but-unsigned name can't slip through
    // even if SESSION_SECRET were ever rotated carelessly.
    if (!TEAM_NAMES.includes(session.name)) return null
    return session
  } catch {
    return null
  }
}

export function checkTeamPassword(candidate: string): boolean {
  return safeEqual(candidate ?? '', secret('TEAM_PASSWORD'))
}

/** Bearer token for the batch-ingest endpoint, kept separate from the human password. */
export function checkIngestToken(header: string | null): boolean {
  if (!header) return false
  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) return false
  return safeEqual(token, secret('INGEST_TOKEN'))
}

export async function startSession(name: string): Promise<void> {
  const session: Session = { name, exp: Date.now() + MAX_AGE_SECONDS * 1000 }
  const jar = await cookies()
  jar.set(COOKIE, encode(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function endSession(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE)
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies()
  return decode(jar.get(COOKIE)?.value)
}

/** Throws a 401-shaped error if there is no valid session. */
export async function requireSession(): Promise<Session> {
  const session = await getSession()
  if (!session) {
    const err = new Error('Not signed in') as Error & { status?: number }
    err.status = 401
    throw err
  }
  return session
}

export function newId(): string {
  return randomUUID()
}
