import { q, one } from './db'
import { newId } from './auth'
import {
  WRITABLE_FIELDS, ENUMS, FORMER_MAILS, FORMER_NAMES, INT_FIELDS, MONEY_FIELDS, DATE_FIELDS,
  type WritableField,
} from './constants'
import { siteKey, companyKey } from './keys'
import { recordEvent, voidStatusContacts } from './events'
import { statusToStage, eventForStatus, STAGE_KEYS, LOST_REASON_KEYS, todayLocal, type LeadState } from './crm'
import { httpError } from './http'

// Re-exported so existing importers keep working. Client code must import from ./keys
// directly — this module pulls in the Postgres client.
export { siteKey, companyKey }

export type Lead = Record<string, unknown> & {
  id: string
  company: string
  batch: string
  status: string
}

const MAX_TEXT = 20000
// Enum columns where an empty string isn't a value: blank means "leave it alone".
const NO_BLANK = new Set<WritableField>(['priority', 'currency'])

/**
 * Reduce an arbitrary request body to a safe set of column/value pairs.
 *
 * Two things matter here. Column names come only from WRITABLE_FIELDS, so a caller
 * can never name a column we didn't intend to expose. Values are coerced and length-capped,
 * and enum columns are rejected outright if they carry an unrecognised value — otherwise a
 * typo in a status silently creates a category that no filter will ever match.
 */
export function sanitize(
  body: unknown,
  before?: Record<string, unknown>
): { patch: Partial<Record<WritableField, unknown>>; errors: string[] } {
  const patch: Partial<Record<WritableField, unknown>> = {}
  const errors: string[] = []
  if (!body || typeof body !== 'object') return { patch, errors: ['Body must be an object'] }
  const input = body as Record<string, unknown>

  for (const field of WRITABLE_FIELDS) {
    if (!(field in input)) continue
    const raw = input[field]

    if (INT_FIELDS.includes(field)) {
      if (raw === null || raw === '') { patch[field] = field === 'opp' || field === 'buy' ? 0 : null; continue }
      const n = Number(raw)
      if (!Number.isFinite(n)) { errors.push(`${field} must be a number`); continue }
      if (field === 'opp' && (n < 1 || n > 5)) { errors.push('opp must be between 1 and 5'); continue }
      patch[field] = Math.trunc(n)
      continue
    }

    if (MONEY_FIELDS.includes(field)) {
      if (raw === null || raw === '') { patch[field] = null; continue }
      const n = Number(String(raw).replace(/[,\s]/g, ''))
      if (!Number.isFinite(n) || n < 0 || n > 1e12) { errors.push(`${field} must be a positive amount`); continue }
      patch[field] = Math.round(n * 100) / 100
      continue
    }

    if (DATE_FIELDS.includes(field)) {
      if (!raw) { patch[field] = null; continue }
      const s = String(raw).slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) { errors.push(`${field} must be YYYY-MM-DD`); continue }
      patch[field] = s
      continue
    }

    const s = String(raw ?? '')
    if (s.length > MAX_TEXT) { errors.push(`${field} exceeds ${MAX_TEXT} characters`); continue }
    if (!s && NO_BLANK.has(field)) continue

    const allowed = ENUMS[field]
    if (allowed && s && !allowed.includes(s)) {
      errors.push(`${field} must be one of: ${allowed.join(', ')}`)
      continue
    }

    // Someone who has left can't be given new work. A lead that already carries their
    // name or mailbox keeps it (that's history), so an unchanged value is let through —
    // otherwise saving any field on such a lead would fail.
    const unchanged = before && String(before[field] ?? '') === s
    if (!unchanged && field === 'sender' && FORMER_MAILS.includes(s.toLowerCase())) {
      errors.push(`${s} is no longer an Aster mailbox — choose another sender`)
      continue
    }
    if (!unchanged && field === 'owner' && FORMER_NAMES.includes(s)) {
      errors.push(`${s} is no longer on the team — choose another owner`)
      continue
    }
    patch[field] = s
  }

  return { patch, errors }
}

export type Duplicate = { id: string; company: string; batch: string; status: string; kind: 'lead' | 'ruled_out' }

/**
 * Find an existing lead — or a company already researched and ruled out — that looks like
 * the same business. Domain match is the strong signal; name match catches the case where
 * someone recorded a different URL for it. Deleted leads count: deleting a lead must not
 * let it be researched and pitched again. Returns null when nothing matches.
 */
export async function findDuplicate(company: unknown, site: unknown): Promise<Duplicate | null> {
  const sk = siteKey(site)
  const ck = companyKey(company)
  if (!sk && !ck) return null

  const rows = await q<{ id: string; company: string; batch: string; status: string; site: string; deleted_at: string | null }>(
    'select id, company, batch, status, site, deleted_at from leads'
  )
  for (const row of rows) {
    if ((sk && siteKey(row.site) === sk) || (ck && companyKey(row.company) === ck)) {
      return { id: row.id, company: row.company, batch: row.batch, status: row.deleted_at ? `${row.status}, deleted` : row.status, kind: 'lead' }
    }
  }

  const ruled = await q<{ id: string; company: string; domain: string; reason: string; reviewed_on: string }>(
    'select id::text, company, domain, reason, reviewed_on from exclusions where revoked_at is null'
  )
  for (const row of ruled) {
    if ((sk && siteKey(row.domain) === sk) || (ck && companyKey(row.company) === ck)) {
      return { id: row.id, company: row.company, batch: `Ruled out ${row.reviewed_on}`, status: row.reason || 'ruled out', kind: 'ruled_out' }
    }
  }
  return null
}

/** Every live lead, as before. The skill reads this endpoint whole, so its shape stays. */
export async function listLeads(): Promise<Lead[]> {
  return q<Lead>(
    `select * from leads where deleted_at is null
     order by batch desc, coalesce(seq, 2147483647), company asc`
  )
}

export type LeadQuery = {
  q?: string
  stage?: string
  owner?: string
  geo?: string
  view?: string
  sort?: string
  limit?: number
  offset?: number
  me?: string
  today?: string
  deleted?: boolean
}

const SORTS: Record<string, string> = {
  recent: 'l.updated_at desc',
  company: 'l.company asc',
  batch: 'l.batch desc, coalesce(l.seq, 2147483647), l.company asc',
  value: 'l.deal_value desc nulls last, l.company asc',
  next: 'nt.due_on asc nulls last, l.company asc',
  opportunity: 'l.opp desc, l.buy desc, l.company asc',
}

/**
 * Server-side search, filtering and paging, so the browser never has to hold every lead.
 * Each row carries its next open task, which is what the list shows instead of a status.
 */
export async function searchLeads(opts: LeadQuery): Promise<{ leads: Lead[]; total: number }> {
  const params: unknown[] = []
  const where: string[] = [opts.deleted ? 'l.deleted_at is not null' : 'l.deleted_at is null']
  const bind = (v: unknown) => { params.push(v); return `$${params.length}` }

  const text = String(opts.q ?? '').trim().slice(0, 200)
  if (text) {
    const p = bind(`%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
    where.push(`(l.company ilike ${p} or l.who ilike ${p} or l.email ilike ${p} or l.site ilike ${p}
                 or l.loc ilike ${p} or l.note ilike ${p} or l.batch ilike ${p} or l.owner ilike ${p})`)
  }
  if (opts.stage && (STAGE_KEYS as readonly string[]).includes(opts.stage)) where.push(`l.stage = ${bind(opts.stage)}`)
  if (opts.stage === 'active') where.push(`l.stage not in ('won', 'lost')`)
  if (opts.owner === 'unassigned') where.push(`l.owner = ''`)
  else if (opts.owner) where.push(`l.owner = ${bind(opts.owner)}`)
  if (opts.geo) where.push(`l.geo = ${bind(opts.geo)}`)

  const today = opts.today && /^\d{4}-\d{2}-\d{2}$/.test(opts.today) ? opts.today : todayLocal()
  switch (opts.view) {
    case 'mine': where.push(`l.owner = ${bind(opts.me ?? '')}`); break
    case 'no_next_step':
      where.push(`l.stage in ('outreach','engaged','meeting','mockup','proposal') and nt.id is null and not l.do_not_contact`)
      break
    case 'overdue': where.push(`nt.due_on < ${bind(today)}`); break
    case 'stale_research':
      where.push(`l.stage = 'new' and l.researched_on < (${bind(today)}::date - 14)`)
      break
    case 'high_value': where.push(`(l.priority = 'high' or l.deal_value is not null) and l.stage not in ('won','lost')`); break
    case 'dnc': where.push('l.do_not_contact'); break
    case 'reassign':
      where.push(`l.owner = any(${bind(FORMER_NAMES)}::text[]) and l.stage not in ('won','lost')`)
      break
  }

  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 500)
  const offset = Math.max(Number(opts.offset) || 0, 0)
  const order = SORTS[opts.sort ?? ''] ?? SORTS.batch

  // Next open task per lead: the earliest due, undated ones last.
  const from = `
    from leads l
    left join lateral (
      select t.id, t.title, t.type, t.due_on, t.due_time, t.owner
        from tasks t where t.lead_id = l.id and t.status = 'open'
       order by t.due_on asc nulls last, t.id asc limit 1
    ) nt on true
    where ${where.join(' and ')}`

  const [{ total }] = await q<{ total: number }>(`select count(*)::int as total ${from}`, params)
  const leads = await q<Lead>(
    `select l.*,
            nt.id as next_task_id, nt.title as next_task_title, nt.type as next_task_type,
            nt.due_on as next_task_due, nt.due_time as next_task_time,
            (select max(e.occurred_at) from events e
              where e.lead_id = l.id and e.voided_at is null and e.type not in ('migrated','status_changed')) as last_activity_at
     ${from}
     order by ${order}
     limit ${bind(limit)} offset ${bind(offset)}`,
    params
  )
  return { leads, total }
}

export async function getLead(id: string, opts: { includeDeleted?: boolean } = {}): Promise<Lead | null> {
  return one<Lead>(`select * from leads where id = $1 ${opts.includeDeleted ? '' : 'and deleted_at is null'}`, [id])
}

/**
 * Insert a lead, then record how it arrived. A lead imported already "Emailed" (the skill
 * allows that once the Sent folder confirms it) gets the send recorded as an event dated
 * with its real date_sent, so the follow-up reminders start from the right day.
 */
export async function createLead(
  patch: Partial<Record<WritableField, unknown>>,
  who: string,
  how: { via?: 'manual' | 'import'; batch?: string } = {}
): Promise<Lead> {
  const id = newId()
  const status = String(patch.status || 'Not sent')
  const stage = statusToStage(status)
  const fields: Record<string, unknown> = {
    ...patch,
    stage,
    lost_reason: stage === 'lost' ? (status === 'No fit' ? 'no_fit' : 'dead') : '',
    researched_on: patch.researched_on ?? todayLocal(),
    stage_changed_at: new Date().toISOString(),
  }
  const cols = Object.keys(fields)

  // Column names are whitelisted (sanitize) or fixed above; values go in as bind parameters.
  const columnList = ['id', ...cols, 'created_by', 'updated_by'].join(', ')
  const placeholders = ['$1', ...cols.map((_, i) => `$${i + 2}`), `$${cols.length + 2}`, `$${cols.length + 3}`]

  const rows = await q<Lead>(
    `insert into leads (${columnList}) values (${placeholders.join(', ')}) returning *`,
    [id, ...cols.map((c) => fields[c]), who, who]
  )
  const lead = rows[0]

  const via = how.via ?? 'manual'
  await recordEvent(
    id,
    {
      type: via === 'import' ? 'imported' : 'created',
      summary: via === 'import' ? `Imported${how.batch ? ` into ${how.batch}` : ''} with status "${status}"` : `Added with status "${status}"`,
    },
    who,
    { source: 'system', leadBefore: asState(lead) }
  )

  const implied = eventForStatus('Not sent', status)
  if (implied && 'type' in implied && implied.type !== 'stage_changed') {
    const sent = String(patch.date_sent ?? '').slice(0, 10)
    await recordEvent(
      id,
      { type: implied.type, date: sent || undefined, meta: { ...implied.meta, from_status: status }, summary: `Recorded from status "${status}" at ${via}` },
      who,
      { source: 'status', statusDriven: true, leadBefore: { ...asState(lead), stage: 'new', status } }
    )
  }
  return (await getLead(id)) ?? lead
}

function asState(l: Lead): LeadState {
  return {
    id: l.id, company: l.company, stage: String(l.stage ?? 'new'), status: l.status,
    owner: String(l.owner ?? ''), who: String(l.who ?? ''), phone: String(l.phone ?? ''),
    date_sent: (l.date_sent as string | null) ?? null, do_not_contact: Boolean(l.do_not_contact),
    proposal_version: (l.proposal_version as number | null) ?? null, proposal_status: String(l.proposal_status ?? ''),
    deal_value: (l.deal_value as number | null) ?? null,
  }
}

export async function updateLead(
  id: string,
  patch: Partial<Record<WritableField, unknown>>,
  who: string
): Promise<Lead | null> {
  const cols = Object.keys(patch) as WritableField[]
  if (!cols.length) return getLead(id)

  const sets = cols.map((c, i) => `${c} = $${i + 2}`)
  sets.push(`updated_at = now()`, `updated_by = $${cols.length + 2}`)

  const rows = await q<Lead>(
    `update leads set ${sets.join(', ')} where id = $1 and deleted_at is null returning *`,
    [id, ...cols.map((c) => patch[c]), who]
  )
  return rows.length ? rows[0] : null
}

/**
 * Apply a PATCH: plain field edits, plus the two moves that are really events.
 *
 *  - `status` (legacy): the skill sets it from Gmail's Sent folder and from replies, so a
 *    change is translated into the event it describes — "Emailed" records a send, "Not
 *    sent" after "Emailed" voids sends that were only ever inferred from status.
 *  - `stage` (new): a pipeline move. Won and Closed go through the won/lost events, so
 *    the handoff reminder and the lost reason are never skipped.
 */
export async function patchLead(
  before: Lead,
  body: Record<string, unknown>,
  who: string
): Promise<{ lead: Lead | null; errors: string[]; changed: string[] }> {
  const { patch, errors } = sanitize(body, before)
  if (errors.length) return { lead: null, errors, changed: [] }

  const stageTo = body.stage === undefined ? null : String(body.stage)
  if (stageTo !== null && !(STAGE_KEYS as readonly string[]).includes(stageTo)) {
    return { lead: null, errors: [`stage must be one of: ${STAGE_KEYS.join(', ')}`], changed: [] }
  }
  if (stageTo === 'lost' && body.lost_reason !== undefined && !LOST_REASON_KEYS.includes(String(body.lost_reason))) {
    return { lead: null, errors: [`lost_reason must be one of: ${LOST_REASON_KEYS.join(', ')}`], changed: [] }
  }

  const changed = describeChanges(before, patch)
  const statusFrom = before.status
  const statusTo = patch.status === undefined ? statusFrom : String(patch.status)

  // A status change sent together with date_sent dates the event it implies.
  let lead = await updateLead(before.id, patch, who)
  if (!lead) return { lead: null, errors: [], changed }

  if (statusTo !== statusFrom) {
    const implied = eventForStatus(statusFrom, statusTo)
    if (implied && 'voidStatusContacts' in implied) {
      await voidStatusContacts(before.id, who)
    } else if (implied) {
      await recordEvent(
        before.id,
        {
          type: implied.type,
          date: String(patch.date_sent ?? '').slice(0, 10) || undefined,
          meta: { ...implied.meta, from_status: statusFrom, to_status: statusTo },
          summary: `Status changed from "${statusFrom}" to "${statusTo}"`,
        },
        who,
        { source: 'status', statusDriven: true, leadBefore: { ...asState(before), status: statusTo } }
      )
    }
  }

  if (stageTo !== null && stageTo !== String((await getLead(before.id))?.stage)) {
    const current = await getLead(before.id)
    if (current) {
      const meta: Record<string, unknown> = { from: current.stage, to: stageTo }
      if (stageTo === 'won') {
        await recordEvent(before.id, { type: 'won', meta: { amount: body.deal_value, currency: body.currency, package: body.package }, summary: String(body.note_for_move ?? '') }, who, { leadBefore: asState(current) })
      } else if (stageTo === 'lost') {
        await recordEvent(before.id, { type: 'lost', meta: { reason: body.lost_reason ?? 'no_response' }, summary: String(body.note_for_move ?? '') }, who, { leadBefore: asState(current) })
      } else if (current.stage === 'lost' || current.stage === 'won') {
        await recordEvent(before.id, { type: 'reopened', meta: { to: stageTo }, summary: String(body.note_for_move ?? '') }, who, { leadBefore: asState(current) })
      } else {
        await recordEvent(before.id, { type: 'stage_changed', meta, summary: '' }, who, { source: 'system', leadBefore: asState(current) })
      }
      changed.push('stage')
    }
  }

  lead = await getLead(before.id)
  return { lead, errors: [], changed }
}

/**
 * Soft delete. The row stays so it keeps blocking re-import and stays on the exclusion
 * list; its timeline and tasks stay too. Open tasks are cancelled so nobody is reminded
 * about a lead that no longer shows anywhere.
 */
export async function deleteLead(id: string, who: string): Promise<boolean> {
  const existing = await getLead(id)
  if (!existing) return false
  await q(`update leads set deleted_at = now(), deleted_by = $2 where id = $1`, [id, who])
  await q(`update tasks set status = 'cancelled', done_at = now(), done_by = $2, cancelled_reason = 'Lead deleted'
            where lead_id = $1 and status = 'open'`, [id, who])
  await logActivity(id, who, `deleted ${existing.company}`)
  return true
}

export async function restoreLead(id: string, who: string): Promise<Lead | null> {
  const rows = await q<Lead>(
    `update leads set deleted_at = null, deleted_by = '', updated_at = now(), updated_by = $2
      where id = $1 and deleted_at is not null returning *`,
    [id, who]
  )
  if (!rows.length) return null
  await logActivity(id, who, `restored ${rows[0].company}`)
  return rows[0]
}

/** Clear a do-not-contact flag. Admin only (checked by the route); always logged. */
export async function clearDoNotContact(id: string, who: string, reason: string): Promise<Lead | null> {
  const rows = await q<Lead>(
    `update leads set do_not_contact = false, dnc_reason = '', dnc_at = null, updated_at = now(), updated_by = $2
      where id = $1 returning *`,
    [id, who]
  )
  if (!rows.length) return null
  await logActivity(id, who, `cleared do-not-contact on ${rows[0].company}${reason ? ` — ${reason}` : ''}`.slice(0, 500))
  return rows[0]
}

export async function logActivity(
  leadId: string | null,
  who: string,
  action: string
): Promise<void> {
  await q('insert into activity (lead_id, who, action) values ($1, $2, $3)', [
    leadId,
    who.slice(0, 120),
    action.slice(0, 500),
  ])
}

export async function recentActivity(limit = 200) {
  const capped = Math.min(Math.max(Number(limit) || 200, 1), 500)
  return q('select * from activity order by at desc limit $1', [capped])
}

/** Human-readable diff so the activity log says what actually changed, not just "edited". */
export function describeChanges(
  before: Record<string, unknown>,
  patch: Partial<Record<WritableField, unknown>>
): string[] {
  const changed: string[] = []
  for (const [k, v] of Object.entries(patch)) {
    const prev = before[k]
    if (String(prev ?? '') !== String(v ?? '')) changed.push(k)
  }
  return changed
}

/** Guard used by routes before acting on a lead that might be gone. */
export async function requireLead(id: string): Promise<Lead> {
  const lead = await getLead(id)
  if (!lead) throw httpError(404, 'No lead with that id')
  return lead
}
