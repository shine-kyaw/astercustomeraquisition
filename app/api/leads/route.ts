import { requireSession } from '@/lib/auth'
import { listLeads, searchLeads, createLead, sanitize } from '@/lib/leads'
import { ok, fail, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const QUERY_KEYS = ['q', 'stage', 'owner', 'geo', 'view', 'sort', 'limit', 'offset', 'today', 'deleted']

/**
 * With no query string this returns every live lead, unchanged in shape: the
 * aster-lead-engine skill calls `fetch('/api/leads')` from Chrome to build its exclusion
 * list and find leads to update. With any filter or paging parameter it switches to a
 * server-side search returning `{ leads, total }`.
 */
export async function GET(req: Request) {
  return guard(async () => {
    const session = await requireSession()
    const params = new URL(req.url).searchParams
    if (!QUERY_KEYS.some((k) => params.has(k))) return ok({ leads: await listLeads() })

    const result = await searchLeads({
      q: params.get('q') ?? undefined,
      stage: params.get('stage') ?? undefined,
      owner: params.get('owner') ?? undefined,
      geo: params.get('geo') ?? undefined,
      view: params.get('view') ?? undefined,
      sort: params.get('sort') ?? undefined,
      limit: Number(params.get('limit')) || undefined,
      offset: Number(params.get('offset')) || undefined,
      today: params.get('today') ?? undefined,
      deleted: params.get('deleted') === '1',
      me: session.name,
    })
    return ok(result)
  })
}

export async function POST(req: Request) {
  return guard(async () => {
    const session = await requireSession()
    const body = await req.json().catch(() => null)
    const { patch, errors } = sanitize(body)

    if (errors.length) return fail('Some fields were rejected', 400, { errors })
    if (!patch.company || !String(patch.company).trim()) {
      return fail('A lead needs a company name', 400)
    }

    return ok({ lead: await createLead(patch, session.name) }, 201)
  })
}
