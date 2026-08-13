import { neon } from '@neondatabase/serverless'

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
 * Run a parameterized query. Values are always sent as bind parameters ($1, $2, …),
 * never interpolated into the SQL string — that is what keeps this safe when the
 * caller is assembling a dynamic column list.
 */
export async function q<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const sql = client()
  const rows = await sql.query(text, params)
  return rows as T[]
}

export async function one<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await q<T>(text, params)
  return rows.length ? rows[0] : null
}
