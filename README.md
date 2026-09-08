# Intake Tracker

Admission and scholarship deadlines for a small group, with a Telegram bot that
nags each person until they have actually applied.

The point is not "another calendar". It is the **dependency**: a scholarship that
opens in May is worthless if the university admission behind it closed in December.
So scholarships and admissions are linked to each other, and every reminder tells
you whether at least one admission that qualifies you is still reachable *for you*.

The link is many-to-many, because reality is. One offer unlocks several awards,
and one national scholarship accepts holders of any of several offers:

```
🎓 Verona offer ──┬── 💰 Verona merit award
                  ├── 💰 Regional grant (Veneto) ──┐
                  └── 💰 IYT scholarship           │
                                                   │
🎓 Padua offer ────────────────────────────────────┘
```

Hold *either* offer and the regional grant is reachable. The bot works that out
per person, from what each of them has actually applied to.

## What it does

- **Open web form** — anyone with the link adds an intake. Six fields.
- **Shared board** — the data is common to the crew; who applied is private.
- **Telegram DMs** — one message a day for every open window, from the opening
  date to the closing date, plus a single heads-up a week before it opens.
- **The gate** — a scholarship reminder says, in plain words, whether any admission
  that qualifies you is applied for, still open, or already closed.
- **Application fee** — recorded in EUR or USD and shown on the card and in the DM.
- **One-tap answers** — ✅ I have already applied / ⏰ Snooze 3d / 🚫 Not for me,
  right in the chat. Reminders stop the moment you tap the first one.
- **Admin dashboard** — full CRUD, archive, member management, and a dry-run for
  the reminder engine.

## Stack

| Piece | What |
|---|---|
| Frontend + API | Next.js 15 (App Router) — one deploy |
| Database | Supabase Postgres, reached over the transaction pooler |
| Scheduler | Vercel Cron, once a day |
| Identity | Telegram username — no passwords, no email |

There are no Supabase Edge Functions and no separate backend. RLS is enabled with
**zero policies**, so the anon key can read nothing; every query runs server-side
through Next.js route handlers.

---

## Local setup

```bash
npm install
cp .env.example .env.local     # then fill it in — see below
npm run db:push                # creates tables + the reminder function
npm run dev                    # http://localhost:3000
```

### Environment variables

| Name | Where it comes from |
|---|---|
| `DATABASE_URL` | Supabase → Connect → **Transaction pooler**, port **6543** |
| `MIGRATION_DATABASE_URL` | Same, but **Session pooler**, port **5432** (migrations only) |
| `TELEGRAM_BOT_TOKEN` | @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Any random string — `openssl rand -hex 16` |
| `ADMIN_PASSCODE` | Whatever you want the dashboard passcode to be |
| `APP_URL` | Your deployed URL |
| `TELEGRAM_BOT_USERNAME` | Bot username, no `@` |
| `NEXT_PUBLIC_BOT_USERNAME` | Same value — this one reaches the browser |
| `CRON_SECRET` | Optional. Set it on Vercel to lock the cron route down |

`DATABASE_URL` **must** use the pooler on port 6543. The direct `db.<ref>.supabase.co`
host is IPv6-only and serverless functions cannot open a connection to it.

---

## Deploying to Vercel

1. **Import the repo** at [vercel.com/new](https://vercel.com/new). Framework
   auto-detects as Next.js; leave the build settings alone.
2. **Add the environment variables** above under *Settings → Environment Variables*
   (Production + Preview). Skip `MIGRATION_DATABASE_URL` — it is only used locally.
   Set `APP_URL` to the URL Vercel gives you.
3. **Redeploy** so the variables are picked up.
4. **Point the bot at it:**
   ```bash
   node scripts/set-webhook.mjs https://your-app.vercel.app
   ```
   This registers the webhook and the bot's command menu.
5. **Claim the crew:** open the bot and send `/start`. The first person to do this
   becomes the admin. Do it before sharing the link.
6. Invite the rest with `/invite @their_username`, or from the Crew tab.

`vercel.json` already declares the daily cron at 05:00 UTC. The Hobby plan allows
one cron run per day, which is exactly what this needs.

### Verifying the schedule

Admin → **Tools** → set *Pretend today is* to a future date and hit
**Preview (send nothing)**. It shows the exact messages that date would produce.
A preview never records anything, so the real run still delivers them.

---

## How the reminder engine works

`due_reminders(date)` in [db/schema.sql](db/schema.sql) returns every
(member × opportunity) pair that deserves a message today. A row qualifies when:

- the member is `active` and has linked their Telegram
- the opportunity is not archived
- that member's status on it is still `watching` (not applied, not skipped)
- any snooze has expired
- today falls inside the window (`opens_on ≤ today ≤ closes_on`), or is exactly
  seven days before it opens — and that exact message has not been sent before

The last condition is the `reminders_sent` table, keyed on
`(member, opportunity, tag)`. Tags look like `day-2026-11-04` and `opens-soon`,
so a day's message can only ever go out once even if the sweep runs twice.
A row is only written after Telegram confirms delivery, so a failed send is retried
on the next sweep rather than silently lost.

## Layout

```
src/lib/
  db.ts            pooled Postgres access (DATE stays a string — see the comment)
  reminders.ts     the daily sweep, the gate wording, the send loop
  opportunities.ts one filter/validation layer for both the public and admin lists
  dates.ts         date maths shared by server and browser
src/app/
  page.tsx         public: add form + shared board
  admin/page.tsx   dashboard: board / crew / tools
  api/telegram     webhook — /start pairing, commands, button taps
  api/cron         the daily sweep
```

## Bot commands

| Command | Who |
|---|---|
| `/start` | everyone — links your account |
| `/list` | what is coming up, with your status on each |
| `/status` | your own tally |
| `/pause`, `/resume` | mute or unmute reminders |
| `/invite @username` | admin |
| `/members` | admin |
