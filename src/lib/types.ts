export type Kind = 'admission' | 'scholarship'
export type AppStatus = 'watching' | 'applied' | 'skipped'
export type MemberStatus = 'pending' | 'active' | 'blocked'
export type DegreeLevel = 'bachelor' | 'master' | 'phd' | 'any'
export type Funding = 'full' | 'partial' | 'unknown'
export type Currency = 'EUR' | 'USD'

export const CURRENCIES: Currency[] = ['EUR', 'USD']

export interface Opportunity {
  id: string
  kind: Kind
  title: string
  country: string | null
  org: string | null
  url: string | null
  opens_on: string | null
  closes_on: string | null
  parent_id: string | null
  degree_level: DegreeLevel | null
  funding: Funding | null
  application_fee: number | null
  fee_currency: Currency | null
  notes: string | null
  added_by: string | null
  is_archived: boolean
  created_at: string
  updated_at: string
}

/** The other end of a link, as rendered in lists and reminders. */
export interface LinkedEntry {
  id: string
  title: string
  country: string | null
  url: string | null
  opens_on: string | null
  closes_on: string | null
}

export interface OpportunityRow extends Opportunity {
  /**
   * On a scholarship: every admission that qualifies you for it — hold any
   * one of them and you are eligible.
   * On an admission: every scholarship it unlocks.
   */
  links: LinkedEntry[]
}

/** A pickable entry in the "link to…" multi-select. */
export interface LinkOption {
  id: string
  kind: Kind
  title: string
  country: string | null
  closes_on: string | null
}

export interface Member {
  id: string
  telegram_username: string | null
  telegram_user_id: string | null
  chat_id: string | null
  display_name: string | null
  is_admin: boolean
  status: MemberStatus
  created_at: string
  linked_at: string | null
}

const SYMBOL: Record<Currency, string> = { EUR: '€', USD: '$' }

/** "€75", "$0 — free", or null when nobody has recorded a fee. */
export function formatFee(
  amount: number | null | undefined,
  currency: Currency | null | undefined,
): string | null {
  if (amount === null || amount === undefined) return null
  const n = Number(amount)
  if (!Number.isFinite(n)) return null
  if (n === 0) return 'Free'
  const shown = Number.isInteger(n) ? String(n) : n.toFixed(2)
  return (SYMBOL[currency ?? 'EUR'] ?? '') + shown
}

export const COUNTRIES = [
  'Germany', 'United States', 'United Kingdom', 'Canada', 'China', 'Japan',
  'South Korea', 'Italy', 'France', 'Netherlands', 'Sweden', 'Norway',
  'Finland', 'Denmark', 'Belgium', 'Austria', 'Switzerland', 'Ireland',
  'Spain', 'Portugal', 'Poland', 'Czechia', 'Hungary', 'Turkey', 'Russia',
  'Australia', 'New Zealand', 'India', 'Malaysia', 'Singapore', 'Hong Kong',
  'Taiwan', 'UAE', 'Saudi Arabia', 'Qatar', 'Egypt', 'South Africa',
  'Rwanda', 'Kenya', 'Ghana', 'Morocco', 'Brazil', 'Mexico', 'Chile',
  'Hungary (Stipendium)', 'Multiple / Global',
] as const
