import { q, one } from './db'
import { newId } from './auth'
import { WRITABLE_FIELDS, ENUMS, type WritableField } from './constants'

export type Lead = Record<string, unknown> & {
  id: string
  company: string
  batch: string
  status: string
}

const INT_FIELDS = new Set<WritableField>(['opp', 'buy', 'seq'])
const MAX_TEXT = 20000

/**
 * Reduce an arbitrary request body to a safe set of column/value pairs.
 *
 * Two things matter here. Column names come only from WRITABLE_FIELDS, so a caller
 * can never name a column we didn't intend to expose. Values are coerced and length-capped,
 * and enum columns are rejected outright if they carry an unrecognised value — otherwise a
 * typo in a status silently creates a category that no filter will ever match.
 */
export function sanitize(body: unknown): { patch: Partial<Record<WritableField, unknown>>; errors: string[] } {
  const patch: Partial<Record<WritableField, unknown>> = {}
  const errors: string[] = []
  if (!body || typeof body !== 'object') return { patch, errors: ['Body must be an object'] }
  const input = body as Record<string, unknown>

  for (const field of WRITABLE_FIELDS) {
    if (!(field in input)) continue
    const raw = input[field]

    if (INT_FIELDS.has(field)) {
      if (raw === null || raw === '') { patch[field] = field === 'seq' ? null : 0; continue }
      const n = Number(raw)
      if (!Number.isFinite(n)) { errors.push(`${field} must be a number`); continue }
      if (field === 'opp' && (n < 1 || n > 5)) { errors.push('opp must be between 1 and 5'); continue }
      patch[field] = Math.trunc(n)
      continue
    }

    if (field === 'date_sent') {
      if (!raw) { patch[field] = null; continue }
      const s = String(raw).slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) { errors.push('date_sent must be YYYY-MM-DD'); continue }
      patch[field] = s
      continue
    }

    const s = String(raw ?? '')
    if (s.length > MAX_TEXT) { errors.push(`${field} exceeds ${MAX_TEXT} characters`); continue }

    const allowed = ENUMS[field]
    if (allowed && s && !allowed.includes(s)) {
      errors.push(`${field} must be one of: ${allowed.join(', ')}`)
      continue
    }
    patch[field] = s
  }

  return { patch, errors }
}

export async function listLeads(): Promise<Lead[]> {
  return q<Lead>(
    `select * from leads
     order by batch desc, coalesce(seq, 2147483647), company asc`
  )
}

export async function getLead(id: string): Promise<Lead | null> {
  return one<Lead>('select * from leads where id = $1', [id])
}

export async function createLead(
  patch: Partial<Record<WritableField, unknown>>,
  who: string
): Promise<Lead> {
  const id = newId()
  const cols = Object.keys(patch) as WritableField[]
  const values = cols.map((c) => patch[c])

  // Column names are whitelisted above; values go in as bind parameters.
  const columnList = ['id', ...cols, 'created_by', 'updated_by'].join(', ')
  const placeholders = ['$1', ...cols.map((_, i) => `$${i + 2}`), `$${cols.length + 2}`, `$${cols.length + 3}`]

  const rows = await q<Lead>(
    `insert into leads (${columnList}) values (${placeholders.join(', ')}) returning *`,
    [id, ...values, who, who]
  )
  await logActivity(id, who, `added ${String(patch.company ?? 'a lead')}`)
  return rows[0]
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
    `update leads set ${sets.join(', ')} where id = $1 returning *`,
    [id, ...cols.map((c) => patch[c]), who]
  )
  return rows.length ? rows[0] : null
}

export async function deleteLead(id: string, who: string): Promise<boolean> {
  const existing = await getLead(id)
  if (!existing) return false
  await q('delete from leads where id = $1', [id])
  await logActivity(null, who, `deleted ${existing.company}`)
  return true
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
