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

-- ---------- opportunities (shared pool, self-referencing) ----------
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
--   open ladder : T-7, T-2, day-of
--   close ladder: T-14, T-7, T-3, T-1, day-of
--   nag         : every 3rd day while the window is open
-- Stops on 'applied' / 'skipped'. Respects snooze. Never repeats a tag.
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
      and (o.closes_on is null or o.closes_on >= p_today)
  ),
  candidates as (
    select b.member_id, b.chat_id, b.opportunity_id,
           'open-'  || (b.opens_on  - p_today)::text as tag, 'opens'  as reason
      from base b
     where b.opens_on is not null and (b.opens_on - p_today) in (7,2,0)
    union all
    select b.member_id, b.chat_id, b.opportunity_id,
           'close-' || (b.closes_on - p_today)::text, 'closes'
      from base b
     where b.closes_on is not null and (b.closes_on - p_today) in (14,7,3,1,0)
    union all
    select b.member_id, b.chat_id, b.opportunity_id,
           'nag-' || p_today::text, 'nag'
      from base b
     where b.opens_on is not null and b.closes_on is not null
       and p_today > b.opens_on and p_today < b.closes_on
       and ((p_today - b.opens_on) % 3) = 0
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
alter table members       enable row level security;
alter table opportunities enable row level security;
alter table applications  enable row level security;
alter table reminders_sent enable row level security;
