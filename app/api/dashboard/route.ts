import { requireSession } from '@/lib/auth'
import { getDashboard } from '@/lib/dashboard'
import { roleOf } from '@/lib/roles'
import { ok, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** `today` comes from the browser so "due today" means the user's today, not the server's. */
export async function GET(req: Request) {
  return guard(async () => {
    const session = await requireSession()
    const p = new URL(req.url).searchParams
    const data = await getDashboard(session.name, {
      today: p.get('today') ?? undefined,
      scope: p.get('scope') === 'team' ? 'team' : 'mine',
    })
    return ok({ ...data, me: session.name, role: roleOf(session.name) })
  })
}
