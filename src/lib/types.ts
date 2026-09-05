export type Kind = 'admission' | 'scholarship'
export type AppStatus = 'watching' | 'applied' | 'skipped'
export type MemberStatus = 'pending' | 'active' | 'blocked'
export type DegreeLevel = 'bachelor' | 'master' | 'phd' | 'any'
export type Funding = 'full' | 'partial' | 'unknown'

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
  notes: string | null
  added_by: string | null
  is_archived: boolean
  created_at: string
  updated_at: string
}

export interface OpportunityRow extends Opportunity {
  parent_title: string | null
  parent_closes_on: string | null
  child_count: number
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
