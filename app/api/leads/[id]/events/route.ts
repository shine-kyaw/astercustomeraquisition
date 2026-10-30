import { requireSession } from '@/lib/auth'
import { getLead } from '@/lib/leads'
import { recordEvent, leadTimeline } from '@/lib/events'
import { listTasks } from '@/lib/tasks'
import { ok, fail, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** The lead's timeline, with its open and recently finished tasks. */
export async function GET(req: Request, { params }: Ctx) {
  return guard(async () => {
    await requireSession()
    const { id } = await params
    const voided = new URL(req.url).searchParams.get('voided') === '1'
    const [events, open, done] = await Promise.all([
      leadTimeline(id, voided),
      listTasks({ lead: id, status: 'open' }),
      listTasks({ lead: id, status: 'done', limit: 50 }),
    ])
    return ok({ events, tasks: { open, done } })
  })
}

/**
 * Log something that happened: an email sent, a call, a reply, a meeting, a proposal.
 *
 *   { "type": "email_sent", "date": "2026-10-30", "summary": "…", "extRef": "<gmail link>",
 *     "meta": { … } }
 *
 * The event's consequences (stage, legacy status, reminders) are applied in the same
 * transaction. Returns the updated lead so the client doesn't need a second request.
 */
export async function POST(req: Request, { params }: Ctx) {
  return guard(async () => {
    const session = await requireSession()
    const { id } = await params
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return fail('Body must be an object', 400)

    const { event } = await recordEvent(
      id,
      {
        type: String(body.type ?? ''),
        date: typeof body.date === 'string' ? body.date : undefined,
        at: typeof body.at === 'string' ? body.at : undefined,
        summary: typeof body.summary === 'string' ? body.summary : undefined,
        extRef: typeof body.extRef === 'string' ? body.extRef : undefined,
        meta: body.meta && typeof body.meta === 'object' ? (body.meta as Record<string, unknown>) : undefined,
      },
      session.name
    )
    return ok({ event, lead: await getLead(id) }, 201)
  })
}
