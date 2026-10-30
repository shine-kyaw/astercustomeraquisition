import { requireSession } from '@/lib/auth'
import { listExclusions, addExclusions, cleanExclusion, EXCLUSION_CATEGORIES, type Exclusion } from '@/lib/exclusions'
import { ok, fail, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return guard(async () => {
    await requireSession()
    const p = new URL(req.url).searchParams
    const rows = await listExclusions({ includeRevoked: p.get('all') === '1', q: p.get('q') ?? undefined })
    return ok({ exclusions: rows, categories: EXCLUSION_CATEGORIES })
  })
}

/**
 * Add one company `{ company, domain, reason, … }` or many `{ rows: [ … ] }` — the batch
 * form is what the skill's step 12 ("record what you rejected") sends.
 */
export async function POST(req: Request) {
  return guard(async () => {
    const session = await requireSession()
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return fail('Body must be an object', 400)
    const input = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : [body]
    if (input.length > 200) return fail('At most 200 companies at a time', 413)

    const rows: Partial<Exclusion>[] = []
    const rejected: { index: number; reason: string }[] = []
    input.forEach((r, index) => {
      const { row, error } = cleanExclusion(r ?? {})
      if (error) rejected.push({ index, reason: error })
      else rows.push(row)
    })
    const result = await addExclusions(rows, session.name)
    return ok({ ...result, rejected }, result.added.length ? 201 : 200)
  })
}
