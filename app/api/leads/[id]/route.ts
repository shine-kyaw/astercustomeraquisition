import { requireSession } from '@/lib/auth'
import {
  getLead, patchLead, deleteLead, restoreLead, clearDoNotContact, logActivity,
} from '@/lib/leads'
import { requireCan } from '@/lib/roles'
import { ok, fail, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  return guard(async () => {
    await requireSession()
    const { id } = await params
    const lead = await getLead(id)
    return lead ? ok({ lead }) : fail('No lead with that id', 404)
  })
}

/**
 * Field edits, plus `stage` and the legacy `status`, which are recorded as events (see
 * patchLead). Two admin operations ride on the same verb so existing callers need nothing
 * new: `{ "restore": true }` undeletes, `{ "do_not_contact": false }` lifts a suppression.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const session = await requireSession()
    const { id } = await params
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return fail('Body must be an object', 400)

    if (body.restore === true) {
      requireCan(session, 'restore')
      const lead = await restoreLead(id, session.name)
      return lead ? ok({ lead }) : fail('No deleted lead with that id', 404)
    }
    if (body.do_not_contact === false) {
      requireCan(session, 'clear_dnc')
      const lead = await clearDoNotContact(id, session.name, String(body.reason ?? ''))
      return lead ? ok({ lead }) : fail('No lead with that id', 404)
    }

    const before = await getLead(id)
    if (!before) return fail('No lead with that id', 404)

    const { lead, errors, changed } = await patchLead(before, body, session.name)
    if (errors.length) return fail('Some fields were rejected', 400, { errors })
    if (!lead) return fail('No lead with that id', 404)

    // Status and stage moves are logged as events; plain edits keep the old audit line.
    const edited = changed.filter((c) => c !== 'status' && c !== 'stage')
    if (edited.length) {
      await logActivity(id, session.name, `edited ${before.company} (${edited.slice(0, 6).join(', ')}${edited.length > 6 ? '…' : ''})`)
    }

    return ok({ lead })
  })
}

/** Soft delete, owner/admin only. The lead keeps blocking re-import and can be restored. */
export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const session = await requireSession()
    requireCan(session, 'delete')
    const { id } = await params
    const gone = await deleteLead(id, session.name)
    return gone ? ok({ deleted: true }) : fail('No lead with that id', 404)
  })
}
