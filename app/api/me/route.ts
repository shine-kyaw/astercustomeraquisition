import { requireSession } from '@/lib/auth'
import { q } from '@/lib/db'
import { roleOf } from '@/lib/roles'
import { ok, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Who's signed in, and the two numbers the sidebar shows: overdue and due today. */
export async function GET(req: Request) {
  return guard(async () => {
    const session = await requireSession()
    const t = new URL(req.url).searchParams.get('today')
    const today = t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : new Date().toISOString().slice(0, 10)
    const [counts] = await q<{ overdue: number; due_today: number }>(
      `select count(*) filter (where t.due_on < $2)::int as overdue,
              count(*) filter (where t.due_on = $2)::int as due_today
         from tasks t left join leads l on l.id = t.lead_id
        where t.status = 'open' and t.owner = $1 and (l.id is null or l.deleted_at is null)`,
      [session.name, today]
    )
    return ok({ name: session.name, role: roleOf(session.name), counts })
  })
}
