import { checkIngestToken } from '@/lib/auth'
import { createLead, sanitize, logActivity } from '@/lib/leads'
import { ok, fail, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_LEADS_PER_BATCH = 50

/**
 * Machine ingest for a researched batch.
 *
 * Deliberately separate from the human session: this is authenticated by a bearer token,
 * so rotating it never logs the team out, and a leaked team password can't be used to
 * inject leads. Insert-only by design — an automated writer should never be able to
 * overwrite a status a human has set.
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

    if (!body || !Array.isArray(body.leads)) {
      return fail('Body must be { leads: [ … ] }', 400)
    }
    if (!body.leads.length) return fail('No leads in the payload', 400)
    if (body.leads.length > MAX_LEADS_PER_BATCH) {
      return fail(`A batch is capped at ${MAX_LEADS_PER_BATCH} leads`, 413)
    }

    const batch = String(body.batch ?? '').trim()
    const addedBy = String(body.addedBy ?? 'Claude').slice(0, 120)

    const created: unknown[] = []
    const rejected: { index: number; reason: string }[] = []

    for (let i = 0; i < body.leads.length; i++) {
      const incoming = body.leads[i]
      const { patch, errors } = sanitize(incoming)

      if (errors.length) { rejected.push({ index: i, reason: errors.join('; ') }); continue }
      if (!patch.company || !String(patch.company).trim()) {
        rejected.push({ index: i, reason: 'missing company name' })
        continue
      }

      if (batch) patch.batch = batch
      if (patch.seq == null) patch.seq = i + 1

      try {
        created.push(await createLead(patch, addedBy))
      } catch (e) {
        rejected.push({ index: i, reason: (e as Error).message })
      }
    }

    await logActivity(
      null,
      addedBy,
      `ingested ${created.length} lead${created.length === 1 ? '' : 's'}` +
        (batch ? ` into ${batch}` : '') +
        (rejected.length ? ` — ${rejected.length} rejected` : '')
    )

    // 207 when the payload was partially accepted, so a caller can tell without parsing.
    return ok({ created: created.length, rejected, leads: created }, rejected.length ? 207 : 201)
  })
}
