import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin'
import { runReminders, previewReminders } from '@/lib/reminders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Fire the reminder sweep by hand.
 *  { dry: true }              -> show what today would send, send nothing
 *  { date: '2026-12-15' }     -> pretend it is that day (handy for testing)
 */
export async function POST(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    /* empty body is fine */
  }

  const date =
    typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : new Date().toISOString().slice(0, 10)

  try {
    const result = body.dry ? await previewReminders(date) : await runReminders(date)
    return NextResponse.json({ dry: !!body.dry, ...result })
  } catch (e: any) {
    console.error('POST /api/admin/run', e)
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 })
  }
}
