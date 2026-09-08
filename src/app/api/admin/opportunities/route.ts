import { NextResponse } from 'next/server'
import { tx } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'
import { listLinkOptions, listOpportunities, replaceLinks, validateOpportunity } from '@/lib/opportunities'

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
      timing: s.get('timing'),
      archived: s.get('archived') ?? 'all',
      sort: s.get('sort'),
      limit: 1000,
    })

    const options = await listLinkOptions(true)

    return NextResponse.json({
      opportunities: rows,
      admissions: options.filter((o) => o.kind === 'admission'),
      scholarships: options.filter((o) => o.kind === 'scholarship'),
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
    const id = await tx(async (c) => {
      const ins = await c.query<{ id: string }>(
        `insert into opportunities
           (kind, title, country, org, url, opens_on, closes_on, degree_level, funding,
            application_fee, fee_currency, notes, added_by, is_archived)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         returning id`,
        [
          v.kind, v.title, v.country, v.org, v.url, v.opens_on, v.closes_on,
          v.degree_level, v.funding, v.application_fee, v.fee_currency,
          v.notes, v.added_by, v.is_archived,
        ],
      )
      const newId = ins.rows[0].id
      const linked = await replaceLinks(c, newId, v.kind, v.links)
      if ('error' in linked) throw Object.assign(new Error(linked.error), { userMessage: linked.error })
      return newId
    })
    return NextResponse.json({ id }, { status: 201 })
  } catch (e: any) {
    console.error('POST /api/admin/opportunities', e)
    if (e?.userMessage) return NextResponse.json({ error: e.userMessage }, { status: 400 })
    return NextResponse.json({ error: 'Could not create.' }, { status: 500 })
  }
}
