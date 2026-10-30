import { q, one, tx, type Statement } from './db'
import { httpError } from './http'
import {
  planEvent, eventLabel, EVENT_KEYS, SYSTEM_EVENTS, CONTACT_EVENTS, COLD_TASKS, todayLocal,
  type LeadState, type Plan,
} from './crm'

/** Lead columns a plan is allowed to set. Anything else in a plan is a bug, and is dropped. */
const PLAN_COLUMNS = new Set([
  'stage', 'stage_changed_at', 'lost_reason', 'status', 'date_sent', 'reply',
  'do_not_contact', 'dnc_reason', 'dnc_at',
  'mockup_status', 'mockup_url', 'mockup_due',
  'proposal_status', 'proposal_url', 'proposal_amount', 'proposal_sent_on', 'proposal_version',
  'deal_value', 'currency', 'package', 'deposit_status',
])

export type EventRow = {
  id: number
  lead_id: string | null
  type: string
  occurred_at: string
  who: string
  summary: string
  ext_ref: string
  meta: Record<string, unknown>
  source: string
  voided_at: string | null
}

export type LogInput = {
  type: string
  date?: string           // YYYY-MM-DD in the user's own time zone
  at?: string             // ISO instant, computed in the browser when a time was given
  summary?: string
  extRef?: string
  meta?: Record<string, unknown>
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function loadLeadState(id: string) {
  return one<LeadState & { deleted_at: string | null }>(
    `select id, company, stage, status, owner, who, phone, date_sent, do_not_contact,
            proposal_version, proposal_status, deal_value, deleted_at
       from leads where id = $1`,
    [id]
  )
}

/**
 * Turn a plan into SQL. Every statement goes into one transaction, so an event can never
 * land without the stage change it caused, or schedule a reminder that its stage change
 * then failed to make.
 */
function planStatements(leadId: string, plan: Plan, who: string, openTypes: Set<string>): Statement[] {
  const out: Statement[] = []

  const cols = Object.keys(plan.lead).filter((c) => PLAN_COLUMNS.has(c))
  if (cols.length) {
    // Column names come from PLAN_COLUMNS, never from input; values are bound.
    const sets = cols.map((c, i) => `${c} = $${i + 2}`)
    sets.push('updated_at = now()', `updated_by = $${cols.length + 2}`)
    out.push({ text: `update leads set ${sets.join(', ')} where id = $1`, params: [leadId, ...cols.map((c) => plan.lead[c]), who] })
  }

  if (plan.completeTypes.length) {
    out.push({
      text: `update tasks set status = 'done', done_at = now(), done_by = $3
              where lead_id = $1 and status = 'open' and type = any($2::text[])`,
      params: [leadId, plan.completeTypes, who],
    })
  }

  if (plan.cancel) {
    const all = plan.cancel.types === 'all'
    out.push({
      text: `update tasks set status = 'cancelled', done_at = now(), done_by = $2, cancelled_reason = $3
              where lead_id = $1 and status = 'open' ${all ? '' : 'and type = any($4::text[])'}`,
      params: all ? [leadId, who, plan.cancel.reason] : [leadId, who, plan.cancel.reason, plan.cancel.types],
    })
  }

  for (const t of plan.createTasks) {
    // One open reminder of a kind per lead: logging a second send doesn't stack a second
    // follow-up on top of the first. auto_key also makes a repeated request a no-op.
    const cancelledNow = plan.cancel && (plan.cancel.types === 'all' || plan.cancel.types.includes(t.type))
    if (openTypes.has(t.type) && !cancelledNow) continue
    // Same trigger again (same key): a cancelled reminder comes back — e.g. a send was
    // voided, then really sent the same day — but a completed one is never reopened.
    out.push({
      text: `insert into tasks (lead_id, title, type, owner, due_on, due_time, priority, auto_key, created_by)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             on conflict (auto_key) do update
               set status = 'open', done_at = null, done_by = '', cancelled_reason = '',
                   due_on = excluded.due_on, due_time = excluded.due_time, owner = excluded.owner
             where tasks.status = 'cancelled'`,
      params: [leadId, t.title, t.type, t.owner, t.due_on, t.due_time ?? '', t.priority, t.auto_key, who],
    })
  }
  return out
}

/**
 * Record something that happened to a lead, and apply what it implies.
 *
 * Refuses outreach to anyone marked do-not-contact. That check is here, on the server,
 * so no client, script or future integration can skip it.
 */
export async function recordEvent(
  leadId: string,
  input: LogInput,
  who: string,
  opts: { source?: 'manual' | 'status' | 'import' | 'system'; statusDriven?: boolean; leadBefore?: LeadState } = {}
): Promise<{ event: EventRow; plan: Plan }> {
  const type = String(input.type ?? '')
  if (!EVENT_KEYS.includes(type)) throw httpError(400, `Unknown activity type "${type}"`)
  if ((opts.source ?? 'manual') === 'manual' && SYSTEM_EVENTS.includes(type) && type !== 'stage_changed') {
    throw httpError(400, `"${eventLabel(type)}" is recorded automatically and can't be logged by hand`)
  }

  const lead = opts.leadBefore ?? (await loadLeadState(leadId))
  if (!lead || (lead as { deleted_at?: unknown }).deleted_at) throw httpError(404, 'No lead with that id')
  if (lead.do_not_contact && CONTACT_EVENTS.includes(type)) {
    throw httpError(409, `${lead.company} asked not to be contacted. Outreach can't be logged against this lead.`)
  }

  const date = input.date && ISO_DAY.test(input.date) ? input.date : todayLocal()
  const summary = String(input.summary ?? '').slice(0, 4000)
  const extRef = String(input.extRef ?? '').slice(0, 1000)
  const meta = input.meta && typeof input.meta === 'object' ? input.meta : {}
  // The browser sends `at` (a full ISO instant) when a time was given, so the time zone is
  // the user's. A date with no time sits at noon UTC, which stays on the same calendar day
  // from Yangon to Texas. No date at all means now.
  const at = typeof input.at === 'string' && !Number.isNaN(Date.parse(input.at)) ? new Date(input.at).toISOString() : ''
  const occurredAt = at || (input.date && ISO_DAY.test(input.date) ? `${date}T12:00:00Z` : new Date().toISOString())

  const plan = planEvent(lead, { type, date, who, summary, meta }, { statusDriven: opts.statusDriven })

  const openTypes = new Set(
    (await q<{ type: string }>(`select distinct type from tasks where lead_id = $1 and status = 'open'`, [leadId])).map((r) => r.type)
  )

  const statements: Statement[] = [
    {
      text: `insert into events (lead_id, type, occurred_at, who, summary, ext_ref, meta, source, created_by)
             values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $4) returning *`,
      params: [leadId, type, occurredAt, who.slice(0, 120), summary, extRef, JSON.stringify(meta), opts.source ?? 'manual'],
    },
    ...planStatements(leadId, plan, who, openTypes),
    {
      text: 'insert into activity (lead_id, who, action) values ($1, $2, $3)',
      params: [leadId, who.slice(0, 120), `${eventLabel(type).toLowerCase()} · ${lead.company}${summary ? ` — ${summary.slice(0, 160)}` : ''}`.slice(0, 500)],
    },
  ]

  const results = await tx(statements)
  return { event: results[0][0] as unknown as EventRow, plan }
}

/**
 * Undo status-inferred contact events: the skill's correction when a lead was marked
 * Emailed at drafting and the email never went out. Only events inferred from a status
 * change are voided — anything someone logged by hand stays.
 */
export async function voidStatusContacts(leadId: string, who: string): Promise<number> {
  const rows = await tx([
    {
      text: `update events set voided_at = now(), voided_by = $2
              where lead_id = $1 and source = 'status' and voided_at is null and type = any($3::text[])
              returning id`,
      params: [leadId, who, CONTACT_EVENTS],
    },
    {
      text: `update tasks set status = 'cancelled', done_at = now(), done_by = $2, cancelled_reason = 'Set back to Not sent'
              where lead_id = $1 and status = 'open' and type = any($3::text[])`,
      params: [leadId, who, COLD_TASKS],
    },
    {
      text: `update leads set stage = 'new', lost_reason = '', stage_changed_at = now() where id = $1 and stage <> 'new'`,
      params: [leadId],
    },
  ])
  return rows[0].length
}

/** Void one event by hand: its author can, and so can an admin. Its side effects stay. */
export async function voidEvent(id: number, who: string, isAdmin: boolean): Promise<EventRow | null> {
  const ev = await one<EventRow & { created_by: string }>('select * from events where id = $1', [id])
  if (!ev) return null
  if (!isAdmin && ev.created_by !== who) throw httpError(403, 'Only the person who logged it, or Shine, can remove that entry.')
  if (SYSTEM_EVENTS.includes(ev.type)) throw httpError(400, 'System entries can’t be removed.')
  const rows = await q<EventRow>(
    'update events set voided_at = now(), voided_by = $2 where id = $1 and voided_at is null returning *',
    [id, who]
  )
  return rows[0] ?? ev
}

export function leadTimeline(leadId: string, includeVoided = false) {
  return q<EventRow>(
    `select * from events where lead_id = $1 ${includeVoided ? '' : 'and voided_at is null'}
      order by occurred_at desc, id desc limit 500`,
    [leadId]
  )
}

/** Recent events across every lead, for the Activity page. */
export function recentEvents(opts: { limit?: number; before?: string; who?: string; type?: string }) {
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 300)
  const params: unknown[] = [limit]
  const where = ['e.voided_at is null', "e.type <> 'migrated'"]
  if (opts.before) { params.push(opts.before); where.push(`e.occurred_at < $${params.length}`) }
  if (opts.who) { params.push(opts.who); where.push(`e.who = $${params.length}`) }
  if (opts.type && EVENT_KEYS.includes(opts.type)) { params.push(opts.type); where.push(`e.type = $${params.length}`) }
  return q(
    `select e.*, l.company, l.stage
       from events e left join leads l on l.id = e.lead_id
      where ${where.join(' and ')}
      order by e.occurred_at desc, e.id desc
      limit $1`,
    params
  )
}
