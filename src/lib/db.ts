import { Pool, types } from 'pg'

// DATE (oid 1082) must stay a plain 'YYYY-MM-DD' string. Left alone,
// node-postgres builds a Date at *local* midnight, and any later
// toISOString() shifts the day for anyone not on UTC — an edit in
// Addis Ababa (UTC+3) turned 2027-05-01 into 2027-04-30.
types.setTypeParser(1082, (v) => v)

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined
}

function makePool() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    // Supabase transaction pooler + serverless: keep it to a single connection.
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  })
}

export const pool: Pool = global.__pgPool ?? makePool()
if (process.env.NODE_ENV !== 'production') global.__pgPool = pool

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(text, params)
  return res.rows as T[]
}

export async function q1<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const rows = await q<T>(text, params)
  return rows[0] ?? null
}
