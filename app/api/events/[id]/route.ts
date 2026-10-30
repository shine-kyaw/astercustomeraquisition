import { requireSession } from '@/lib/auth'
import { voidEvent } from '@/lib/events'
import { can } from '@/lib/roles'
import { ok, fail, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Remove a mistaken timeline entry. It is voided, not deleted, so the record of the
 * mistake survives. What the entry already changed (stage, reminders) is left alone —
 * fix those directly — because undoing side effects automatically could clobber work
 * done since.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const session = await requireSession()
    const id = Number((await params).id)
    if (!Number.isInteger(id)) return fail('Bad event id', 400)
    const ev = await voidEvent(id, session.name, can(session.name, 'void_any_event'))
    return ev ? ok({ event: ev }) : fail('No such entry', 404)
  })
}
