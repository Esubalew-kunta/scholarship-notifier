import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Admin routes are gated by a shared passcode, not user accounts.
 * The passcode never leaves the server: the browser sends it as a header
 * and we compare it here.
 */
export function requireAdmin(req: Request): NextResponse | null {
  const expected = process.env.ADMIN_PASSCODE
  if (!expected) {
    return NextResponse.json(
      { error: 'ADMIN_PASSCODE is not configured on the server.' },
      { status: 500 },
    )
  }
  const given = req.headers.get('x-admin-key') ?? ''
  if (!given || !safeEqual(given, expected)) {
    return NextResponse.json({ error: 'Wrong passcode.' }, { status: 401 })
  }
  return null
}

export function isAdminRequest(req: Request): boolean {
  return requireAdmin(req) === null
}
