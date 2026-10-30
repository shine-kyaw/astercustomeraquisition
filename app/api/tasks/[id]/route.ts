import { requireSession } from '@/lib/auth'
import { getTask, updateTask, setTaskStatus, cleanTask } from '@/lib/tasks'
import { ok, fail, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Edit a task, or change its status: `{ "status": "done" }`, `"open"` to reopen, or
 * `"cancelled"` with an optional `reason`. Tasks are never deleted; a cancelled one keeps
 * its reason.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  return guard(async () => {
    const session = await requireSession()
    const id = Number((await params).id)
    if (!Number.isInteger(id)) return fail('Bad task id', 400)
    if (!(await getTask(id))) return fail('No such task', 404)

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return fail('Body must be an object', 400)

    const { task, errors } = cleanTask(body, true)
    if (errors.length) return fail(errors.join('; '), 400)
    let result = await updateTask(id, task)

    if (typeof body.status === 'string') {
      if (!['done', 'open', 'cancelled'].includes(body.status)) return fail('status must be done, open or cancelled', 400)
      result = await setTaskStatus(id, body.status as 'done' | 'open' | 'cancelled', session.name, String(body.reason ?? ''))
    }
    return ok({ task: result })
  })
}
