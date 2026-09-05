/**
 * Point the Telegram bot at this deployment.
 *   node scripts/set-webhook.mjs https://your-app.vercel.app
 * With no argument it reads APP_URL from the environment.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local without a dependency.
try {
  const raw = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch {}

const token = process.env.TELEGRAM_BOT_TOKEN
const secret = process.env.TELEGRAM_WEBHOOK_SECRET
const base = (process.argv[2] || process.env.APP_URL || '').replace(/\/$/, '')

if (!token) { console.error('TELEGRAM_BOT_TOKEN is missing'); process.exit(1) }
if (!base || !base.startsWith('https://')) {
  console.error('Pass an https URL:  node scripts/set-webhook.mjs https://your-app.vercel.app')
  process.exit(1)
}

const api = (m) => `https://api.telegram.org/bot${token}/${m}`
const post = async (m, body) => {
  const r = await fetch(api(m), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

const url = base + '/api/telegram'
const set = await post('setWebhook', {
  url,
  secret_token: secret || undefined,
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: true,
})
console.log('setWebhook ->', JSON.stringify(set))

const cmds = await post('setMyCommands', {
  commands: [
    { command: 'start', description: 'Link your account' },
    { command: 'list', description: 'What is coming up' },
    { command: 'status', description: 'Your own tally' },
    { command: 'invite', description: 'Add a friend (admin)' },
    { command: 'members', description: 'See the crew (admin)' },
    { command: 'pause', description: 'Stop reminders' },
    { command: 'resume', description: 'Start reminders again' },
    { command: 'help', description: 'Show help' },
  ],
})
console.log('setMyCommands ->', JSON.stringify(cmds))

const info = await (await fetch(api('getWebhookInfo'))).json()
console.log('getWebhookInfo ->', JSON.stringify(info.result, null, 2))
