// Load Batch 001 into an empty database.
//   node scripts/seed.mjs
//
// Refuses to run if leads already exist, so it can't quietly duplicate a batch
// or trample statuses someone has already set. Pass --force to override.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'

const here = dirname(fileURLToPath(import.meta.url))
const force = process.argv.includes('--force')

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)
const [{ count }] = await sql.query('select count(*)::int as count from leads')

if (count > 0 && !force) {
  console.log(`leads already holds ${count} row(s) — not seeding.`)
  console.log('Run with --force only if you are sure you want to add Batch 001 again.')
  process.exit(0)
}

const leads = JSON.parse(readFileSync(join(here, '..', 'db', 'batch-001.json'), 'utf8'))
const columns = Object.keys(leads[0])

for (const lead of leads) {
  const values = columns.map((c) => lead[c])
  const placeholders = columns.map((_, i) => `$${i + 2}`)
  await sql.query(
    `insert into leads (id, ${columns.join(', ')}, created_by, updated_by)
     values ($1, ${placeholders.join(', ')}, $${columns.length + 2}, $${columns.length + 3})`,
    [randomUUID(), ...values, 'Claude', 'Claude']
  )
}

await sql.query('insert into activity (who, action) values ($1, $2)', [
  'Claude',
  `seeded Batch 001 — ${leads.length} leads`,
])

console.log(`Seeded ${leads.length} leads.`)
