import { q } from './db'
import { CURRENCIES, type Package } from './crm'

/**
 * Configurable numbers. Package prices are reference prices for estimates and quick-fill
 * — they never overwrite a deal's own value, and reports label anything derived from
 * them as an estimate.
 */
export type Settings = {
  packages: Package[]
  monthly_capacity: number
  stale_after_days: number
  research_max_age_days: number
}

const DEFAULTS: Settings = {
  packages: [
    { key: 'seed', label: 'Seed', amount: 350, currency: 'USD' },
    { key: 'blossom', label: 'Blossom', amount: 1500, currency: 'USD' },
    { key: 'bloom', label: 'Bloom', amount: 3000, currency: 'USD' },
  ],
  monthly_capacity: 6,
  stale_after_days: 14,
  research_max_age_days: 14,
}

export async function getSettings(): Promise<Settings> {
  const rows = await q<{ key: string; value: unknown }>('select key, value from settings')
  const out: Settings = { ...DEFAULTS }
  for (const r of rows) {
    if (r.key in out) (out as Record<string, unknown>)[r.key] = r.value
  }
  return out
}

export function cleanSettings(body: Record<string, unknown>): { values: Partial<Settings>; errors: string[] } {
  const values: Partial<Settings> = {}
  const errors: string[] = []
  if ('packages' in body) {
    const list = Array.isArray(body.packages) ? body.packages : []
    const pkgs: Package[] = []
    for (const p of list.slice(0, 10)) {
      const r = p as Record<string, unknown>
      const key = String(r.key ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30)
      const amount = Number(r.amount)
      const currency = String(r.currency ?? 'USD')
      if (!key || !Number.isFinite(amount) || amount < 0) { errors.push('Each package needs a key and a positive amount'); continue }
      if (!(CURRENCIES as readonly string[]).includes(currency)) { errors.push(`Unknown currency ${currency}`); continue }
      pkgs.push({ key, label: String(r.label ?? key).slice(0, 40), amount, currency })
    }
    values.packages = pkgs
  }
  for (const k of ['monthly_capacity', 'stale_after_days', 'research_max_age_days'] as const) {
    if (!(k in body)) continue
    const n = Number(body[k])
    if (!Number.isInteger(n) || n < 1 || n > 365) errors.push(`${k} must be a whole number from 1 to 365`)
    else values[k] = n
  }
  return { values, errors }
}

export async function saveSettings(values: Partial<Settings>, who: string): Promise<Settings> {
  for (const [key, value] of Object.entries(values)) {
    await q(
      `insert into settings (key, value, updated_by) values ($1, $2::jsonb, $3)
       on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
      [key, JSON.stringify(value), who]
    )
  }
  return getSettings()
}
