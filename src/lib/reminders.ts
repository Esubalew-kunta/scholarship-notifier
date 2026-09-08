import { q } from './db'
import { sendMessage, esc } from './telegram'
import { daysBetween, humanDays, prettyDate } from './dates'
import { formatFee, type Currency } from './types'

/** A linked admission, carrying this member's own status on it. */
export interface GateAdmission {
  id: string
  title: string
  url: string | null
  closes_on: string | null
  status: 'watching' | 'applied' | 'skipped'
}

export interface DueRow {
  member_id: string
  chat_id: string
  opportunity_id: string
  tag: string
  reason: 'window' | 'opens'
  kind: 'admission' | 'scholarship'
  title: string
  country: string | null
  org: string | null
  url: string | null
  opens_on: string | null
  closes_on: string | null
  degree_level: string | null
  funding: string | null
  application_fee: number | null
  fee_currency: Currency | null
  notes: string | null
  /** scholarships only — every admission that qualifies you for this one */
  admissions: GateAdmission[]
  /** admissions only — how many scholarships this unlocks */
  unlocks: number
}

const DUE_SQL = `
  with due as (select * from due_reminders($1::date))
  select d.member_id, d.chat_id::text as chat_id, d.opportunity_id, d.tag, d.reason,
         o.kind, o.title, o.country, o.org, o.url,
         to_char(o.opens_on, 'YYYY-MM-DD')  as opens_on,
         to_char(o.closes_on, 'YYYY-MM-DD') as closes_on,
         o.degree_level, o.funding,
         o.application_fee::float8 as application_fee, o.fee_currency,
         o.notes,
         coalesce((
           select json_agg(json_build_object(
                    'id', p.id, 'title', p.title, 'url', p.url,
                    'closes_on', to_char(p.closes_on, 'YYYY-MM-DD'),
                    'status', coalesce(pa.status, 'watching'))
                    order by p.closes_on asc nulls last, p.title asc)
             from opportunity_links l
             join opportunities p
               on p.id = l.admission_id and p.is_archived = false
             left join applications pa
               on pa.opportunity_id = p.id and pa.member_id = d.member_id
            where o.kind = 'scholarship' and l.scholarship_id = o.id
         ), '[]'::json) as admissions,
         (select count(*)
            from opportunity_links l2
            join opportunities c on c.id = l2.scholarship_id and c.is_archived = false
           where o.kind = 'admission' and l2.admission_id = o.id)::int as unlocks
    from due d
    join opportunities o on o.id = d.opportunity_id
   order by o.closes_on nulls last, o.opens_on nulls last
`

export { daysBetween, humanDays, prettyDate } from './dates'

/** Comma-list of at most `max` titles, with "and N more" beyond that. */
function nameList(items: { title: string }[], max = 3): string {
  const shown = items.slice(0, max).map((a) => '<b>' + esc(a.title) + '</b>')
  const rest = items.length - shown.length
  const joined =
    shown.length === 1 ? shown[0]
    : shown.slice(0, -1).join(', ') + ' or ' + shown[shown.length - 1]
  return rest > 0 ? joined + ' (+' + rest + ' more)' : joined
}

/**
 * The point of the whole app: a scholarship reminder is only meaningful if at
 * least one admission that qualifies you for it is still reachable. With
 * several admissions feeding one scholarship, a single secured offer is enough
 * — so this reports the best case across all of them, not the worst.
 */
export function gateBlock(r: DueRow, today: string): string {
  if (r.kind === 'admission') {
    if (r.unlocks > 0) {
      const s = r.unlocks === 1 ? '' : 's'
      return '\n🔓 <b>Unlocks ' + r.unlocks + ' scholarship' + s +
        '</b> you are tracking. Miss this and they all go with it.'
    }
    return ''
  }

  const all = r.admissions ?? []
  if (!all.length) {
    return '\n💡 Not linked to an admission yet. If it needs one, link it so you get warned in time.'
  }

  const applied = all.filter((a) => a.status === 'applied')
  if (applied.length) {
    return '\n✅ You applied to ' + nameList(applied) + ' — you are eligible for this.'
  }

  const reachable = all.filter(
    (a) => a.status !== 'skipped' && (!a.closes_on || daysBetween(a.closes_on, today) >= 0),
  )

  if (!reachable.length) {
    const s = all.length === 1 ? '' : 's'
    return '\n🚨 <b>BLOCKED.</b> Every admission that qualifies you (' + all.length +
      ' route' + s + ') has closed or been passed on. Out of reach this cycle.'
  }

  const soonest = reachable.find((a) => a.closes_on)
  const deadline = soonest?.closes_on
    ? ' The soonest closes ' + prettyDate(soonest.closes_on) +
      ' (' + humanDays(daysBetween(soonest.closes_on, today)) + ').'
    : ''

  return '\n⚠️ <b>Admission first.</b> You need ' + nameList(reachable) + '.' +
    deadline + ' No admission → no scholarship.'
}

export function buildMessage(r: DueRow, today: string): { text: string; buttons: any[][] } {
  const icon = r.kind === 'admission' ? '🎓' : '💰'
  const label = r.kind === 'admission' ? 'Admission' : 'Scholarship'

  const toClose = r.closes_on ? daysBetween(r.closes_on, today) : null
  const toOpen = r.opens_on ? daysBetween(r.opens_on, today) : null

  let headline: string
  if (r.reason === 'opens') {
    headline = '🔔 <b>Opens ' + humanDays(toOpen ?? 0) + '</b> — ' + prettyDate(r.opens_on)
  } else if (toClose === 0) {
    headline = '🔴 <b>LAST DAY — closes today</b>'
  } else if (toClose !== null && toClose <= 7) {
    headline = '🚨 <b>Closes ' + humanDays(toClose) + '</b> — ' + prettyDate(r.closes_on)
  } else if (toOpen === 0) {
    headline = '🟢 <b>Applications open TODAY</b>'
  } else if (toClose !== null) {
    headline = '⏳ <b>Open now — ' + toClose + ' days left</b> · closes ' + prettyDate(r.closes_on)
  } else {
    headline = '⏰ <b>Open now — have you applied?</b>'
  }

  const meta: string[] = []
  if (r.country) meta.push(esc(r.country))
  if (r.org) meta.push(esc(r.org))
  if (r.degree_level && r.degree_level !== 'any') meta.push(esc(r.degree_level))
  if (r.funding && r.funding !== 'unknown') meta.push(esc(r.funding) + ' funding')

  const window: string[] = []
  if (r.opens_on) window.push('opens ' + prettyDate(r.opens_on))
  if (r.closes_on) window.push('closes ' + prettyDate(r.closes_on))

  const lines: string[] = [
    icon + ' <b>' + esc(r.title) + '</b>',
    '<i>' + label + (meta.length ? ' · ' + meta.join(' · ') : '') + '</i>',
    '',
    headline,
  ]
  if (window.length) lines.push('📅 ' + window.join(' · '))

  const fee = formatFee(r.application_fee, r.fee_currency)
  if (fee) lines.push('💳 Application fee: <b>' + esc(fee) + '</b>')

  const gate = gateBlock(r, today)
  if (gate) lines.push(gate)

  if (r.notes) lines.push('\n📝 ' + esc(r.notes))

  const linkRow: any[] = []
  if (r.url) linkRow.push({ text: '🔗 Open page', url: r.url })
  if (r.kind === 'scholarship') {
    const next = (r.admissions ?? []).find((a) => a.status !== 'applied' && a.url)
    if (next?.url && !(r.admissions ?? []).some((a) => a.status === 'applied')) {
      linkRow.push({ text: '🎓 Admission page', url: next.url })
    }
  }

  // Daily messages make snooze worth keeping: three quiet days without
  // having to lie and say you applied.
  const buttons: any[][] = [
    [{ text: '✅ I have already applied', callback_data: 'a:' + r.opportunity_id }],
    [
      { text: '⏰ Snooze 3d', callback_data: 's:' + r.opportunity_id },
      { text: '🚫 Not for me', callback_data: 'x:' + r.opportunity_id },
    ],
  ]
  if (linkRow.length) buttons.unshift(linkRow)

  return { text: lines.join('\n'), buttons }
}

/** What would go out today, without sending or recording anything. */
export async function previewReminders(today: string) {
  const rows = await q<DueRow>(DUE_SQL, [today])
  return {
    date: today,
    due: rows.length,
    messages: rows.map((r) => ({
      member_id: r.member_id,
      title: r.title,
      tag: r.tag,
      text: buildMessage(r, today).text,
    })),
  }
}

export async function runReminders(today: string) {
  const rows = await q<DueRow>(DUE_SQL, [today])
  const results = {
    date: today,
    due: rows.length,
    sent: 0,
    failed: 0,
    details: [] as any[],
  }

  for (const r of rows) {
    const { text, buttons } = buildMessage(r, today)
    const res = await sendMessage(r.chat_id, text, buttons)
    if (res && res.ok) {
      await q(
        `insert into reminders_sent (member_id, opportunity_id, tag)
         values ($1, $2, $3) on conflict do nothing`,
        [r.member_id, r.opportunity_id, r.tag],
      )
      results.sent++
      results.details.push({ title: r.title, tag: r.tag, member_id: r.member_id })
    } else {
      results.failed++
      results.details.push({ title: r.title, tag: r.tag, error: true })
    }
  }
  return results
}

/** Announce a newly added opportunity to every linked member. */
export async function broadcastNew(opportunityId: string): Promise<number> {
  const rows = await q<any>(
    `select o.id, o.kind, o.title, o.country, o.org, o.url, o.added_by,
            to_char(o.opens_on, 'YYYY-MM-DD')  as opens_on,
            to_char(o.closes_on, 'YYYY-MM-DD') as closes_on,
            o.application_fee::float8 as application_fee, o.fee_currency,
            coalesce((
              select json_agg(x.title order by x.title)
                from opportunity_links l
                join opportunities x
                  on x.id = case when o.kind = 'scholarship' then l.admission_id
                                 else l.scholarship_id end
               where (o.kind = 'scholarship' and l.scholarship_id = o.id)
                  or (o.kind = 'admission'   and l.admission_id   = o.id)
            ), '[]'::json) as link_titles,
            m.chat_id::text as chat_id
       from opportunities o
       cross join members m
      where o.id = $1 and m.status = 'active' and m.chat_id is not null`,
    [opportunityId],
  )
  if (!rows.length) return 0

  const o = rows[0]
  const icon = o.kind === 'admission' ? '🎓' : '💰'
  const bits = [o.country, o.org].filter(Boolean).map(esc)
  const titles: string[] = o.link_titles ?? []
  const fee = formatFee(o.application_fee, o.fee_currency)

  const linkLine = titles.length
    ? (o.kind === 'scholarship'
        ? '🔗 Open to holders of: <b>' + titles.map(esc).join('</b>, <b>') + '</b>'
        : '🔓 Unlocks: <b>' + titles.map(esc).join('</b>, <b>') + '</b>')
    : ''

  const lines = [
    '🆕 <b>New ' + o.kind + ' added</b>',
    '',
    icon + ' <b>' + esc(o.title) + '</b>',
    bits.length ? '<i>' + bits.join(' · ') + '</i>' : '',
    o.opens_on ? '📅 Opens ' + prettyDate(o.opens_on) : '',
    o.closes_on ? '⏳ Closes ' + prettyDate(o.closes_on) : '',
    fee ? '💳 Application fee: <b>' + esc(fee) + '</b>' : '',
    linkLine,
    o.added_by ? '\n<i>added by ' + esc(o.added_by) + '</i>' : '',
  ].filter(Boolean)

  const buttons: any[][] = []
  if (o.url) buttons.push([{ text: '🔗 Open page', url: o.url }])
  buttons.push([
    { text: '✅ I have already applied', callback_data: 'a:' + o.id },
    { text: '🚫 Not for me', callback_data: 'x:' + o.id },
  ])

  const text = lines.join('\n')
  for (const r of rows) await sendMessage(r.chat_id, text, buttons)
  return rows.length
}
