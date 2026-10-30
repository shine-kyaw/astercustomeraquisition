import { createHash } from 'node:crypto'
import { checkTeamPassword, startSession, endSession, getSession } from '@/lib/auth'
import { TEAM_NAMES, cleanName, signInNameError } from '@/lib/constants'
import { logActivity } from '@/lib/leads'
import { q } from '@/lib/db'
import { roleOf } from '@/lib/roles'
import { ok, fail, guard } from '@/lib/http'

export const runtime = 'nodejs'

const WINDOW_MINUTES = 15
const MAX_FAILURES = 10
const FAILED = 'failed sign-in'

export async function GET() {
  return guard(async () => {
    const session = await getSession()
    return ok({ signedIn: !!session, name: session?.name ?? null, role: session ? roleOf(session.name) : null })
  })
}

/**
 * A shared password is brute-forceable given enough attempts, so failures are counted
 * per client address in the append-only activity log and refused past a threshold. The
 * address is stored hashed: the log is readable by the whole team.
 */
function clientKey(req: Request): string {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
  return createHash('sha256').update(`${process.env.SESSION_SECRET ?? ''}:${ip}`).digest('hex').slice(0, 16)
}

export async function POST(req: Request) {
  return guard(async () => {
    const body = (await req.json().catch(() => ({}))) as { password?: string; name?: string }
    const name = cleanName(body.name)
    const password = String(body.password ?? '')

    const nameError = signInNameError(name)
    if (nameError) return fail(nameError, 400)

    const key = clientKey(req)
    const [{ n }] = await q<{ n: number }>(
      `select count(*)::int as n from activity
        where who = $1 and action = $2 and at > now() - ($3 || ' minutes')::interval`,
      [FAILED, `${FAILED} ${key}`, String(WINDOW_MINUTES)]
    )
    if (n >= MAX_FAILURES) {
      return fail(`Too many wrong passwords. Wait ${WINDOW_MINUTES} minutes and try again.`, 429)
    }

    if (!checkTeamPassword(password)) {
      await logActivity(null, FAILED, `${FAILED} ${key}`)
      return fail('That password is not right', 401)
    }

    await startSession(name)
    // Flag "Other" sign-ins so the log shows who isn't on the roster.
    await logActivity(null, name, TEAM_NAMES.includes(name) ? 'signed in' : 'signed in (not on the team list)')
    return ok({ signedIn: true, name, role: roleOf(name) })
  })
}

export async function DELETE() {
  return guard(async () => {
    await endSession()
    return ok({ signedIn: false })
  })
}
