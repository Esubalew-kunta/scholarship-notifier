-- ============================================================
-- Scholarship & Admission Tracker — schema
-- Safe to re-run (idempotent).
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- members (identity = telegram, no web auth) ----------
create table if not exists members (
  id                uuid primary key default gen_random_uuid(),
  telegram_username text unique,                 -- stored lowercase, without '@'
  telegram_user_id  bigint unique,
  chat_id           bigint,
  display_name      text,
  is_admin          boolean not null default false,
  status            text not null default 'pending'
                    check (status in ('pending','active','blocked')),
  created_at        timestamptz not null default now(),
  linked_at         timestamptz
);

-- ---------- opportunities (shared pool) ----------
create table if not exists opportunities (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('admission','scholarship')),
  title        text not null,
  country      text,
  org          text,
  url          text,
  opens_on     date,
  closes_on    date,
  parent_id    uuid references opportunities(id) on delete set null,
  degree_level text check (degree_level in ('bachelor','master','phd','any')),
  funding      text check (funding in ('full','partial','unknown')),
  notes        text,
  added_by     text,
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

do $$ begin
  alter table opportunities
    add constraint parent_only_for_scholarship
    check (parent_id is null or kind = 'scholarship');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table opportunities
    add constraint dates_ordered
    check (opens_on is null or closes_on is null or closes_on >= opens_on);
exception when duplicate_object then null; end $$;

create index if not exists opportunities_parent_idx  on opportunities(parent_id);
create index if not exists opportunities_closes_idx  on opportunities(closes_on);
create index if not exists opportunities_opens_idx   on opportunities(opens_on);
create index if not exists opportunities_kind_idx    on opportunities(kind);

-- ---------- application fee ----------
-- What it costs to submit. Deliberately separate from `funding`, which is
-- about what you get back, not what you pay to be considered.
alter table opportunities add column if not exists application_fee numeric(10,2);
alter table opportunities add column if not exists fee_currency    text;

do $$ begin
  alter table opportunities add constraint fee_currency_allowed
    check (fee_currency is null or fee_currency in ('EUR','USD'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table opportunities add constraint fee_non_negative
    check (application_fee is null or application_fee >= 0);
exception when duplicate_object then null; end $$;

-- ============================================================
-- admission  <->  scholarship  : many-to-many
--
-- One admission unlocks several scholarships (a Verona offer makes you
-- eligible for the merit award, the regional grant and IYT at once), and one
-- national scholarship accepts applicants holding any of several admissions.
-- The old single `parent_id` column could express neither, so this table
-- supersedes it. The column is left in place, unread, so nothing is lost.
-- ============================================================
create table if not exists opportunity_links (
  admission_id   uuid not null references opportunities(id) on delete cascade,
  scholarship_id uuid not null references opportunities(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (admission_id, scholarship_id),
  constraint link_not_self check (admission_id <> scholarship_id)
);

create index if not exists opportunity_links_scholarship_idx
  on opportunity_links(scholarship_id);

-- Each end has to be the right kind. That spans two rows, so it needs a
-- trigger rather than a check constraint.
create or replace function check_link_kinds() returns trigger
language plpgsql as $$
declare
  a_kind text;
  s_kind text;
begin
  select kind into a_kind from opportunities where id = new.admission_id;
  select kind into s_kind from opportunities where id = new.scholarship_id;
  if a_kind is distinct from 'admission' then
    raise exception 'admission_id must point at an admission';
  end if;
  if s_kind is distinct from 'scholarship' then
    raise exception 'scholarship_id must point at a scholarship';
  end if;
  return new;
end $$;

drop trigger if exists opportunity_links_kinds on opportunity_links;
create trigger opportunity_links_kinds
  before insert or update on opportunity_links
  for each row execute function check_link_kinds();

-- Carry the old one-parent links across. Runs once; the conflict clause makes
-- a re-run a no-op.
insert into opportunity_links (admission_id, scholarship_id)
select o.parent_id, o.id
  from opportunities o
  join opportunities p on p.id = o.parent_id and p.kind = 'admission'
 where o.parent_id is not null and o.kind = 'scholarship'
on conflict do nothing;

-- ---------- per-member application status ----------
create table if not exists applications (
  member_id      uuid not null references members(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  status         text not null default 'watching'
                 check (status in ('watching','applied','skipped')),
  snooze_until   date,
  updated_at     timestamptz not null default now(),
  primary key (member_id, opportunity_id)
);

-- ---------- idempotency ledger for reminders ----------
create table if not exists reminders_sent (
  member_id      uuid not null references members(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  tag            text not null,
  sent_at        timestamptz not null default now(),
  primary key (member_id, opportunity_id, tag)
);

-- ---------- updated_at trigger ----------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists opportunities_touch on opportunities;
create trigger opportunities_touch before update on opportunities
  for each row execute function touch_updated_at();

drop trigger if exists applications_touch on applications;
create trigger applications_touch before update on applications
  for each row execute function touch_updated_at();

-- ============================================================
-- Reminder engine
--
-- One message a day for every entry whose window is open — from the opening
-- date through to the closing date — stopping only when the member taps
-- "Applied" or "Not for me", or snoozes. Plus a single heads-up a week before
-- an entry opens, so nothing appears out of nowhere.
--
-- A day's message is tagged with that date, so reminders_sent guarantees at
-- most one per member per entry per day even if the sweep runs twice.
-- ============================================================
create or replace function due_reminders(p_today date)
returns table (
  member_id      uuid,
  chat_id        bigint,
  opportunity_id uuid,
  tag            text,
  reason         text
) language sql stable as $$
  with base as (
    select m.id as member_id, m.chat_id, o.id as opportunity_id,
           o.opens_on, o.closes_on
    from members m
    cross join opportunities o
    left join applications a
           on a.member_id = m.id and a.opportunity_id = o.id
    where m.status = 'active'
      and m.chat_id is not null
      and o.is_archived = false
      and coalesce(a.status, 'watching') = 'watching'
      and (a.snooze_until is null or a.snooze_until <= p_today)
  ),
  candidates as (
    -- every day from the opening date to the closing date
    select b.member_id, b.chat_id, b.opportunity_id,
           'day-' || p_today::text as tag, 'window' as reason
      from base b
     where (b.opens_on is not null or b.closes_on is not null)
       and (b.opens_on  is null or b.opens_on  <= p_today)
       and (b.closes_on is null or b.closes_on >= p_today)
    union all
    -- one warning shot, a week out
    select b.member_id, b.chat_id, b.opportunity_id,
           'opens-soon', 'opens'
      from base b
     where b.opens_on is not null
       and (b.opens_on - p_today) = 7
  )
  select c.member_id, c.chat_id, c.opportunity_id, c.tag, c.reason
    from candidates c
   where not exists (
     select 1 from reminders_sent r
      where r.member_id = c.member_id
        and r.opportunity_id = c.opportunity_id
        and r.tag = c.tag
   );
$$;

-- ============================================================
-- Lock the anon key out completely.
-- Every read/write goes through our server routes (service credentials).
-- RLS enabled with zero policies == deny-all for anon & authenticated.
-- ============================================================
alter table members           enable row level security;
alter table opportunities     enable row level security;
alter table opportunity_links enable row level security;
alter table applications      enable row level security;
alter table reminders_sent    enable row level security;
