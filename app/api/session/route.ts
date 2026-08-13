import { checkTeamPassword, startSession, endSession, getSession } from '@/lib/auth'
import { TEAM_NAMES } from '@/lib/constants'
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
    const name = String(body.name ?? '')
    const password = String(body.password ?? '')

    if (!TEAM_NAMES.includes(name)) return fail('Pick your name from the list', 400)
    if (!checkTeamPassword(password)) return fail('That password is not right', 401)

    await startSession(name)
    await logActivity(null, name, 'signed in')
    return ok({ signedIn: true, name })
  })
}

export async function DELETE() {
  return guard(async () => {
    await endSession()
    return ok({ signedIn: false })
  })
}
