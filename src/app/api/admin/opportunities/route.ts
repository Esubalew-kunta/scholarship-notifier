import { NextResponse } from 'next/server'
import { q, q1 } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'
import { listOpportunities, validateOpportunity } from '@/lib/opportunities'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Admin list — same filters as the public one plus archived visibility. */
export async function GET(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const s = new URL(req.url).searchParams
  try {
    const rows = await listOpportunities({
      q: s.get('q'),
      kind: s.get('kind'),
      country: s.get('country'),
      degree_level: s.get('degree_level'),
      funding: s.get('funding'),
      timing: s.get('timing'),
      link: s.get('link'),
      archived: s.get('archived') ?? 'all',
      sort: s.get('sort'),
      limit: 1000,
    })

    const admissions = await q(
      `select id, title, country,
              to_char(closes_on, 'YYYY-MM-DD') as closes_on
         from opportunities
        where kind = 'admission'
        order by title asc`,
    )
    const countries = await q<{ country: string }>(
      `select distinct country from opportunities
        where country is not null order by country`,
    )

    return NextResponse.json({
      opportunities: rows,
      admissions,
      countries: countries.map((c) => c.country),
    })
  } catch (e) {
    console.error('GET /api/admin/opportunities', e)
    return NextResponse.json({ error: 'Could not load opportunities.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const checked = validateOpportunity(body)
  if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 })
  const v = checked.value

  try {
    const row = await q1<{ id: string }>(
      `insert into opportunities
         (kind, title, country, org, url, opens_on, closes_on,
          parent_id, degree_level, funding, notes, added_by, is_archived)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning id`,
      [
        v.kind, v.title, v.country, v.org, v.url, v.opens_on, v.closes_on,
        v.parent_id, v.degree_level, v.funding, v.notes, v.added_by, v.is_archived,
      ],
    )
    return NextResponse.json({ id: row!.id }, { status: 201 })
  } catch (e) {
    console.error('POST /api/admin/opportunities', e)
    return NextResponse.json({ error: 'Could not create.' }, { status: 500 })
  }
}
