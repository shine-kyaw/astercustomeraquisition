// Copy every table to a local JSON file before anything changes the database.
//   node --env-file=.env.local scripts/backup.mjs [out-dir]
//
// This is a belt to Neon's braces: Neon keeps point-in-time history too, but a file on
// your own disk can be read without logging in to anything, and diffed after a migration.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect } from './dbclient.mjs'

export async function backup(db, outDir = 'backups') {
  const tables = (await db.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`
  )).map((r) => r.table_name)

  const dump = { takenAt: new Date().toISOString(), source: db.label, tables: {} }
  for (const t of tables) {
    // Table names come from the catalogue, not from input, and are quoted.
    dump.tables[t] = await db.query(`select * from "${t.replace(/"/g, '""')}"`)
  }

  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, `backup-${dump.takenAt.replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify(dump, null, 1))
  const counts = Object.fromEntries(Object.entries(dump.tables).map(([k, v]) => [k, v.length]))
  return { file, counts }
}

// Run directly (not imported by migrate.mjs).
if (/[\\/]scripts[\\/]backup\.mjs$/.test(process.argv[1] ?? '')) {
  const db = await connect()
  const { file, counts } = await backup(db, process.argv[2] || 'backups')
  console.log(`Backed up ${db.label}`)
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(20)} ${n} row(s)`)
  console.log(`Written to ${file}`)
  await db.close()
}
