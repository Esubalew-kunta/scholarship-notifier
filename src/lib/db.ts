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

/**
 * Created on first query, never at import time — the build imports these
 * modules without runtime env vars, and a missing DATABASE_URL should fail
 * the request, not the build.
 */
export function getPool(): Pool {
  if (global.__pgPool) return global.__pgPool

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    // Supabase transaction pooler + serverless: one connection per instance.
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  })
  global.__pgPool = pool
  return pool
}

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const res = await getPool().query(text, params)
  return res.rows as T[]
}

export async function q1<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const rows = await q<T>(text, params)
  return rows[0] ?? null
}
