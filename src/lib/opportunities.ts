import { q } from './db'
import type { OpportunityRow } from './types'

const KINDS = ['admission', 'scholarship']
const LEVELS = ['bachelor', 'master', 'phd', 'any']
const FUNDINGS = ['full', 'partial', 'unknown']

const SORTS: Record<string, string> = {
  urgency: `coalesce(o.closes_on, o.opens_on, '2999-12-31') asc, o.created_at desc`,
  closes: `o.closes_on asc nulls last`,
  opens: `o.opens_on asc nulls last`,
  newest: `o.created_at desc`,
  title: `o.title asc`,
  country: `o.country asc nulls last, o.title asc`,
}

export interface ListParams {
  q?: string | null
  kind?: string | null
  country?: string | null
  degree_level?: string | null
  funding?: string | null
  /** upcoming | open | closing | closed | undated */
  timing?: string | null
  /** linked | orphan | any — scholarships with/without a parent admission */
  link?: string | null
  archived?: string | null
  sort?: string | null
  limit?: number
}

/**
 * One query used by both the public browse page and the admin dashboard.
 * Every filter is optional and applied only when present.
 */
export async function listOpportunities(p: ListParams): Promise<OpportunityRow[]> {
  const where: string[] = []
  const args: any[] = []
  const add = (v: any) => { args.push(v); return '$' + args.length }

  // archived: 'true' = only archived, 'all' = both, anything else = only live
  if (p.archived === 'true') where.push('o.is_archived = true')
  else if (p.archived !== 'all') where.push('o.is_archived = false')

  if (p.q && p.q.trim()) {
    const n = add('%' + p.q.trim() + '%')
    where.push(
      `(o.title ilike ${n} or o.org ilike ${n} or o.country ilike ${n} or o.notes ilike ${n})`,
    )
  }
  if (p.kind && KINDS.includes(p.kind)) where.push(`o.kind = ${add(p.kind)}`)
  if (p.country) where.push(`o.country = ${add(p.country)}`)
  if (p.degree_level && LEVELS.includes(p.degree_level)) {
    where.push(`o.degree_level = ${add(p.degree_level)}`)
  }
  if (p.funding && FUNDINGS.includes(p.funding)) where.push(`o.funding = ${add(p.funding)}`)

  switch (p.timing) {
    case 'upcoming':
      where.push(`o.opens_on is not null and o.opens_on > current_date`)
      break
    case 'open':
      where.push(
        `(o.opens_on is null or o.opens_on <= current_date)
         and (o.closes_on is null or o.closes_on >= current_date)`,
      )
      break
    case 'closing':
      where.push(
        `o.closes_on is not null
         and o.closes_on >= current_date
         and o.closes_on <= current_date + 30`,
      )
      break
    case 'closed':
      where.push(`o.closes_on is not null and o.closes_on < current_date`)
      break
    case 'undated':
      where.push(`o.opens_on is null and o.closes_on is null`)
      break
  }

  if (p.link === 'linked') where.push(`o.parent_id is not null`)
  if (p.link === 'orphan') where.push(`o.kind = 'scholarship' and o.parent_id is null`)

  const sort = SORTS[p.sort ?? ''] ?? SORTS.urgency
  const limit = Math.min(Math.max(p.limit ?? 500, 1), 1000)

  return q<OpportunityRow>(
    `select o.id, o.kind, o.title, o.country, o.org, o.url,
            to_char(o.opens_on,  'YYYY-MM-DD') as opens_on,
            to_char(o.closes_on, 'YYYY-MM-DD') as closes_on,
            o.parent_id, o.degree_level, o.funding, o.notes, o.added_by,
            o.is_archived, o.created_at, o.updated_at,
            p.title as parent_title,
            to_char(p.closes_on, 'YYYY-MM-DD') as parent_closes_on,
            (select count(*) from opportunities c
              where c.parent_id = o.id and c.is_archived = false)::int as child_count
       from opportunities o
       left join opportunities p on p.id = o.parent_id
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by ${sort}
      limit ${limit}`,
    args,
  )
}

export interface OppInput {
  kind?: unknown
  title?: unknown
  country?: unknown
  org?: unknown
  url?: unknown
  opens_on?: unknown
  closes_on?: unknown
  parent_id?: unknown
  degree_level?: unknown
  funding?: unknown
  notes?: unknown
  added_by?: unknown
  is_archived?: unknown
}

export interface Clean {
  kind: string
  title: string
  country: string | null
  org: string | null
  url: string | null
  opens_on: string | null
  closes_on: string | null
  parent_id: string | null
  degree_level: string | null
  funding: string | null
  notes: string | null
  added_by: string | null
  is_archived: boolean
}

const str = (v: unknown, max = 500): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

const date = (v: unknown): string | null => {
  const s = str(v, 10)
  if (!s) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) ? s : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Returns either a validation error or a fully normalised record. */
export function validateOpportunity(
  body: OppInput,
  { partial = false } = {},
): { error: string } | { value: Clean } {
  const title = str(body.title, 200)
  const kind = str(body.kind, 20)

  if (!partial || body.title !== undefined) {
    if (!title) return { error: 'Title is required.' }
  }
  if (!partial || body.kind !== undefined) {
    if (!kind || !KINDS.includes(kind)) {
      return { error: 'Type must be "admission" or "scholarship".' }
    }
  }

  let url = str(body.url, 1000)
  if (url) {
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    try {
      new URL(url)
    } catch {
      return { error: 'That link does not look like a valid URL.' }
    }
  }

  const opens_on = date(body.opens_on)
  const closes_on = date(body.closes_on)
  if (opens_on && closes_on && closes_on < opens_on) {
    return { error: 'The closing date cannot be before the opening date.' }
  }

  const degree_level = str(body.degree_level, 20)
  if (degree_level && !LEVELS.includes(degree_level)) return { error: 'Invalid degree level.' }

  const funding = str(body.funding, 20)
  if (funding && !FUNDINGS.includes(funding)) return { error: 'Invalid funding value.' }

  let parent_id = str(body.parent_id, 40)
  if (parent_id && !UUID.test(parent_id)) parent_id = null
  if (parent_id && kind === 'admission') {
    return { error: 'Only a scholarship can be linked to an admission.' }
  }

  return {
    value: {
      kind: kind as string,
      title: title as string,
      country: str(body.country, 80),
      org: str(body.org, 160),
      url,
      opens_on,
      closes_on,
      parent_id,
      degree_level,
      funding,
      notes: str(body.notes, 2000),
      added_by: str(body.added_by, 80),
      is_archived: body.is_archived === true,
    },
  }
}
