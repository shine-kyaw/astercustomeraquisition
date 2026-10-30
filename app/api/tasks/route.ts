import { requireSession } from '@/lib/auth'
import { listTasks, createTask, cleanTask } from '@/lib/tasks'
import { ok, fail, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return guard(async () => {
    const session = await requireSession()
    const p = new URL(req.url).searchParams
    const owner = p.get('owner')
    const tasks = await listTasks({
      owner: owner === 'me' ? session.name : owner === 'all' || !owner ? undefined : owner,
      status: p.get('status') ?? 'open',
      lead: p.get('lead') ?? undefined,
      due: (p.get('due') as 'overdue' | 'today' | 'week' | 'none' | null) ?? undefined,
      today: p.get('today') ?? undefined,
      limit: Number(p.get('limit')) || undefined,
    })
    return ok({ tasks })
  })
}

export async function POST(req: Request) {
  return guard(async () => {
    const session = await requireSession()
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return fail('Body must be an object', 400)
    const { task, errors } = cleanTask(body)
    if (errors.length) return fail(errors.join('; '), 400)
    return ok({ task: await createTask(task, session.name) }, 201)
  })
}
