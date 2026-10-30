import { requireSession } from '@/lib/auth'
import { revokeExclusion } from '@/lib/exclusions'
import { requireCan } from '@/lib/roles'
import { ok, fail, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** Reconsider a ruled-out company: `{ "revoke": true, "reason": "rebuilt their team" }`. */
export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const session = await requireSession()
    requireCan(session, 'revoke_exclusion')
    const id = Number((await params).id)
    if (!Number.isInteger(id)) return fail('Bad id', 400)
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (body?.revoke !== true) return fail('Send { "revoke": true, "reason": "…" }', 400)
    const row = await revokeExclusion(id, session.name, String(body.reason ?? ''))
    return row ? ok({ exclusion: row }) : fail('Not found, or already reconsidered', 404)
  })
}
