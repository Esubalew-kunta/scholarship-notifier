import { NextResponse } from 'next/server'
import { q, q1 } from '@/lib/db'
import { listOpportunities, validateOpportunity } from '@/lib/opportunities'
import { broadcastNew } from '@/lib/reminders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Public browse + the admission dropdown that feeds the form. */
export async function GET(req: Request) {
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
      sort: s.get('sort'),
    })

    const admissions = await q(
      `select id, title, country,
              to_char(closes_on, 'YYYY-MM-DD') as closes_on
         from opportunities
        where kind = 'admission' and is_archived = false
        order by title asc`,
    )
    const countries = await q<{ country: string }>(
      `select distinct country from opportunities
        where country is not null and is_archived = false
        order by country`,
    )

    return NextResponse.json({
      opportunities: rows,
      admissions,
      countries: countries.map((c) => c.country),
    })
  } catch (e: any) {
    console.error('GET /api/opportunities', e)
    return NextResponse.json({ error: 'Could not load opportunities.' }, { status: 500 })
  }
}

/** The open form — no auth, anyone with the link can contribute. */
export async function POST(req: Request) {
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
    if (v.parent_id) {
      const parent = await q1(`select id from opportunities where id = $1 and kind = 'admission'`, [
        v.parent_id,
      ])
      if (!parent) {
        return NextResponse.json({ error: 'The linked admission no longer exists.' }, { status: 400 })
      }
    }

    const dupe = await q1<{ id: string }>(
      `select id from opportunities
        where lower(title) = lower($1)
          and coalesce(country,'') = coalesce($2,'')
          and is_archived = false
        limit 1`,
      [v.title, v.country],
    )
    if (dupe) {
      return NextResponse.json(
        { error: 'Someone already added this one. Check the list below.' },
        { status: 409 },
      )
    }

    const row = await q1<{ id: string }>(
      `insert into opportunities
         (kind, title, country, org, url, opens_on, closes_on,
          parent_id, degree_level, funding, notes, added_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning id`,
      [
        v.kind, v.title, v.country, v.org, v.url, v.opens_on, v.closes_on,
        v.parent_id, v.degree_level, v.funding, v.notes, v.added_by,
      ],
    )

    // Best effort — a Telegram outage must not fail the submission.
    let notified = 0
    try {
      notified = await broadcastNew(row!.id)
    } catch (e) {
      console.error('broadcastNew failed', e)
    }

    return NextResponse.json({ id: row!.id, notified }, { status: 201 })
  } catch (e: any) {
    console.error('POST /api/opportunities', e)
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  }
}
