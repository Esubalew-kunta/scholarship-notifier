import { NextResponse } from 'next/server'
import { q, q1 } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'
import { normUsername } from '@/lib/username'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied
  try {
    const members = await q(
      `select m.id, m.telegram_username, m.telegram_user_id::text as telegram_user_id,
              m.chat_id::text as chat_id, m.display_name, m.is_admin, m.status,
              m.created_at, m.linked_at,
              (select count(*) from applications a
                where a.member_id = m.id and a.status = 'applied')::int as applied_count,
              (select count(*) from applications a
                where a.member_id = m.id and a.status = 'skipped')::int as skipped_count
         from members m
        order by m.status = 'active' desc, m.created_at desc`,
    )
    return NextResponse.json({ members })
  } catch (e) {
    console.error('GET /api/admin/members', e)
    return NextResponse.json({ error: 'Could not load members.' }, { status: 500 })
  }
}

/** Invite = add the Telegram username to the allow-list. They activate with /start. */
export async function POST(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const username = normUsername(body.telegram_username)
  if (!username) {
    return NextResponse.json(
      { error: 'Enter a valid Telegram username (5-32 chars: letters, numbers, underscore).' },
      { status: 400 },
    )
  }

  const name =
    typeof body.display_name === 'string' && body.display_name.trim()
      ? body.display_name.trim().slice(0, 80)
      : null

  try {
    const existing = await q1<any>(
      `select id, status from members where telegram_username = $1`,
      [username],
    )
    if (existing) {
      return NextResponse.json(
        { error: 'That username is already on the list (' + existing.status + ').' },
        { status: 409 },
      )
    }

    const row = await q1<{ id: string }>(
      `insert into members (telegram_username, display_name, is_admin, status)
       values ($1, $2, $3, 'pending')
       returning id`,
      [username, name, body.is_admin === true],
    )
    return NextResponse.json({ id: row!.id, telegram_username: username }, { status: 201 })
  } catch (e) {
    console.error('POST /api/admin/members', e)
    return NextResponse.json({ error: 'Could not add member.' }, { status: 500 })
  }
}
