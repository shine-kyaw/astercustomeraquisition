// Create the tables. Safe to run repeatedly.
//   node scripts/setup.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { neon } from '@neondatabase/serverless'

const here = dirname(fileURLToPath(import.meta.url))

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Put it in .env.local, or run with:')
  console.error('  DATABASE_URL="postgres://…" node scripts/setup.mjs')
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)
const schema = readFileSync(join(here, '..', 'db', 'schema.sql'), 'utf8')

// The http driver runs one statement per call, so split on the statement terminator.
const statements = schema
  .split(/;\s*$/m)
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith('--'))

for (const statement of statements) {
  await sql.query(statement)
}

const [{ count }] = await sql.query('select count(*)::int as count from leads')
console.log(`Schema ready. leads table currently holds ${count} row(s).`)
