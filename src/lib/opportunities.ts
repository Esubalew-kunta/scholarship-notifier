import { q } from './db'
import type { PoolClient } from 'pg'
import type { LinkOption, OpportunityRow } from './types'

const KINDS = ['admission', 'scholarship']
const LEVELS = ['bachelor', 'master', 'phd', 'any']
const FUNDINGS = ['full', 'partial', 'unknown']
const CURRENCIES = ['EUR', 'USD']

const SORTS: Record<string, string> = {
  urgency: `coalesce(o.closes_on, o.opens_on, '2999-12-31') asc, o.created_at desc`,
  closes: `o.closes_on asc nulls last`,
  opens: `o.opens_on asc nulls last`,
  newest: `o.created_at desc`,
  title: `o.title asc`,
}

/**
 * Both ends of the many-to-many, as one json array per row. A scholarship gets
 * its admissions, an admission gets the scholarships it unlocks — the same
 * shape either way, so callers never branch on kind to read a link.
 */
const LINKS_JSON = `
  coalesce((
    select json_agg(json_build_object(
             'id', x.id, 'title', x.title, 'country', x.country, 'url', x.url,
             'opens_on',  to_char(x.opens_on,  'YYYY-MM-DD'),
             'closes_on', to_char(x.closes_on, 'YYYY-MM-DD'))
             order by x.closes_on asc nulls last, x.title asc)
      from opportunity_links l
      join opportunities x
        on x.id = case when o.kind = 'scholarship' then l.admission_id
                       else l.scholarship_id end
     where (o.kind = 'scholarship' and l.scholarship_id = o.id)
        or (o.kind = 'admission'   and l.admission_id   = o.id)
  ), '[]'::json) as links`

export interface ListParams {
  q?: string | null
  kind?: string | null
  /** upcoming | open | closing | closed */
  timing?: string | null
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
  }

  const sort = SORTS[p.sort ?? ''] ?? SORTS.urgency
  const limit = Math.min(Math.max(p.limit ?? 500, 1), 1000)

  return q<OpportunityRow>(
    `select o.id, o.kind, o.title, o.country, o.org, o.url,
            to_char(o.opens_on,  'YYYY-MM-DD') as opens_on,
            to_char(o.closes_on, 'YYYY-MM-DD') as closes_on,
            o.parent_id, o.degree_level, o.funding,
            o.application_fee::float8 as application_fee, o.fee_currency,
            o.notes, o.added_by, o.is_archived, o.created_at, o.updated_at,
            ${LINKS_JSON}
       from opportunities o
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by ${sort}
      limit ${limit}`,
    args,
  )
}

/** Everything that can sit on the other end of a link, for the pickers. */
export async function listLinkOptions(includeArchived = false): Promise<LinkOption[]> {
  return q<LinkOption>(
    `select id, kind, title, country,
            to_char(closes_on, 'YYYY-MM-DD') as closes_on
       from opportunities
      ${includeArchived ? '' : 'where is_archived = false'}
      order by kind asc, title asc`,
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
  degree_level?: unknown
  funding?: unknown
  application_fee?: unknown
  fee_currency?: unknown
  notes?: unknown
  added_by?: unknown
  is_archived?: unknown
  links?: unknown
}

export interface Clean {
  kind: string
  title: string
  country: string | null
  org: string | null
  url: string | null
  opens_on: string | null
  closes_on: string | null
  degree_level: string | null
  funding: string | null
  application_fee: number | null
  fee_currency: string | null
  notes: string | null
  added_by: string | null
  is_archived: boolean
  /** ids of the entries on the other side of the link, already de-duplicated */
  links: string[]
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
export function validateOpportunity(body: OppInput): { error: string } | { value: Clean } {
  const title = str(body.title, 200)
  const kind = str(body.kind, 20)

  if (!title) return { error: 'Title is required.' }
  if (!kind || !KINDS.includes(kind)) {
    return { error: 'Type must be "admission" or "scholarship".' }
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

  // Fee: an empty string means "not recorded", which is not the same as free.
  let application_fee: number | null = null
  if (body.application_fee !== null && body.application_fee !== undefined && body.application_fee !== '') {
    const n = Number(body.application_fee)
    if (!Number.isFinite(n)) return { error: 'The application fee must be a number.' }
    if (n < 0) return { error: 'The application fee cannot be negative.' }
    if (n > 99_999_999) return { error: 'That application fee is implausibly large.' }
    application_fee = Math.round(n * 100) / 100
  }

  let fee_currency = str(body.fee_currency, 3)
  if (fee_currency) fee_currency = fee_currency.toUpperCase()
  if (fee_currency && !CURRENCIES.includes(fee_currency)) {
    return { error: 'Currency must be EUR or USD.' }
  }
  // A bare number is meaningless without a unit; default rather than reject.
  if (application_fee !== null && application_fee > 0 && !fee_currency) fee_currency = 'EUR'
  if (application_fee === null) fee_currency = null

  const links: string[] = []
  if (body.links !== undefined && body.links !== null) {
    if (!Array.isArray(body.links)) return { error: 'Links must be a list of ids.' }
    if (body.links.length > 100) return { error: 'That is too many links for one entry.' }
    for (const raw of body.links) {
      const id = str(raw, 40)
      if (!id || !UUID.test(id)) return { error: 'One of the linked entries is not valid.' }
      if (!links.includes(id)) links.push(id)
    }
  }

  return {
    value: {
      kind,
      title,
      country: str(body.country, 80),
      org: str(body.org, 160),
      url,
      opens_on,
      closes_on,
      degree_level,
      funding,
      application_fee,
      fee_currency,
      notes: str(body.notes, 2000),
      added_by: str(body.added_by, 80),
      is_archived: body.is_archived === true,
      links,
    },
  }
}

/**
 * Replace an entry's links with exactly `linkIds`.
 *
 * `kind` is this entry's own kind, so the ids belong to the opposite kind: an
 * admission links to scholarships, a scholarship links to admissions. Anything
 * of the wrong kind is rejected rather than quietly dropped — a silently
 * ignored link is a reminder that never arrives.
 */
export async function replaceLinks(
  c: PoolClient,
  id: string,
  kind: string,
  linkIds: string[],
): Promise<{ error: string } | { ok: true }> {
  if (linkIds.length) {
    const wanted = kind === 'admission' ? 'scholarship' : 'admission'
    const found = await c.query<{ id: string; kind: string }>(
      `select id, kind from opportunities where id = any($1::uuid[])`,
      [linkIds],
    )
    if (found.rows.length !== linkIds.length) {
      return { error: 'One of the entries you linked no longer exists.' }
    }
    if (found.rows.some((r) => r.kind !== wanted)) {
      return {
        error: kind === 'admission'
          ? 'An admission can only be linked to scholarships.'
          : 'A scholarship can only be linked to admissions.',
      }
    }
    if (linkIds.includes(id)) return { error: 'An entry cannot be linked to itself.' }
  }

  await c.query(
    `delete from opportunity_links
      where (admission_id = $1 or scholarship_id = $1)`,
    [id],
  )

  if (linkIds.length) {
    const [admissionCol, scholarshipCol] =
      kind === 'admission' ? ['$1', 'x'] : ['x', '$1']
    await c.query(
      `insert into opportunity_links (admission_id, scholarship_id)
       select ${admissionCol}, ${scholarshipCol}
         from unnest($2::uuid[]) as x
       on conflict do nothing`,
      [id, linkIds],
    )
  }
  return { ok: true }
}
