import { q, one, tx } from './db'
import { httpError } from './http'
import { TASK_TYPE_KEYS, PRIORITIES, todayLocal } from './crm'

export type Task = {
  id: number
  lead_id: string | null
  title: string
  type: string
  owner: string
  due_on: string | null
  due_time: string
  priority: string
  status: string
  notes: string
  auto_key: string | null
  created_at: string
  created_by: string
  done_at: string | null
  done_by: string
  cancelled_reason: string
  company?: string
  stage?: string
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function cleanTask(body: Record<string, unknown>, partial = false): { task: Partial<Task>; errors: string[] } {
  const task: Partial<Task> = {}
  const errors: string[] = []
  const has = (k: string) => k in body

  if (!partial || has('title')) {
    const t = String(body.title ?? '').trim().slice(0, 300)
    if (!t) errors.push('A task needs a title')
    else task.title = t
  }
  if (has('type')) {
    const t = String(body.type)
    if (!TASK_TYPE_KEYS.includes(t)) errors.push(`type must be one of: ${TASK_TYPE_KEYS.join(', ')}`)
    else task.type = t
  }
  if (has('owner')) task.owner = String(body.owner ?? '').slice(0, 120)
  if (has('due_on')) {
    const d = String(body.due_on ?? '')
    if (d && !ISO_DAY.test(d)) errors.push('due_on must be YYYY-MM-DD')
    else task.due_on = d || null
  }
  if (has('due_time')) {
    const t = String(body.due_time ?? '')
    if (t && !/^\d{2}:\d{2}$/.test(t)) errors.push('due_time must be HH:MM')
    else task.due_time = t
  }
  if (has('priority')) {
    const p = String(body.priority)
    if (!(PRIORITIES as readonly string[]).includes(p)) errors.push('priority must be low, normal or high')
    else task.priority = p
  }
  if (has('notes')) task.notes = String(body.notes ?? '').slice(0, 4000)
  if (has('lead_id')) task.lead_id = body.lead_id ? String(body.lead_id) : null
  return { task, errors }
}

export async function createTask(t: Partial<Task>, who: string): Promise<Task> {
  if (t.lead_id) {
    const lead = await one('select id from leads where id = $1 and deleted_at is null', [t.lead_id])
    if (!lead) throw httpError(404, 'That lead no longer exists')
  }
  const rows = await q<Task>(
    `insert into tasks (lead_id, title, type, owner, due_on, due_time, priority, notes, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
    [t.lead_id ?? null, t.title, t.type ?? 'other', t.owner || who, t.due_on ?? null, t.due_time ?? '', t.priority ?? 'normal', t.notes ?? '', who]
  )
  return rows[0]
}

const EDITABLE = ['title', 'type', 'owner', 'due_on', 'due_time', 'priority', 'notes'] as const

export async function updateTask(id: number, t: Partial<Task>): Promise<Task | null> {
  const cols = EDITABLE.filter((c) => c in t)
  if (!cols.length) return one<Task>('select * from tasks where id = $1', [id])
  const sets = cols.map((c, i) => `${c} = $${i + 2}`)
  const rows = await q<Task>(`update tasks set ${sets.join(', ')} where id = $1 returning *`, [id, ...cols.map((c) => t[c])])
  return rows[0] ?? null
}

/** Complete, reopen or cancel. Completing writes a timeline entry on the lead. */
export async function setTaskStatus(id: number, status: 'done' | 'open' | 'cancelled', who: string, reason = ''): Promise<Task | null> {
  const task = await one<Task>('select * from tasks where id = $1', [id])
  if (!task) return null
  const statements = [
    status === 'open'
      ? { text: `update tasks set status = 'open', done_at = null, done_by = '', cancelled_reason = '' where id = $1 returning *`, params: [id] }
      : { text: `update tasks set status = $2, done_at = now(), done_by = $3, cancelled_reason = $4 where id = $1 returning *`, params: [id, status, who, status === 'cancelled' ? reason.slice(0, 300) : ''] },
  ]
  if (status === 'done' && task.lead_id && task.status !== 'done') {
    statements.push({
      text: `insert into events (lead_id, type, who, summary, meta, source, created_by)
             values ($1, 'task_done', $2, $3, $4::jsonb, 'system', $2)`,
      params: [task.lead_id, who, task.title, JSON.stringify({ task_id: id, task_type: task.type })],
    })
  }
  const [rows] = await tx(statements)
  return (rows[0] as unknown as Task) ?? null
}

export type TaskQuery = { owner?: string; status?: string; lead?: string; due?: 'overdue' | 'today' | 'week' | 'none'; today?: string; limit?: number }

export async function listTasks(opts: TaskQuery): Promise<Task[]> {
  const params: unknown[] = []
  const bind = (v: unknown) => { params.push(v); return `$${params.length}` }
  const where: string[] = ['(l.id is null or l.deleted_at is null)']
  const status = ['open', 'done', 'cancelled'].includes(String(opts.status)) ? String(opts.status) : 'open'
  where.push(`t.status = ${bind(status)}`)
  if (opts.owner) where.push(`t.owner = ${bind(opts.owner)}`)
  if (opts.lead) where.push(`t.lead_id = ${bind(opts.lead)}`)
  const today = opts.today && ISO_DAY.test(opts.today) ? opts.today : todayLocal()
  if (opts.due === 'overdue') where.push(`t.due_on < ${bind(today)}`)
  if (opts.due === 'today') where.push(`t.due_on = ${bind(today)}`)
  if (opts.due === 'week') where.push(`t.due_on between ${bind(today)} and (${bind(today)}::date + 7)`)
  if (opts.due === 'none') where.push('t.due_on is null')
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 500)

  return q<Task>(
    `select t.*, l.company, l.stage, l.who as contact
       from tasks t left join leads l on l.id = t.lead_id
      where ${where.join(' and ')}
      order by ${status === 'open' ? `t.due_on asc nulls last, case t.priority when 'high' then 0 when 'normal' then 1 else 2 end, t.id` : 't.done_at desc'}
      limit ${bind(limit)}`,
    params
  )
}

export function getTask(id: number) {
  return one<Task>('select * from tasks where id = $1', [id])
}
