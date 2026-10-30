// Compare the "Aster Contact Log" Google Sheet with the CRM database. Read-only on both.
//
//   1. In the sheet: File → Download → Comma-separated values (the "Contact log" tab).
//   2. node --env-file=.env.local scripts/contact-log-reconcile.mjs "Aster Contact Log - Contact log.csv"
//
// Phase A of the Contact Log transition (see docs/CRM.md): before anything syncs, know
// exactly where the two records disagree. It writes nothing anywhere; it prints a report
// and, with --out <file>, a JSON copy of it.
//
// Matching uses the same keys as duplicate detection: the normalised domain first, then
// the company name with legal suffixes stripped. A sheet row with neither is reported
// as unmatchable rather than guessed at.
import { readFileSync, writeFileSync } from 'node:fs'
import { connect } from './dbclient.mjs'
import { siteKey, companyKey } from '../lib/keys.ts'

const file = process.argv[2]
const outIdx = process.argv.indexOf('--out')
if (!file) {
  console.error('Usage: node --env-file=.env.local scripts/contact-log-reconcile.mjs <contact-log.csv> [--out report.json]')
  process.exit(1)
}

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes. */
function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((v) => v.trim()))
}

const [header, ...body] = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''))
const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase())
const C = { company: col('Company'), website: col('Website'), type: col('Type'), status: col('Status'), by: col('Contacted by'), source: col('Source'), first: col('First contacted') }
if (C.company === -1) {
  console.error(`No "Company" column found. Columns: ${header.join(', ')}`)
  process.exit(1)
}

const sheet = body.map((r, i) => ({
  row: i + 2,
  company: (r[C.company] ?? '').trim(),
  website: (r[C.website] ?? '').trim(),
  type: (r[C.type] ?? '').trim(),
  status: (r[C.status] ?? '').trim(),
  by: (r[C.by] ?? '').trim(),
  source: (r[C.source] ?? '').trim(),
  first: (r[C.first] ?? '').trim(),
})).filter((r) => r.company)

const db = await connect()
const leads = await db.query('select id, company, site, status, owner, batch, deleted_at from leads')
const ruled = await db.query('select company, domain from exclusions where revoked_at is null').catch(() => [])
await db.close()

const bySite = new Map(), byName = new Map()
for (const l of leads) {
  const s = siteKey(l.site), n = companyKey(l.company)
  if (s && !bySite.has(s)) bySite.set(s, l)
  if (n && !byName.has(n)) byName.set(n, l)
}
const ruledKeys = new Set(ruled.flatMap((r) => [siteKey(r.domain), companyKey(r.company)].filter(Boolean)))

const report = { sheetRows: sheet.length, appLeads: leads.length, matched: [], statusDiffers: [], onlyInSheet: [], onlyInApp: [], unmatchable: [] }
const matchedIds = new Set()

for (const r of sheet) {
  const s = siteKey(r.website), n = companyKey(r.company)
  if (!s && !n) { report.unmatchable.push(r); continue }
  const lead = (s && bySite.get(s)) || (n && byName.get(n))
  if (!lead) {
    report.onlyInSheet.push({ ...r, alreadyRuledOut: ruledKeys.has(s) || ruledKeys.has(n) })
    continue
  }
  matchedIds.add(lead.id)
  report.matched.push({ row: r.row, company: r.company, leadId: lead.id })
  if (r.status && r.status !== lead.status) {
    report.statusDiffers.push({ row: r.row, company: r.company, sheet: r.status, app: lead.status, appOwner: lead.owner, sheetBy: r.by })
  }
}
for (const l of leads) if (!matchedIds.has(l.id)) report.onlyInApp.push({ company: l.company, status: l.status, batch: l.batch, deleted: Boolean(l.deleted_at) })

const line = (s) => console.log(s)
line(`Contact Log rows: ${report.sheetRows}    CRM leads: ${report.appLeads}    matched: ${report.matched.length}\n`)

line(`In the Contact Log but not in the CRM (${report.onlyInSheet.length}):`)
line('  These are not on the CRM exclusion list unless already ruled out. Clients and Dead/No fit')
line('  rows here are the ones most worth adding to Ruled out so no batch rediscovers them.')
for (const r of report.onlyInSheet) line(`  row ${r.row}  ${r.company}  [${r.type || '?'} · ${r.status || '?'}]${r.alreadyRuledOut ? '  (already ruled out)' : ''}`)

line(`\nStatus differs (${report.statusDiffers.length}):`)
for (const d of report.statusDiffers) line(`  row ${d.row}  ${d.company}: sheet "${d.sheet}" vs CRM "${d.app}"`)

line(`\nIn the CRM but not in the Contact Log (${report.onlyInApp.length}):`)
for (const l of report.onlyInApp) line(`  ${l.company}  [${l.status}, ${l.batch}]${l.deleted ? ' (deleted)' : ''}`)

if (report.unmatchable.length) {
  line(`\nRows with no company key to match on (${report.unmatchable.length}):`)
  for (const r of report.unmatchable) line(`  row ${r.row}`)
}

if (outIdx !== -1 && process.argv[outIdx + 1]) {
  writeFileSync(process.argv[outIdx + 1], JSON.stringify(report, null, 1))
  line(`\nWrote ${process.argv[outIdx + 1]}`)
}
line('\nNothing was changed in either place.')
