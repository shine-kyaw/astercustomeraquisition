import { checkTeamPassword, startSession, endSession, getSession } from '@/lib/auth'
import { TEAM_NAMES, cleanName, signInNameError } from '@/lib/constants'
import { logActivity } from '@/lib/leads'
import { ok, fail, guard } from '@/lib/http'

export const runtime = 'nodejs'

export async function GET() {
  return guard(async () => {
    const session = await getSession()
    return ok({ signedIn: !!session, name: session?.name ?? null })
  })
}

export async function POST(req: Request) {
  return guard(async () => {
    const body = (await req.json().catch(() => ({}))) as { password?: string; name?: string }
    const name = cleanName(body.name)
    const password = String(body.password ?? '')

    const nameError = signInNameError(name)
    if (nameError) return fail(nameError, 400)
    if (!checkTeamPassword(password)) return fail('That password is not right', 401)

    await startSession(name)
    // Flag "Other" sign-ins so the log shows who isn't on the roster.
    await logActivity(null, name, TEAM_NAMES.includes(name) ? 'signed in' : 'signed in (not on the team list)')
    return ok({ signedIn: true, name })
  })
}

export async function DELETE() {
  return guard(async () => {
    await endSession()
    return ok({ signedIn: false })
  })
}
