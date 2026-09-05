import { NextResponse } from 'next/server'
import { q, q1 } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'
import { validateOpportunity } from '@/lib/opportunities'

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
  const merged = {
    kind: body.kind ?? existing.kind,
    title: body.title ?? existing.title,
    country: body.country !== undefined ? body.country : existing.country,
    org: body.org !== undefined ? body.org : existing.org,
    url: body.url !== undefined ? body.url : existing.url,
    opens_on: body.opens_on !== undefined ? body.opens_on : existing.opens_on,
    closes_on: body.closes_on !== undefined ? body.closes_on : existing.closes_on,
    parent_id: body.parent_id !== undefined ? body.parent_id : existing.parent_id,
    degree_level: body.degree_level !== undefined ? body.degree_level : existing.degree_level,
    funding: body.funding !== undefined ? body.funding : existing.funding,
    notes: body.notes !== undefined ? body.notes : existing.notes,
    added_by: body.added_by !== undefined ? body.added_by : existing.added_by,
    is_archived: body.is_archived !== undefined ? body.is_archived : existing.is_archived,
  }

  // Dates arriving from the DB are Date objects; normalise before validating.
  for (const k of ['opens_on', 'closes_on'] as const) {
    const v = (merged as any)[k]
    if (v instanceof Date) (merged as any)[k] = v.toISOString().slice(0, 10)
  }

  const checked = validateOpportunity(merged)
  if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 })
  const v = checked.value

  if (v.parent_id === id) {
    return NextResponse.json({ error: 'An entry cannot be its own admission.' }, { status: 400 })
  }
  if (v.parent_id) {
    const parent = await q1(
      `select id from opportunities where id = $1 and kind = 'admission'`,
      [v.parent_id],
    )
    if (!parent) return NextResponse.json({ error: 'Linked admission not found.' }, { status: 400 })
  }
  // Turning a scholarship that has children into an admission would orphan them.
  if (v.kind === 'admission' && existing.kind === 'scholarship') {
    // fine — but its own parent link must go, enforced by the check constraint
  }

  try {
    await q(
      `update opportunities set
         kind=$2, title=$3, country=$4, org=$5, url=$6, opens_on=$7, closes_on=$8,
         parent_id=$9, degree_level=$10, funding=$11, notes=$12, added_by=$13, is_archived=$14
       where id=$1`,
      [
        id, v.kind, v.title, v.country, v.org, v.url, v.opens_on, v.closes_on,
        v.parent_id, v.degree_level, v.funding, v.notes, v.added_by, v.is_archived,
      ],
    )
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('PATCH /api/admin/opportunities/[id]', e)
    if (String(e?.constraint) === 'parent_only_for_scholarship') {
      return NextResponse.json(
        { error: 'Remove the admission link before changing this to an admission.' },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: 'Could not update.' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const { id } = await ctx.params
  try {
    const children = await q1<{ n: number }>(
      `select count(*)::int as n from opportunities where parent_id = $1`,
      [id],
    )
    await q(`delete from opportunities where id = $1`, [id])
    return NextResponse.json({ ok: true, orphaned: children?.n ?? 0 })
  } catch (e) {
    console.error('DELETE /api/admin/opportunities/[id]', e)
    return NextResponse.json({ error: 'Could not delete.' }, { status: 500 })
  }
}
