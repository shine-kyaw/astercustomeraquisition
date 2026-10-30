import { requireSession } from '@/lib/auth'
import { getReport } from '@/lib/reports'
import { ok, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return guard(async () => {
    await requireSession()
    const p = new URL(req.url).searchParams
    return ok(await getReport(p.get('from') ?? undefined, p.get('to') ?? undefined))
  })
}
