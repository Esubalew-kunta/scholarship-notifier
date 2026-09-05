import { q } from './db'
import { sendMessage, esc } from './telegram'
import { daysBetween, humanDays, prettyDate } from './dates'

export interface DueRow {
  member_id: string
  chat_id: string
  opportunity_id: string
  tag: string
  reason: 'opens' | 'closes' | 'nag'
  kind: 'admission' | 'scholarship'
  title: string
  country: string | null
  org: string | null
  url: string | null
  opens_on: string | null
  closes_on: string | null
  degree_level: string | null
  funding: string | null
  notes: string | null
  parent_id: string | null
  parent_title: string | null
  parent_opens_on: string | null
  parent_closes_on: string | null
  parent_url: string | null
  parent_status: 'watching' | 'applied' | 'skipped' | null
  child_count: number
}

const DUE_SQL = `
  with due as (select * from due_reminders($1::date))
  select d.member_id, d.chat_id::text as chat_id, d.opportunity_id, d.tag, d.reason,
         o.kind, o.title, o.country, o.org, o.url,
         to_char(o.opens_on, 'YYYY-MM-DD')  as opens_on,
         to_char(o.closes_on, 'YYYY-MM-DD') as closes_on,
         o.degree_level, o.funding, o.notes,
         p.id as parent_id, p.title as parent_title, p.url as parent_url,
         to_char(p.opens_on, 'YYYY-MM-DD')  as parent_opens_on,
         to_char(p.closes_on, 'YYYY-MM-DD') as parent_closes_on,
         pa.status as parent_status,
         (select count(*) from opportunities c
           where c.parent_id = o.id and c.is_archived = false)::int as child_count
    from due d
    join opportunities o on o.id = d.opportunity_id
    left join opportunities p on p.id = o.parent_id
    left join applications pa
           on pa.opportunity_id = p.id and pa.member_id = d.member_id
   order by o.closes_on nulls last, o.opens_on nulls last
`

export { daysBetween, humanDays, prettyDate } from './dates'

/**
 * The point of the whole app: a scholarship reminder is only meaningful if
 * the admission it hangs off has actually been secured. This turns that
 * dependency into a sentence the reader can act on.
 */
export function gateBlock(r: DueRow, today: string): string {
  if (r.kind === 'admission') {
    if (r.child_count > 0) {
      const s = r.child_count === 1 ? '' : 's'
      return '\n🔓 <b>Unlocks ' + r.child_count + ' scholarship' + s +
        '</b> you are tracking. Miss this and they all go with it.'
    }
    return ''
  }

  if (!r.parent_id) {
    return '\n💡 Not linked to an admission yet. If it needs one, link it so you get warned in time.'
  }

  const status = r.parent_status ?? 'watching'
  const name = esc(r.parent_title)

  if (status === 'applied') {
    return '\n✅ Admission <b>' + name + '</b> — already applied. You are eligible.'
  }
  if (status === 'skipped') {
    return '\n🚫 You marked admission <b>' + name + '</b> as "not for me", so this scholarship is not reachable.'
  }
  if (r.parent_closes_on && daysBetween(r.parent_closes_on, today) < 0) {
    return '\n🚨 <b>BLOCKED.</b> Admission <b>' + name + '</b> closed ' +
      prettyDate(r.parent_closes_on) +
      ' and you never marked it applied. This scholarship is out of reach this cycle.'
  }
  if (r.parent_closes_on) {
    const d = daysBetween(r.parent_closes_on, today)
    return '\n⚠️ <b>Admission first.</b> You have not applied to <b>' + name +
      '</b>, which closes ' + prettyDate(r.parent_closes_on) + ' (' + humanDays(d) +
      '). No admission → no scholarship.'
  }
  return '\n⚠️ <b>Admission first.</b> You have not applied to <b>' + name + '</b> yet. Secure that before this.'
}

export function buildMessage(r: DueRow, today: string): { text: string; buttons: any[][] } {
  const icon = r.kind === 'admission' ? '🎓' : '💰'
  const label = r.kind === 'admission' ? 'Admission' : 'Scholarship'

  let headline: string
  if (r.reason === 'opens' && r.opens_on) {
    const d = daysBetween(r.opens_on, today)
    headline = d === 0
      ? '🟢 <b>Applications open TODAY</b>'
      : '🔔 <b>Opens ' + humanDays(d) + '</b> — ' + prettyDate(r.opens_on)
  } else if (r.reason === 'closes' && r.closes_on) {
    const d = daysBetween(r.closes_on, today)
    headline = d === 0
      ? '🔴 <b>LAST DAY — closes today</b>'
      : '⏳ <b>Closes ' + humanDays(d) + '</b> — ' + prettyDate(r.closes_on)
  } else {
    headline = '⏰ <b>Still open — did you apply?</b>'
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

  const gate = gateBlock(r, today)
  if (gate) lines.push(gate)

  if (r.notes) lines.push('\n📝 ' + esc(r.notes))

  const linkRow: any[] = []
  if (r.url) linkRow.push({ text: '🔗 Open page', url: r.url })
  if (r.kind === 'scholarship' && r.parent_url && r.parent_status !== 'applied') {
    linkRow.push({ text: '🎓 Admission page', url: r.parent_url })
  }

  const buttons: any[][] = [
    [
      { text: '✅ Applied', callback_data: 'a:' + r.opportunity_id },
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
            p.title as parent_title,
            m.chat_id::text as chat_id
       from opportunities o
       left join opportunities p on p.id = o.parent_id
       cross join members m
      where o.id = $1 and m.status = 'active' and m.chat_id is not null`,
    [opportunityId],
  )
  if (!rows.length) return 0

  const o = rows[0]
  const icon = o.kind === 'admission' ? '🎓' : '💰'
  const bits = [o.country, o.org].filter(Boolean).map(esc)

  const lines = [
    '🆕 <b>New ' + o.kind + ' added</b>',
    '',
    icon + ' <b>' + esc(o.title) + '</b>',
    bits.length ? '<i>' + bits.join(' · ') + '</i>' : '',
    o.opens_on ? '📅 Opens ' + prettyDate(o.opens_on) : '',
    o.closes_on ? '⏳ Closes ' + prettyDate(o.closes_on) : '',
    o.parent_title ? '🔗 Part of admission: <b>' + esc(o.parent_title) + '</b>' : '',
    o.added_by ? '\n<i>added by ' + esc(o.added_by) + '</i>' : '',
  ].filter(Boolean)

  const buttons: any[][] = []
  if (o.url) buttons.push([{ text: '🔗 Open page', url: o.url }])
  buttons.push([
    { text: '✅ Already applied', callback_data: 'a:' + o.id },
    { text: '🚫 Not for me', callback_data: 'x:' + o.id },
  ])

  const text = lines.join('\n')
  for (const r of rows) await sendMessage(r.chat_id, text, buttons)
  return rows.length
}
