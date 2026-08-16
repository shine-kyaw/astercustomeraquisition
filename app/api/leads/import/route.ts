import { requireSession } from '@/lib/auth'
import { ingestBatch, parsePastedBatch } from '@/lib/ingest'
import { ok, fail, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * In-app paste importer.
 *
 * The path most of the team will actually use: research a batch with Claude, copy the
 * JSON, paste it here. Authenticated by the normal session — no token to distribute, no
 * terminal, nothing to install. The import is attributed to whoever is signed in.
 */
export async function POST(req: Request) {
  return guard(async () => {
    const session = await requireSession()
    const body = (await req.json().catch(() => null)) as { text?: string } | null

    const parsed = parsePastedBatch(body?.text ?? '')
    if (!parsed.ok) return fail(parsed.error, 400)

    const result = await ingestBatch(parsed.leads, {
      batch: parsed.batch,
      // Whoever pasted it owns it, regardless of what the payload claims.
      addedBy: session.name,
    })

    return ok(result, 200)
  })
}
