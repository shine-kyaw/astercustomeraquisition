// Send a researched batch to the live lead engine.
//
//   node --env-file=.env.local scripts/push-batch.mjs batch-002.json
//
// The token is read from .env.local and never printed, so it does not end up in a
// terminal transcript or a chat log. Claude writes the JSON file; you run this.
//
// The JSON file may be either a bare array of leads, or an object:
//   { "batch": "Batch 002", "addedBy": "Victor Huang", "leads": [ ... ] }
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const file = process.argv[2]
if (!file) {
  console.error('Usage: node --env-file=.env.local scripts/push-batch.mjs <batch-file.json>')
  process.exit(1)
}

const APP_URL = process.env.APP_URL || 'https://astercustomeraquisition.vercel.app'
const TOKEN = process.env.INGEST_TOKEN

if (!TOKEN) {
  console.error('INGEST_TOKEN is not set. Add it to .env.local:')
  console.error('  INGEST_TOKEN="…the value from Vercel…"')
  process.exit(1)
}

let parsed
try {
  parsed = JSON.parse(readFileSync(file, 'utf8'))
} catch (e) {
  console.error(`Could not read ${file}: ${e.message}`)
  process.exit(1)
}

const payload = Array.isArray(parsed) ? { leads: parsed } : parsed
if (!Array.isArray(payload.leads) || !payload.leads.length) {
  console.error('No leads found. Expected an array, or { "leads": [ ... ] }.')
  process.exit(1)
}

// Default the batch name from the filename so nothing lands in "Unfiled" by accident.
if (!payload.batch) {
  payload.batch = basename(file, '.json').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

console.log(`Sending ${payload.leads.length} lead(s) to ${APP_URL}`)
console.log(`Batch: ${payload.batch}`)
console.log(`Added by: ${payload.addedBy || 'Claude'}\n`)

const res = await fetch(`${APP_URL}/api/leads/batch`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify(payload),
})

let data
try {
  data = await res.json()
} catch {
  console.error(`HTTP ${res.status} — the server did not return JSON.`)
  process.exit(1)
}

if (res.status === 401) {
  console.error('Rejected: the ingest token is wrong. Check INGEST_TOKEN matches Vercel.')
  process.exit(1)
}
if (!res.ok && res.status !== 207) {
  console.error(`HTTP ${res.status}: ${data.error || 'unknown error'}`)
  if (data.errors) data.errors.forEach((e) => console.error(`  - ${e}`))
  process.exit(1)
}

console.log(`Added:      ${data.created}`)

if (data.duplicates?.length) {
  console.log(`Skipped:    ${data.duplicates.length} already in the system`)
  for (const d of data.duplicates) {
    const where = d.batch ? ` — already in ${d.batch}, status "${d.status}"` : ''
    console.log(`  · ${d.company}${where || ` (${d.existing})`}`)
  }
}

if (data.rejected?.length) {
  console.log(`Rejected:   ${data.rejected.length}`)
  for (const r of data.rejected) {
    console.log(`  · index ${r.index}${r.company ? ` (${r.company})` : ''}: ${r.reason}`)
  }
}

console.log(`\nOpen ${APP_URL} to work the list.`)
