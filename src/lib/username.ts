/** Strip '@', trim, lowercase. Telegram usernames are case-insensitive. */
export function normUsername(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const u = v.trim().replace(/^@+/, '').toLowerCase()
  return /^[a-z0-9_]{5,32}$/.test(u) ? u : null
}
