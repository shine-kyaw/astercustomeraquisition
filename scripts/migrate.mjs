// Apply pending migrations from db/migrations, in order.
//
//   node --env-file=.env.local scripts/migrate.mjs            show what would run, change nothing
//   node --env-file=.env.local scripts/migrate.mjs --apply    back up, then apply
//
// Each migration runs as one transaction: it lands completely or not at all. A backup of
// every table is written to ./backups first, and row counts are compared afterwards — a
// migration here only ever adds, so any table that lost rows stops the report cold.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { connect, splitStatements } from './dbclient.mjs'
import { backup } from './backup.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, '..', 'db', 'migrations')
const apply = process.argv.includes('--apply')

const db = await connect()
console.log(`Database: ${db.label}\n`)

const applied = new Set(
  (await db.query('select version from schema_migrations').catch(() => [])).map((r) => Number(r.version))
)

const pending = readdirSync(dir)
  .filter((f) => /^\d{3}_.+\.sql$/.test(f))
  .sort()
  .map((f) => ({ version: Number(f.slice(0, 3)), name: f.replace(/\.sql$/, ''), file: join(dir, f) }))
  .filter((m) => !applied.has(m.version))

if (!pending.length) {
  console.log('Nothing to do: every migration is already applied.')
  await db.close()
  process.exit(0)
}

console.log('Pending:')
for (const m of pending) console.log(`  ${m.name}`)

if (!apply) {
  console.log('\nDry run. Nothing was changed. Re-run with --apply to back up and apply.')
  await db.close()
  process.exit(0)
}

const { file, counts: before } = await backup(db, join(here, '..', 'backups'))
console.log(`\nBackup written to ${file}`)

for (const m of pending) {
  const statements = splitStatements(readFileSync(m.file, 'utf8')).map((text) => ({ text }))
  statements.push({
    text: 'insert into schema_migrations (version, name, applied_by) values ($1, $2, $3)',
    params: [m.version, m.name, process.env.USERNAME || process.env.USER || 'script'],
  })
  process.stdout.write(`Applying ${m.name} (${statements.length} statements)… `)
  try {
    await db.transaction(statements)
    console.log('done')
  } catch (e) {
    console.log('FAILED')
    console.error(`\n${e.message}\n\nThe transaction was rolled back; the database is unchanged.`)
    await db.close()
    process.exit(1)
  }
}

// Verify: nothing that existed before has fewer rows now.
console.log('\nRow counts, before → after:')
let lost = false
for (const [t, n] of Object.entries(before)) {
  const [{ c }] = await db.query(`select count(*)::int as c from "${t.replace(/"/g, '""')}"`)
  const flag = c < n ? '   <-- FEWER ROWS' : ''
  if (c < n) lost = true
  console.log(`  ${t.padEnd(20)} ${n} → ${c}${flag}`)
}

const mismatched = await db.query(
  `select count(*)::int as c from leads where deleted_at is null and (
     (status = 'Not sent' and stage <> 'new') or
     (status in ('Won') and stage <> 'won') or
     (status in ('No fit', 'Dead') and stage <> 'lost'))`
).catch(() => [{ c: 'n/a' }])
console.log(`\nLeads whose stage disagrees with their status: ${mismatched[0].c}`)

await db.close()
if (lost) {
  console.error('\nA table has fewer rows than before. Restore from the backup above and investigate.')
  process.exit(1)
}
console.log('\nMigration complete.')
