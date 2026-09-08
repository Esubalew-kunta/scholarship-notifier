import { NextResponse } from 'next/server'
import { q1 } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied
  try {
    const s = await q1<any>(`
      select
        (select count(*) from opportunities where is_archived = false)::int as total,
        (select count(*) from opportunities where kind='admission' and is_archived=false)::int as admissions,
        (select count(*) from opportunities where kind='scholarship' and is_archived=false)::int as scholarships,
        (select count(*) from opportunities
          where is_archived=false and closes_on is not null
            and closes_on >= current_date and closes_on <= current_date + 30)::int as closing_soon,
        (select count(*) from opportunities
          where is_archived=false and opens_on is not null and opens_on > current_date)::int as upcoming,
        (select count(*) from opportunities o
          where o.is_archived=false and o.kind='scholarship'
            and not exists (select 1 from opportunity_links l
                             where l.scholarship_id = o.id))::int as orphans,
        (select count(*) from opportunities where is_archived = true)::int as archived,
        (select count(*) from members where status='active')::int as members_active,
        (select count(*) from members where status='pending')::int as members_pending,
        (select count(*) from reminders_sent)::int as reminders_sent,
        (select count(*) from applications where status='applied')::int as applied
    `)
    return NextResponse.json({ stats: s })
  } catch (e) {
    console.error('GET /api/admin/stats', e)
    return NextResponse.json({ error: 'Could not load stats.' }, { status: 500 })
  }
}
