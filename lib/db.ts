import { neon } from '@neondatabase/serverless'
import { SCHEMA_STATEMENTS, SEED_LEADS, SEED_MARKER } from './schema'

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

let cached: ReturnType<typeof neon> | null = null

function client() {
  if (!cached) cached = neon(connectionString())
  return cached
}

/**
 * First-run bootstrap.
 *
 * Creating the tables by hand means finding a SQL console, which depends on where the
 * database was provisioned — neon.tech and Vercel's storage tab put it in different places,
 * and that turned into a real dead end during setup. Since every statement is idempotent,
 * it is simpler and more reliable for the app to guarantee its own schema on first use.
 *
 * Runs once per process (serverless cold start), not once per request.
 */
let bootstrapped: Promise<void> | null = null

async function bootstrap(): Promise<void> {
  const sql = client()

  for (const statement of SCHEMA_STATEMENTS) {
    await sql.query(statement)
  }

  // Seed Batch 001 exactly once. Keyed off a marker row rather than "is the table empty",
  // so that leads someone deliberately deleted don't reappear on the next cold start.
  const [marker] = (await sql.query(
    'select count(*)::int as n from activity where action like $1',
    [`${SEED_MARKER}%`]
  )) as { n: number }[]

  if (marker?.n === 0 && SEED_LEADS.length) {
    const columns = Object.keys(SEED_LEADS[0])
    for (const lead of SEED_LEADS) {
      const placeholders = columns.map((_, i) => `$${i + 1}`)
      await sql.query(
        `insert into leads (id, ${columns.join(', ')}, created_by, updated_by)
         values (gen_random_uuid()::text, ${placeholders.join(', ')}, 'Claude', 'Claude')`,
        columns.map((c) => lead[c])
      )
    }
    await sql.query('insert into activity (who, action) values ($1, $2)', [
      'Claude',
      `${SEED_MARKER} — ${SEED_LEADS.length} leads`,
    ])
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
  const rows = await client().query(text, params)
  return rows as T[]
}

export async function one<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await q<T>(text, params)
  return rows.length ? rows[0] : null
}
