import { NextResponse } from 'next/server'
import { q, q1, tx } from '@/lib/db'
import { listLinkOptions, listOpportunities, replaceLinks, validateOpportunity } from '@/lib/opportunities'
import { broadcastNew } from '@/lib/reminders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Public browse + the link pickers that feed the form. */
export async function GET(req: Request) {
  const s = new URL(req.url).searchParams
  try {
    const rows = await listOpportunities({
      q: s.get('q'),
      kind: s.get('kind'),
      timing: s.get('timing'),
      sort: s.get('sort'),
    })

    const options = await listLinkOptions()

    return NextResponse.json({
      opportunities: rows,
      admissions: options.filter((o) => o.kind === 'admission'),
      scholarships: options.filter((o) => o.kind === 'scholarship'),
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

    const created = await tx(async (c) => {
      const ins = await c.query<{ id: string }>(
        `insert into opportunities
           (kind, title, country, org, url, opens_on, closes_on,
            degree_level, funding, application_fee, fee_currency, notes, added_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         returning id`,
        [
          v.kind, v.title, v.country, v.org, v.url, v.opens_on, v.closes_on,
          v.degree_level, v.funding, v.application_fee, v.fee_currency, v.notes, v.added_by,
        ],
      )
      const id = ins.rows[0].id
      const linked = await replaceLinks(c, id, v.kind, v.links)
      if ('error' in linked) throw Object.assign(new Error(linked.error), { userMessage: linked.error })
      return id
    })

    // Best effort — a Telegram outage must not fail the submission.
    let notified = 0
    try {
      notified = await broadcastNew(created)
    } catch (e) {
      console.error('broadcastNew failed', e)
    }

    return NextResponse.json({ id: created, notified }, { status: 201 })
  } catch (e: any) {
    console.error('POST /api/opportunities', e)
    if (e?.userMessage) return NextResponse.json({ error: e.userMessage }, { status: 400 })
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  }
}
