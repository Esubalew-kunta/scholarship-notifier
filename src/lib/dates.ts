/** Date helpers shared by the server and the browser. No Node imports. */

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Whole days from `toISO` to `from`, both YYYY-MM-DD. Positive = future. */
export function daysBetween(from: string, toISO: string): number {
  const a = Date.parse(from + 'T00:00:00Z')
  const b = Date.parse(toISO + 'T00:00:00Z')
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((a - b) / 86400000)
}

export function humanDays(n: number): string {
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  return n > 0 ? 'in ' + n + ' days' : n * -1 + ' days ago'
}

export function prettyDate(iso: string | null): string {
  if (!iso) return 'no date'
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return 'no date'
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export type Phase = 'upcoming' | 'open' | 'closing' | 'closed' | 'undated'

export function phaseOf(
  opens_on: string | null,
  closes_on: string | null,
  today = todayISO(),
): Phase {
  if (!opens_on && !closes_on) return 'undated'
  if (closes_on && closes_on < today) return 'closed'
  if (opens_on && opens_on > today) return 'upcoming'
  if (closes_on && daysBetween(closes_on, today) <= 14) return 'closing'
  return 'open'
}
