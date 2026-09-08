import { NextResponse } from 'next/server'
import { q, q1 } from '@/lib/db'
import { sendMessage, answerCallback, editMessageText, esc } from '@/lib/telegram'
import { prettyDate, daysBetween, humanDays } from '@/lib/reminders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OK = () => NextResponse.json({ ok: true })

interface Member {
  id: string
  telegram_username: string | null
  display_name: string | null
  is_admin: boolean
  status: string
  chat_id: string | null
}

async function memberByTelegramId(userId: number): Promise<Member | null> {
  return q1<Member>(
    `select id, telegram_username, display_name, is_admin, status, chat_id::text as chat_id
       from members where telegram_user_id = $1`,
    [userId],
  )
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------ */
/* /start — pair the Telegram account with an allow-listed username    */
/* ------------------------------------------------------------------ */
async function handleStart(from: any, chatId: number) {
  const username: string | null = from.username ? String(from.username).toLowerCase() : null
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || username || 'there'

  const already = await memberByTelegramId(from.id)
  if (already) {
    await q(
      `update members set chat_id = $2, status = case when status = 'blocked' then 'blocked' else 'active' end
         where id = $1`,
      [already.id, chatId],
    )
    await sendMessage(
      chatId,
      '👋 Welcome back, <b>' + esc(name) + '</b>.\n\nYou are linked and reminders are on.\nSend /help to see what I can do.',
    )
    return
  }

  if (!username) {
    await sendMessage(
      chatId,
      '⚠️ Your Telegram account has no <b>@username</b>.\n\nSet one in Telegram → Settings → Username, then send /start again. I use it to match you against the invite list.',
    )
    return
  }

  const invited = await q1<Member>(
    `select id, telegram_username, display_name, is_admin, status, chat_id::text as chat_id
       from members where telegram_username = $1`,
    [username],
  )

  if (invited) {
    if (invited.status === 'blocked') {
      await sendMessage(chatId, '🚫 Your access has been paused. Ask an admin to re-enable it.')
      return
    }
    await q(
      `update members
          set telegram_user_id = $2, chat_id = $3, status = 'active',
              linked_at = now(),
              display_name = coalesce(display_name, $4)
        where id = $1`,
      [invited.id, from.id, chatId, name],
    )
    await sendMessage(
      chatId,
      '✅ <b>You are in, ' + esc(name) + '.</b>\n\n' +
        'I will DM you <b>every day</b> an intake is open — from the day it opens to the day it shuts — and I will not stop until you tap ✅ I have already applied.\n\n' +
        'The important part: when a scholarship needs a university admission, I will not let you look at the scholarship date without telling you whether at least one admission that qualifies you is still reachable.\n\n' +
        'Send /list to see what is coming up.',
    )
    return
  }

  // Bootstrap: the very first person to /start claims the crew.
  const anyone = await q1<{ n: number }>(`select count(*)::int as n from members`)
  if ((anyone?.n ?? 0) === 0) {
    await q(
      `insert into members
         (telegram_username, telegram_user_id, chat_id, display_name, is_admin, status, linked_at)
       values ($1, $2, $3, $4, true, 'active', now())`,
      [username, from.id, chatId, name],
    )
    await sendMessage(
      chatId,
      '👑 <b>You are the first member, so you are the admin.</b>\n\n' +
        'Add your friends with:\n<code>/invite @their_username</code>\n\n' +
        'Send /help for everything else.',
    )
    return
  }

  await sendMessage(
    chatId,
    '🔒 <b>@' + esc(username) + '</b> is not on the invite list yet.\n\n' +
      'Ask whoever runs the tracker to add you — they just need to send <code>/invite @' +
      esc(username) + '</code> to this bot, then you send /start again.',
  )
}

/* ------------------------------------------------------------------ */
/* /list — what is coming up, with your own status on each             */
/* ------------------------------------------------------------------ */
async function handleList(member: Member, chatId: number) {
  const rows = await q<any>(
    `select o.id, o.kind, o.title, o.country, o.url,
            to_char(o.opens_on,  'YYYY-MM-DD') as opens_on,
            to_char(o.closes_on, 'YYYY-MM-DD') as closes_on,
            coalesce(a.status, 'watching') as my_status,
            coalesce((
              select json_agg(json_build_object(
                       'title', p.title,
                       'closes_on', to_char(p.closes_on, 'YYYY-MM-DD'),
                       'status', coalesce(pa.status, 'watching'))
                       order by p.closes_on asc nulls last, p.title asc)
                from opportunity_links l
                join opportunities p
                  on p.id = l.admission_id and p.is_archived = false
                left join applications pa
                  on pa.opportunity_id = p.id and pa.member_id = $1
               where o.kind = 'scholarship' and l.scholarship_id = o.id
            ), '[]'::json) as admissions
       from opportunities o
       left join applications a on a.opportunity_id = o.id and a.member_id = $1
      where o.is_archived = false
        and (o.closes_on is null or o.closes_on >= current_date)
      order by coalesce(o.closes_on, o.opens_on, '2999-12-31') asc
      limit 25`,
    [member.id],
  )

  if (!rows.length) {
    await sendMessage(chatId, '📭 Nothing on the board yet. Add the first one on the web form.')
    return
  }

  const t = today()
  const lines = ['📋 <b>Upcoming & open</b>\n']

  for (const r of rows) {
    const icon = r.kind === 'admission' ? '🎓' : '💰'
    const mark = r.my_status === 'applied' ? ' ✅' : r.my_status === 'skipped' ? ' 🚫' : ''
    lines.push(icon + ' <b>' + esc(r.title) + '</b>' + mark)

    const bits: string[] = []
    if (r.country) bits.push(esc(r.country))
    if (r.opens_on && r.opens_on > t) {
      bits.push('opens ' + prettyDate(r.opens_on) + ' (' + humanDays(daysBetween(r.opens_on, t)) + ')')
    } else if (r.closes_on) {
      bits.push('closes ' + prettyDate(r.closes_on) + ' (' + humanDays(daysBetween(r.closes_on, t)) + ')')
    }
    if (bits.length) lines.push('   <i>' + bits.join(' · ') + '</i>')

    // Holding any one linked admission is enough, so only flag it when none
    // has been secured — and only call it blocked when every route has shut.
    const admissions: any[] = r.admissions ?? []
    if (r.kind === 'scholarship' && admissions.length && !admissions.some((a) => a.status === 'applied')) {
      const live = admissions.filter(
        (a) => a.status !== 'skipped' && (!a.closes_on || daysBetween(a.closes_on, t) >= 0),
      )
      const names = (live.length ? live : admissions).slice(0, 2).map((a) => esc(a.title)).join(' or ')
      const extra = (live.length ? live : admissions).length - 2
      lines.push(
        '   ' + (live.length ? '⚠️' : '🚨') + ' needs admission <b>' + names + '</b>' +
          (extra > 0 ? ' (+' + extra + ')' : '') +
          (live.length ? '' : ' — <b>all closed</b>'),
      )
    }
    lines.push('')
  }

  lines.push('<i>Tap the buttons on a reminder to mark it applied.</i>')
  await sendMessage(chatId, lines.join('\n'))
}

/* ------------------------------------------------------------------ */
/* /invite — admin adds a friend by @username                          */
/* ------------------------------------------------------------------ */
async function handleInvite(member: Member, chatId: number, arg: string) {
  if (!member.is_admin) {
    await sendMessage(chatId, '🚫 Only an admin can invite people.')
    return
  }
  const username = arg.trim().replace(/^@+/, '').toLowerCase()
  if (!/^[a-z0-9_]{5,32}$/.test(username)) {
    await sendMessage(
      chatId,
      'Usage: <code>/invite @username</code>\n\nTelegram usernames are 5-32 characters: letters, numbers and underscore.',
    )
    return
  }

  const existing = await q1<any>(`select status from members where telegram_username = $1`, [username])
  if (existing) {
    await sendMessage(chatId, 'ℹ️ <b>@' + esc(username) + '</b> is already on the list (' + existing.status + ').')
    return
  }

  await q(
    `insert into members (telegram_username, status) values ($1, 'pending')`,
    [username],
  )
  await sendMessage(
    chatId,
    '✅ <b>@' + esc(username) + '</b> added.\n\nTell them to open @' +
      esc(process.env.TELEGRAM_BOT_USERNAME || 'scholarship_notifybot') +
      ' and send <code>/start</code>. They will start getting reminders straight away.',
  )
}

async function handleMembers(member: Member, chatId: number) {
  if (!member.is_admin) {
    await sendMessage(chatId, '🚫 Admins only.')
    return
  }
  const rows = await q<any>(
    `select telegram_username, display_name, status, is_admin
       from members order by status = 'active' desc, telegram_username`,
  )
  const lines = ['👥 <b>Crew (' + rows.length + ')</b>\n']
  for (const r of rows) {
    const dot = r.status === 'active' ? '🟢' : r.status === 'pending' ? '🟡' : '🔴'
    lines.push(
      dot + ' @' + esc(r.telegram_username) +
        (r.is_admin ? ' 👑' : '') +
        (r.display_name ? ' — ' + esc(r.display_name) : '') +
        (r.status === 'pending' ? ' <i>(not linked yet)</i>' : ''),
    )
  }
  await sendMessage(chatId, lines.join('\n'))
}

async function handleStatus(member: Member, chatId: number) {
  const s = await q1<any>(
    `select
       (select count(*) from applications where member_id = $1 and status = 'applied')::int  as applied,
       (select count(*) from applications where member_id = $1 and status = 'skipped')::int  as skipped,
       (select count(*) from opportunities o
         where o.is_archived = false
           and (o.closes_on is null or o.closes_on >= current_date)
           and not exists (select 1 from applications a
                            where a.member_id = $1 and a.opportunity_id = o.id
                              and a.status in ('applied','skipped')))::int as open_items`,
    [member.id],
  )
  await sendMessage(
    chatId,
    '📊 <b>' + esc(member.display_name || member.telegram_username || 'You') + '</b>\n\n' +
      '✅ Applied: <b>' + s.applied + '</b>\n' +
      '🚫 Passed: <b>' + s.skipped + '</b>\n' +
      '⏳ Still to decide: <b>' + s.open_items + '</b>\n\n' +
      (member.is_admin ? '👑 You are an admin.' : ''),
  )
}

const HELP =
  '🎓 <b>Scholarship &amp; Admission Tracker</b>\n\n' +
  'I warn you a week before an intake opens, then remind you <b>every single day</b> it is open, until you tap ✅ I have already applied.\n\n' +
  '<b>Commands</b>\n' +
  '/list — what is coming up\n' +
  '/status — your own tally\n' +
  '/pause — stop reminders\n' +
  '/resume — start them again\n' +
  '/help — this message\n\n' +
  '<b>Admin</b>\n' +
  '/invite @username — add a friend\n' +
  '/members — see the crew\n'

/* ------------------------------------------------------------------ */
/* Button taps                                                         */
/* ------------------------------------------------------------------ */
async function handleCallback(cb: any) {
  const data: string = cb.data ?? ''
  const from = cb.from
  const chatId = cb.message?.chat?.id
  const messageId = cb.message?.message_id

  const member = await memberByTelegramId(from.id)
  if (!member || member.status !== 'active') {
    await answerCallback(cb.id, 'You are not an active member. Send /start.')
    return
  }

  const [action, oppId] = data.split(':')
  if (!oppId) {
    await answerCallback(cb.id, 'Unknown action.')
    return
  }

  const opp = await q1<any>(
    `select title, kind from opportunities where id = $1`,
    [oppId],
  )
  if (!opp) {
    await answerCallback(cb.id, 'That entry was removed.')
    return
  }

  let toast = ''
  let footer = ''

  if (action === 'a') {
    await q(
      `insert into applications (member_id, opportunity_id, status, snooze_until)
       values ($1, $2, 'applied', null)
       on conflict (member_id, opportunity_id)
       do update set status = 'applied', snooze_until = null, updated_at = now()`,
      [member.id, oppId],
    )
    toast = '✅ Marked as applied — no more nagging.'
    footer = '\n\n✅ <b>You marked this applied on ' + prettyDate(today()) + '.</b>'

    // If it was an admission, say what it just unlocked.
    if (opp.kind === 'admission') {
      const kids = await q1<{ n: number }>(
        `select count(*)::int as n
           from opportunity_links l
           join opportunities c on c.id = l.scholarship_id and c.is_archived = false
          where l.admission_id = $1`,
        [oppId],
      )
      if ((kids?.n ?? 0) > 0) {
        footer += '\n🔓 ' + kids!.n + ' linked scholarship' + (kids!.n === 1 ? '' : 's') +
          ' just became reachable for you.'
      }
    }
  } else if (action === 's') {
    const until = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
    await q(
      `insert into applications (member_id, opportunity_id, status, snooze_until)
       values ($1, $2, 'watching', $3)
       on conflict (member_id, opportunity_id)
       do update set snooze_until = $3, status = 'watching', updated_at = now()`,
      [member.id, oppId, until],
    )
    toast = '⏰ Snoozed until ' + until
    footer = '\n\n⏰ <b>Snoozed until ' + prettyDate(until) + '.</b>'
  } else if (action === 'x') {
    await q(
      `insert into applications (member_id, opportunity_id, status, snooze_until)
       values ($1, $2, 'skipped', null)
       on conflict (member_id, opportunity_id)
       do update set status = 'skipped', snooze_until = null, updated_at = now()`,
      [member.id, oppId],
    )
    toast = '🚫 Dropped from your list.'
    footer = '\n\n🚫 <b>You passed on this one.</b>'
  } else {
    await answerCallback(cb.id, 'Unknown action.')
    return
  }

  await answerCallback(cb.id, toast)

  if (chatId && messageId) {
    const original: string = cb.message?.text ?? ''
    // Re-send as plain text plus the outcome; buttons are dropped on purpose.
    await editMessageText(chatId, messageId, esc(original) + footer)
  }
}

/* ------------------------------------------------------------------ */
/* Webhook entry point                                                 */
/* ------------------------------------------------------------------ */
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (secret && req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let update: any
  try {
    update = await req.json()
  } catch {
    return OK()
  }

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query)
      return OK()
    }

    const msg = update.message ?? update.edited_message
    if (!msg || !msg.text) return OK()

    const chatId: number = msg.chat.id
    const from = msg.from
    const text: string = msg.text.trim()

    // Ignore chatter in groups unless it is addressed to the bot.
    if (msg.chat.type !== 'private' && !text.startsWith('/')) return OK()

    const [rawCmd, ...rest] = text.split(/\s+/)
    const cmd = rawCmd.toLowerCase().split('@')[0]
    const arg = rest.join(' ')

    if (cmd === '/start') {
      await handleStart(from, chatId)
      return OK()
    }

    const member = await memberByTelegramId(from.id)
    if (!member) {
      await sendMessage(chatId, '👋 Send /start first so I know who you are.')
      return OK()
    }
    if (member.status === 'blocked' && cmd !== '/resume') {
      await sendMessage(chatId, '🔕 Your reminders are paused. Send /resume to turn them back on.')
      return OK()
    }

    switch (cmd) {
      case '/help':
      case '/commands':
        await sendMessage(chatId, HELP)
        break
      case '/list':
      case '/upcoming':
        await handleList(member, chatId)
        break
      case '/status':
      case '/me':
        await handleStatus(member, chatId)
        break
      case '/invite':
      case '/add':
        await handleInvite(member, chatId, arg)
        break
      case '/members':
      case '/crew':
        await handleMembers(member, chatId)
        break
      case '/pause':
      case '/stop':
        await q(`update members set status = 'blocked' where id = $1`, [member.id])
        await sendMessage(chatId, '🔕 Reminders paused. Send /resume when you want them back.')
        break
      case '/resume':
        await q(`update members set status = 'active' where id = $1`, [member.id])
        await sendMessage(chatId, '🔔 Reminders are back on.')
        break
      default:
        await sendMessage(chatId, 'I did not recognise that. Send /help.')
    }
    return OK()
  } catch (e) {
    // Always 200 — Telegram retries aggressively on any non-2xx.
    console.error('telegram webhook error', e)
    return OK()
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: 'Telegram posts here.' })
}
