import { NextResponse } from 'next/server'
import { q, q1 } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'
import { sendMessage } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const STATUSES = ['pending', 'active', 'blocked']

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

  const sets: string[] = []
  const args: any[] = [id]

  if (typeof body.status === 'string') {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    }
    args.push(body.status)
    sets.push('status = $' + args.length)
  }
  if (typeof body.is_admin === 'boolean') {
    args.push(body.is_admin)
    sets.push('is_admin = $' + args.length)
  }
  if (typeof body.display_name === 'string') {
    args.push(body.display_name.trim().slice(0, 80) || null)
    sets.push('display_name = $' + args.length)
  }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  try {
    await q('update members set ' + sets.join(', ') + ' where id = $1', args)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('PATCH /api/admin/members/[id]', e)
    return NextResponse.json({ error: 'Could not update member.' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req)
  if (denied) return denied
  const { id } = await ctx.params
  try {
    await q('delete from members where id = $1', [id])
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE /api/admin/members/[id]', e)
    return NextResponse.json({ error: 'Could not remove member.' }, { status: 500 })
  }
}

/** Send a test DM so an admin can confirm a member's link actually works. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = requireAdmin(req)
  if (denied) return denied
  const { id } = await ctx.params

  const m = await q1<any>(
    `select chat_id::text as chat_id, telegram_username from members where id = $1`,
    [id],
  )
  if (!m) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
  if (!m.chat_id) {
    return NextResponse.json(
      { error: 'Not linked yet — they need to send /start to the bot first.' },
      { status: 400 },
    )
  }

  const res = await sendMessage(
    m.chat_id,
    '🔔 <b>Test ping</b>\n\nYour reminders are wired up correctly. You will get a DM before every intake opens and again before it closes.',
  )
  return res?.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Telegram rejected the message.' }, { status: 502 })
}
