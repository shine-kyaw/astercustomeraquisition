import { checkIngestToken } from '@/lib/auth'
import { ingestBatch, MAX_LEADS_PER_BATCH } from '@/lib/ingest'
import { ok, fail, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Machine ingest for a researched batch.
 *
 * Authenticated by a bearer token rather than the human session, so rotating it never
 * signs the team out and a leaked team password cannot be used to inject leads. Shares
 * its validation and duplicate rules with the in-app importer via ingestBatch().
 *
 *   curl -X POST https://<your-app>/api/leads/batch \
 *     -H "Authorization: Bearer $INGEST_TOKEN" \
 *     -H "Content-Type: application/json" \
 *     -d '{"batch":"Batch 002","addedBy":"Claude","leads":[{ … }]}'
 */
export async function POST(req: Request) {
  return guard(async () => {
    if (!checkIngestToken(req.headers.get('authorization'))) {
      return fail('Invalid or missing ingest token', 401)
    }

    const body = (await req.json().catch(() => null)) as {
      batch?: string
      addedBy?: string
      leads?: unknown[]
    } | null

    if (!body || !Array.isArray(body.leads)) return fail('Body must be { leads: [ … ] }', 400)
    if (!body.leads.length) return fail('No leads in the payload', 400)
    if (body.leads.length > MAX_LEADS_PER_BATCH) {
      return fail(`A batch is capped at ${MAX_LEADS_PER_BATCH} leads`, 413)
    }

    const result = await ingestBatch(body.leads, { batch: body.batch, addedBy: body.addedBy })
    const partial = result.rejected.length > 0 || result.duplicates.length > 0
    return ok(result, partial ? 207 : 201)
  })
}
