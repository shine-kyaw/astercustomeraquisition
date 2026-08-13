import { requireSession } from '@/lib/auth'
import { recentActivity } from '@/lib/leads'
import { ok, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return guard(async () => {
    await requireSession()
    const limit = new URL(req.url).searchParams.get('limit')
    return ok({ activity: await recentActivity(Number(limit) || 200) })
  })
}
