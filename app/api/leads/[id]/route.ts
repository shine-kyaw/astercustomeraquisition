import { requireSession } from '@/lib/auth'
import { getLead, updateLead, deleteLead, sanitize, logActivity, describeChanges } from '@/lib/leads'
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

export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const session = await requireSession()
    const { id } = await params

    const before = await getLead(id)
    if (!before) return fail('No lead with that id', 404)

    const body = await req.json().catch(() => null)
    const { patch, errors } = sanitize(body)
    if (errors.length) return fail('Some fields were rejected', 400, { errors })

    const changed = describeChanges(before, patch)
    const lead = await updateLead(id, patch, session.name)
    if (!lead) return fail('No lead with that id', 404)

    if (changed.length) {
      // Status moves are the thing people actually want to see in the log, so name them.
      const action = changed.includes('status')
        ? `moved ${before.company} from "${before.status}" to "${lead.status}"`
        : `edited ${before.company} (${changed.slice(0, 6).join(', ')}${changed.length > 6 ? '…' : ''})`
      await logActivity(id, session.name, action)
    }

    return ok({ lead })
  })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const session = await requireSession()
    const { id } = await params
    const gone = await deleteLead(id, session.name)
    return gone ? ok({ deleted: true }) : fail('No lead with that id', 404)
  })
}
