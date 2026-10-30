import { requireSession } from '@/lib/auth'
import { recentEvents } from '@/lib/events'
import { ok, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Recent activity across every lead. `before` pages backwards by timestamp. */
export async function GET(req: Request) {
  return guard(async () => {
    await requireSession()
    const p = new URL(req.url).searchParams
    const events = await recentEvents({
      limit: Number(p.get('limit')) || 100,
      before: p.get('before') ?? undefined,
      who: p.get('who') ?? undefined,
      type: p.get('type') ?? undefined,
    })
    return ok({ events })
  })
}
