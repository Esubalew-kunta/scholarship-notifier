import { NextResponse } from 'next/server'
import { q, q1, tx } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'
import { replaceLinks, validateOpportunity } from '@/lib/opportunities'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const { id } = await ctx.params

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const existing = await q1<any>(`select * from opportunities where id = $1`, [id])
  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  // Merge over the current row so a partial edit never blanks untouched fields.
  const merged: any = {
    kind: body.kind ?? existing.kind,
    title: body.title ?? existing.title,
    country: body.country !== undefined ? body.country : existing.country,
    org: body.org !== undefined ? body.org : existing.org,
    url: body.url !== undefined ? body.url : existing.url,
    opens_on: body.opens_on !== undefined ? body.opens_on : existing.opens_on,
    closes_on: body.closes_on !== undefined ? body.closes_on : existing.closes_on,
    degree_level: body.degree_level !== undefined ? body.degree_level : existing.degree_level,
    funding: body.funding !== undefined ? body.funding : existing.funding,
    application_fee:
      body.application_fee !== undefined ? body.application_fee : existing.application_fee,
    fee_currency: body.fee_currency !== undefined ? body.fee_currency : existing.fee_currency,
    notes: body.notes !== undefined ? body.notes : existing.notes,
    added_by: body.added_by !== undefined ? body.added_by : existing.added_by,
    is_archived: body.is_archived !== undefined ? body.is_archived : existing.is_archived,
    links: body.links,
  }

  // Dates arriving from the DB are Date objects; normalise before validating.
  for (const k of ['opens_on', 'closes_on'] as const) {
    if (merged[k] instanceof Date) merged[k] = merged[k].toISOString().slice(0, 10)
  }
  // pg hands back `numeric` as a string.
  if (merged.application_fee !== null && merged.application_fee !== undefined) {
    merged.application_fee = Number(merged.application_fee)
  }

  const checked = validateOpportunity(merged)
  if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 })
  const v = checked.value

  // Flipping the kind invalidates every existing link, whichever side it is on.
  const kindChanged = v.kind !== existing.kind
  const rewriteLinks = body.links !== undefined || kindChanged

  try {
    await tx(async (c) => {
      await c.query(
        `update opportunities set
           kind=$2, title=$3, country=$4, org=$5, url=$6, opens_on=$7, closes_on=$8,
           degree_level=$9, funding=$10, application_fee=$11, fee_currency=$12,
           notes=$13, added_by=$14, is_archived=$15,
           parent_id = case when $2 = 'admission' then null else parent_id end
         where id=$1`,
        [
          id, v.kind, v.title, v.country, v.org, v.url, v.opens_on, v.closes_on,
          v.degree_level, v.funding, v.application_fee, v.fee_currency,
          v.notes, v.added_by, v.is_archived,
        ],
      )
      if (rewriteLinks) {
        const linked = await replaceLinks(c, id, v.kind, body.links === undefined ? [] : v.links)
        if ('error' in linked) {
          throw Object.assign(new Error(linked.error), { userMessage: linked.error })
        }
      }
    })
    return NextResponse.json({ ok: true, links_cleared: kindChanged && body.links === undefined })
  } catch (e: any) {
    console.error('PATCH /api/admin/opportunities/[id]', e)
    if (e?.userMessage) return NextResponse.json({ error: e.userMessage }, { status: 400 })
    return NextResponse.json({ error: 'Could not update.' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const { id } = await ctx.params
  try {
    const links = await q1<{ n: number }>(
      `select count(*)::int as n from opportunity_links
        where admission_id = $1 or scholarship_id = $1`,
      [id],
    )
    await q(`delete from opportunities where id = $1`, [id])
    return NextResponse.json({ ok: true, unlinked: links?.n ?? 0 })
  } catch (e) {
    console.error('DELETE /api/admin/opportunities/[id]', e)
    return NextResponse.json({ error: 'Could not delete.' }, { status: 500 })
  }
}
