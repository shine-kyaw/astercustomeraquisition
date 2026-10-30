import { q, one } from './db'
import { siteKey } from './keys'
import { logActivity } from './leads'

/**
 * Companies researched and ruled out. This replaces the project doc "Lead Engine —
 * companies already ruled out" as the place the skill's step 12 writes to, so the next
 * batch's exclusion list carries them automatically. Rows are never deleted: reconsidering
 * a company sets revoked_at, and the original reason stays readable.
 */
export const EXCLUSION_CATEGORIES = [
  { key: 'good_site', label: 'Website already good' },
  { key: 'agency', label: 'Agency or designer credit' },
  { key: 'too_big', label: 'Too large / funded / holding company' },
  { key: 'inactive', label: 'Inactive or dissolved' },
  { key: 'no_decision_maker', label: 'No nameable decision-maker' },
  { key: 'weak_signals', label: 'Insufficient buying signals' },
  { key: 'unreachable', label: 'No working contact' },
  { key: 'client', label: 'Existing client' },
  { key: 'contacted', label: 'Already contacted outside the app' },
  { key: 'other', label: 'Other' },
] as const
export const EXCLUSION_KEYS = EXCLUSION_CATEGORIES.map((c) => c.key) as readonly string[]

export type Exclusion = {
  id: number
  company: string
  domain: string
  reason: string
  category: string
  source: string
  reviewed_on: string
  reviewed_by: string
  reconsider_if: string
  created_at: string
  revoked_at: string | null
  revoked_by: string
  revoked_reason: string
}

export function cleanExclusion(body: Record<string, unknown>): { row: Partial<Exclusion>; error?: string } {
  const company = String(body.company ?? '').trim().slice(0, 300)
  if (!company) return { row: {}, error: 'A company name is required' }
  const category = String(body.category ?? 'other')
  const reviewed = String(body.reviewed_on ?? '')
  return {
    row: {
      company,
      domain: siteKey(body.domain ?? body.site ?? ''),
      reason: String(body.reason ?? '').trim().slice(0, 2000),
      category: EXCLUSION_KEYS.includes(category) ? category : 'other',
      source: String(body.source ?? '').slice(0, 300),
      reviewed_on: /^\d{4}-\d{2}-\d{2}$/.test(reviewed) ? reviewed : undefined,
      reconsider_if: String(body.reconsider_if ?? '').slice(0, 1000),
    },
  }
}

export async function addExclusions(rows: Partial<Exclusion>[], who: string): Promise<{ added: Exclusion[]; skipped: { company: string; reason: string }[] }> {
  const added: Exclusion[] = []
  const skipped: { company: string; reason: string }[] = []
  const existing = await q<{ company: string; domain: string }>('select company, domain from exclusions where revoked_at is null')
  const seenDomains = new Set(existing.map((e) => e.domain).filter(Boolean))
  const seenNames = new Set(existing.map((e) => e.company.toLowerCase()))

  for (const r of rows) {
    if ((r.domain && seenDomains.has(r.domain)) || seenNames.has(String(r.company).toLowerCase())) {
      skipped.push({ company: String(r.company), reason: 'already on the ruled-out list' })
      continue
    }
    const [row] = await q<Exclusion>(
      `insert into exclusions (company, domain, reason, category, source, reviewed_on, reviewed_by, reconsider_if)
       values ($1, $2, $3, $4, $5, coalesce($6::date, current_date), $7, $8) returning *`,
      [r.company, r.domain ?? '', r.reason ?? '', r.category ?? 'other', r.source ?? '', r.reviewed_on ?? null, who, r.reconsider_if ?? '']
    )
    added.push(row)
    if (row.domain) seenDomains.add(row.domain)
    seenNames.add(row.company.toLowerCase())
  }
  if (added.length) await logActivity(null, who, `ruled out ${added.length} compan${added.length === 1 ? 'y' : 'ies'}`)
  return { added, skipped }
}

export function listExclusions(opts: { includeRevoked?: boolean; q?: string } = {}) {
  const params: unknown[] = []
  const where = [opts.includeRevoked ? 'true' : 'revoked_at is null']
  if (opts.q) {
    params.push(`%${String(opts.q).slice(0, 200).replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
    where.push(`(company ilike $1 or domain ilike $1 or reason ilike $1)`)
  }
  return q<Exclusion>(`select * from exclusions where ${where.join(' and ')} order by reviewed_on desc, id desc limit 2000`, params)
}

export async function revokeExclusion(id: number, who: string, reason: string): Promise<Exclusion | null> {
  const row = await one<Exclusion>(
    `update exclusions set revoked_at = now(), revoked_by = $2, revoked_reason = $3
      where id = $1 and revoked_at is null returning *`,
    [id, who, reason.slice(0, 1000)]
  )
  if (row) await logActivity(null, who, `reconsidering ${row.company} (removed from ruled-out)${reason ? ` — ${reason}` : ''}`.slice(0, 500))
  return row
}
