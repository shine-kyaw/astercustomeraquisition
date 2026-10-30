// Shared by the database scripts: one tiny interface over Neon (production) or PGlite
// (DATABASE_URL=pglite:<dir>, a throwaway local database for testing).
import { neon } from '@neondatabase/serverless'

export async function connect() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set. Put it in .env.local and run with --env-file=.env.local.')
    process.exit(1)
  }

  if (url.startsWith('pglite:')) {
    const { PGlite } = await import('@electric-sql/pglite')
    const db = new PGlite(url.slice('pglite:'.length))
    return {
      label: `local PGlite at ${url.slice('pglite:'.length)}`,
      query: async (text, params = []) => (await db.query(text, params)).rows,
      transaction: (statements) =>
        db.transaction(async (t) => {
          for (const s of statements) await t.query(s.text, s.params ?? [])
        }),
      close: () => db.close(),
    }
  }

  const sql = neon(url)
  const host = (() => { try { return new URL(url).host } catch { return 'unknown host' } })()
  return {
    label: `Neon at ${host}`,
    query: (text, params = []) => sql.query(text, params),
    transaction: (statements) => sql.transaction(statements.map((s) => sql.query(s.text, s.params ?? []))),
    close: async () => {},
  }
}

/** Split a migration file on semicolons that end a line. Comment-only chunks are dropped. */
export function splitStatements(text) {
  return text
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
}
