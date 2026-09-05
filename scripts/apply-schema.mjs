import pg from 'pg'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8')

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!url) { console.error('Set MIGRATION_DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
console.log('connected')
await client.query(sql)
console.log('schema applied')
const t = await client.query(`select table_name from information_schema.tables where table_schema='public' order by 1`)
console.log('tables:', t.rows.map(r => r.table_name).join(', '))
await client.end()
