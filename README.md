# Intake Tracker

Admission and scholarship deadlines for a small group, with a Telegram bot that
nags each person until they have actually applied.

The point is not "another calendar". It is the **dependency**: a scholarship that
opens in May is worthless if the university admission behind it closed in December.
So a scholarship is linked to its admission, and every reminder tells you whether
that admission is still reachable *for you*.

```
🎓 admission (1) ──┬── 💰 scholarship
                   ├── 💰 scholarship
                   └── 💰 scholarship
```

## What it does

- **Open web form** — anyone with the link adds an intake. Six fields.
- **Shared board** — the data is common to the crew; who applied is private.
- **Telegram DMs** — before it opens (T-7, T-2, day-of), before it closes
  (T-14, T-7, T-3, T-1, day-of), then a nag every 3 days while the window is open.
- **The gate** — a scholarship reminder says, in plain words, whether its admission
  is applied for, still open, or already closed.
- **One-tap answers** — ✅ Applied / ⏰ Snooze 3d / 🚫 Not for me, right in the chat.
  Reminders stop the moment you tap Applied.
- **Admin dashboard** — filter across eight dimensions, full CRUD, archive,
  member management, and a dry-run for the reminder engine.

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
- the opportunity is not archived and has not closed
- that member's status on it is still `watching` (not applied, not skipped)
- any snooze has expired
- the date matches a ladder step — and that exact step has not been sent before

The last condition is the `reminders_sent` table, keyed on
`(member, opportunity, tag)`. Tags look like `open-7`, `close-3`, `nag-2026-11-04`.
A row is only written after Telegram confirms delivery, so a failed send is retried
on the next sweep rather than silently lost.

## Layout

```
src/lib/
  db.ts            pooled Postgres access (DATE stays a string — see the comment)
  reminders.ts     the ladder, the gate wording, the send loop
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
