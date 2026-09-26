import { siteKey, companyKey } from './keys'

type Entry = { name: string; site: string; aliases: string[]; names: Set<string> }

function today(now: Date): string {
  // Local date, not toISOString(): the team is at UTC+6:30, where the UTC date is
  // yesterday's for the first six and a half hours of every morning.
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/**
 * The text a researcher pastes into a new batch so it never spends time on a company
 * that is already in the system.
 *
 * Deliberately looser than findDuplicate in lib/leads.ts. A matching name on a different
 * domain stays listed as its own line rather than being folded away. The costs are
 * asymmetric: a redundant line is noise, but a company missing from this list is someone
 * re-researching it for twenty minutes — which is exactly what this list exists to stop.
 * Do not tighten it to match findDuplicate.
 */
export function formatExclusionList(
  leads: { company?: unknown; site?: unknown }[],
  now: Date = new Date()
): string {
  const bySite = new Map<string, Entry>()
  const noSite: string[] = []

  for (const lead of leads) {
    const name = String(lead.company ?? '').trim()
    if (!name) continue
    const sk = siteKey(lead.site)
    if (!sk) { noSite.push(name); continue }

    const ck = companyKey(name) || name.toLowerCase()
    const existing = bySite.get(sk)
    if (!existing) {
      bySite.set(sk, { name, site: sk, aliases: [], names: new Set([ck]) })
    } else if (!existing.names.has(ck)) {
      // Same domain, different name. Keep the name: the researcher may only know the
      // business by it, and "Beta Manufacturing" won't match a line that says "Beta Works".
      existing.names.add(ck)
      existing.aliases.push(name)
    }
  }

  const entries = [...bySite.values()]

  // Rows with no site go second so they can be checked against every name already on the
  // list. One that matches is already covered by that line; one that doesn't is kept.
  const seen = new Set(entries.flatMap((e) => [...e.names]))
  for (const name of noSite) {
    const ck = companyKey(name) || name.toLowerCase()
    if (seen.has(ck)) continue
    seen.add(ck)
    entries.push({ name, site: '', aliases: [], names: new Set([ck]) })
  }

  const lines = entries
    .map((e) => {
      const also = e.aliases.length ? ` (also: ${e.aliases.join(', ')})` : ''
      return { sort: e.name, text: `${e.name}${also}${e.site ? ` — ${e.site}` : ''}` }
    })
    .sort((a, b) => a.sort.localeCompare(b.sort, 'en', { sensitivity: 'base' }))
    .map((l) => l.text)

  // The count is taken from the lines themselves, so it cannot drift from what is listed.
  const n = lines.length
  return [
    `Aster lead engine — exclusion list (${n} ${n === 1 ? 'company' : 'companies'}, as of ${today(now)})`,
    'Do not research, shortlist or pitch any company below. This includes the same',
    'business under another trading name, a sister brand, or a different domain.',
    '',
    ...lines,
    '',
  ].join('\n')
}
