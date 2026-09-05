import { NextResponse } from 'next/server'
import { runReminders } from '@/lib/reminders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Daily sweep. Wired to Vercel Cron via vercel.json.
 * Vercel signs its cron calls with CRON_SECRET when that env var is set;
 * we also accept the admin passcode so it can be triggered manually.
 */
function authorized(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? ''
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth === 'Bearer ' + cronSecret) return true
  if (req.headers.get('x-admin-key') === process.env.ADMIN_PASSCODE) return true
  // Vercel cron requests carry this header and cannot be forged by a browser.
  if (req.headers.get('x-vercel-cron') === '1') return true
  // No CRON_SECRET configured (e.g. local dev) — allow.
  return !cronSecret
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
  const today = new Date().toISOString().slice(0, 10)
  try {
    const result = await runReminders(today)
    console.log('cron reminders', JSON.stringify({ due: result.due, sent: result.sent, failed: result.failed }))
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('cron reminders failed', e)
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 })
  }
}

export const POST = GET
