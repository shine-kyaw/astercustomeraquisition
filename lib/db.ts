import { neon, types } from '@neondatabase/serverless'
import { SCHEMA_STATEMENTS, SEED_LEADS, SEED_MARKER } from './schema'

// DATE columns come back as 'YYYY-MM-DD' text. Parsed into a JS Date they'd land at local
// midnight, and a due date could shift by a day depending on the server's time zone.
types.setTypeParser(1082, (v: string) => v)

/** The schema version this code needs. Bump it with each file in db/migrations. */
export const REQUIRED_SCHEMA = 1

function connectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add it in Vercel → Settings → Environment Variables, ' +
        'or in .env.local for local development.'
    )
  }
  return url
}

export type Statement = { text: string; params?: unknown[] }

type Driver = {
  query(text: string, params: unknown[]): Promise<Record<string, unknown>[]>
  transaction(statements: Statement[]): Promise<Record<string, unknown>[][]>
}

let cached: Promise<Driver> | null = null

/**
 * Neon over HTTP in production. `DATABASE_URL=pglite:<dir>` runs an in-process Postgres
 * instead, for local testing against a throwaway database — Neon's HTTP driver can't talk
 * to a local server. PGlite is a devDependency and is imported by a name webpack can't
 * see, so it is never bundled or traced into a Vercel function.
 */
function driver(): Promise<Driver> {
  if (cached) return cached
  const url = connectionString()

  if (url.startsWith('pglite:')) {
    cached = (async () => {
      const name = '@electric-sql/pglite'
      const { PGlite } = (await import(/* webpackIgnore: true */ name)) as {
        PGlite: new (dir: string) => {
          query(t: string, p: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
          transaction<T>(fn: (tx: { query(t: string, p: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }) => Promise<T>): Promise<T>
        }
      }
      // Hand back DATE columns as 'YYYY-MM-DD' text, the way the rest of the app reads them.
      const db = new (PGlite as unknown as new (d: string, o: unknown) => InstanceType<typeof PGlite>)(
        url.slice('pglite:'.length),
        { parsers: { 1082: (v: string) => v } }
      )
      return {
        query: async (text, params) => (await db.query(text, params)).rows,
        transaction: (statements) =>
          db.transaction(async (tx) => {
            const out: Record<string, unknown>[][] = []
            for (const s of statements) out.push((await tx.query(s.text, s.params ?? [])).rows)
            return out
          }),
      }
    })()
    return cached
  }

  const sql = neon(url)
  cached = Promise.resolve({
    query: async (text, params) => (await sql.query(text, params)) as Record<string, unknown>[],
    transaction: async (statements) =>
      (await sql.transaction(statements.map((s) => sql.query(s.text, s.params ?? [])))) as Record<string, unknown>[][],
  })
  return cached
}

/**
 * First-run bootstrap of the base tables.
 *
 * Creating the tables by hand means finding a SQL console, which depends on where the
 * database was provisioned — neon.tech and Vercel's storage tab put it in different places,
 * and that turned into a real dead end during setup. Since every statement is idempotent,
 * it is simpler and more reliable for the app to guarantee its own base schema on first use.
 *
 * Migrations are a different matter. They change a database that holds real work, so they
 * never run on their own — a preview deploy sharing the production DATABASE_URL would
 * otherwise migrate production the first time someone opened it. Instead this checks the
 * applied version and refuses to serve until `npm run db:migrate` has been run.
 *
 * Runs once per process (serverless cold start), not once per request.
 */
let bootstrapped: Promise<void> | null = null

async function bootstrap(): Promise<void> {
  const db = await driver()

  for (const statement of SCHEMA_STATEMENTS) {
    await db.query(statement, [])
  }

  // Seed Batch 001 exactly once. Keyed off a marker row rather than "is the table empty",
  // so that leads someone deliberately deleted don't reappear on the next cold start.
  const [marker] = (await db.query(
    'select count(*)::int as n from activity where action like $1',
    [`${SEED_MARKER}%`]
  )) as { n: number }[]

  if (marker?.n === 0 && SEED_LEADS.length) {
    const columns = Object.keys(SEED_LEADS[0])
    for (const lead of SEED_LEADS) {
      const placeholders = columns.map((_, i) => `$${i + 1}`)
      await db.query(
        `insert into leads (id, ${columns.join(', ')}, created_by, updated_by)
         values (gen_random_uuid()::text, ${placeholders.join(', ')}, 'Claude', 'Claude')`,
        columns.map((c) => lead[c])
      )
    }
    await db.query('insert into activity (who, action) values ($1, $2)', [
      'Claude',
      `${SEED_MARKER} — ${SEED_LEADS.length} leads`,
    ])
  }

  // Before migration 001 the table doesn't exist at all; that reads as version 0.
  const [row] = (await db
    .query('select coalesce(max(version), 0)::int as v from schema_migrations', [])
    .catch(() => [])) as { v: number }[]
  const applied = row?.v ?? 0
  if (applied < REQUIRED_SCHEMA) {
    const err = new Error(
      `The database is at schema version ${applied}; this version of the app needs ${REQUIRED_SCHEMA}. ` +
        'Run `npm run db:migrate` against this database (see DEPLOY.md).'
    ) as Error & { status?: number }
    err.status = 503
    throw err
  }
}

function ready(): Promise<void> {
  if (!bootstrapped) {
    bootstrapped = bootstrap().catch((e) => {
      // Don't cache a failure — a transient connection error on cold start would
      // otherwise poison every later request in this process.
      bootstrapped = null
      throw e
    })
  }
  return bootstrapped
}

/**
 * Run a parameterized query. Values are always sent as bind parameters ($1, $2, …),
 * never interpolated into the SQL string — that is what keeps this safe when the
 * caller is assembling a dynamic column list.
 */
export async function q<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  await ready()
  return (await (await driver()).query(text, params)) as T[]
}

export async function one<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await q<T>(text, params)
  return rows.length ? rows[0] : null
}

/**
 * Several writes that must land together or not at all — an event, the stage change it
 * causes and the tasks it schedules. Non-interactive: every statement is decided before
 * the transaction starts, which is what Neon's HTTP driver supports.
 */
export async function tx(statements: Statement[]): Promise<Record<string, unknown>[][]> {
  if (!statements.length) return []
  await ready()
  return (await driver()).transaction(statements)
}
