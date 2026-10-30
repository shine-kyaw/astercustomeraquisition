-- 001 — CRM foundation.
--
-- Additive only: no column is dropped, renamed or retyped, and the legacy `status` column
-- keeps working, because the aster-lead-engine skill reads and PATCHes it. Code from before
-- this migration keeps running against the migrated schema.
--
-- Run with `npm run db:migrate`, never automatically. The runner applies every statement
-- below in one transaction and records the version in schema_migrations, so a failure
-- leaves the database exactly as it was.
--
-- Statement separator: a semicolon at the end of a line. Don't put one at a line end
-- inside a string literal.

create table if not exists schema_migrations (
  version     integer primary key,
  name        text        not null,
  applied_at  timestamptz not null default now(),
  applied_by  text        not null default ''
);

-- ── The opportunity, on the lead ────────────────────────────────────────────────────────
-- One row per company, one current deal per company. A separate opportunities table would
-- only earn its keep once a company buys twice; until then it doubles every query.

alter table leads add column if not exists stage            text        not null default 'new';
alter table leads add column if not exists stage_changed_at timestamptz;
alter table leads add column if not exists lost_reason      text        not null default '';
alter table leads add column if not exists priority         text        not null default 'normal';
alter table leads add column if not exists deal_value       numeric(14,2);
alter table leads add column if not exists currency         text        not null default 'USD';
alter table leads add column if not exists package          text        not null default '';
alter table leads add column if not exists expected_close   date;
alter table leads add column if not exists next_step        text        not null default '';
alter table leads add column if not exists source           text        not null default '';

-- Suppression: once someone says stop, nothing may schedule outreach to them again.
alter table leads add column if not exists do_not_contact   boolean     not null default false;
alter table leads add column if not exists dnc_reason       text        not null default '';
alter table leads add column if not exists dnc_at           timestamptz;

-- Research freshness: the skill re-verifies any claim older than 14 days before sending.
alter table leads add column if not exists researched_on    date;
alter table leads add column if not exists verified_on      date;

alter table leads add column if not exists mockup_status    text        not null default '';
alter table leads add column if not exists mockup_url       text        not null default '';
alter table leads add column if not exists mockup_due       date;
alter table leads add column if not exists proposal_status  text        not null default '';
alter table leads add column if not exists proposal_url     text        not null default '';
alter table leads add column if not exists proposal_amount  numeric(14,2);
alter table leads add column if not exists proposal_sent_on date;
alter table leads add column if not exists proposal_version integer;

-- Won-deal handoff to delivery.
alter table leads add column if not exists deposit_status   text        not null default '';
alter table leads add column if not exists project_owner    text        not null default '';
alter table leads add column if not exists deadline         date;
alter table leads add column if not exists handoff_notes    text        not null default '';

-- Snapshot taken here, once: did the legacy status prove an actual outreach touch?
-- Reports use it for leads contacted before events were recorded. "No fit" never counts —
-- that status is set on leads that were never emailed — and neither does a "Dead" lead
-- with no contact date.
alter table leads add column if not exists legacy_contacted boolean     not null default false;

-- Soft delete. A deleted lead still blocks re-import and stays on the exclusion list,
-- so deleting a lead can never cause it to be researched and pitched again.
alter table leads add column if not exists deleted_at       timestamptz;
alter table leads add column if not exists deleted_by       text        not null default '';

create index if not exists leads_stage_idx   on leads (stage) where deleted_at is null;
create index if not exists leads_updated_idx on leads (updated_at desc);

-- ── Timeline ────────────────────────────────────────────────────────────────────────────
-- What happened, one row per thing. Distinct from `activity`, which audits edits.
-- lead_id is nullable with ON DELETE SET NULL so history survives even a hard delete.

create table if not exists events (
  id          bigserial   primary key,
  lead_id     text        references leads (id) on delete set null,
  type        text        not null,
  occurred_at timestamptz not null default now(),
  who         text        not null default '',
  summary     text        not null default '',
  ext_ref     text        not null default '',
  meta        jsonb       not null default '{}'::jsonb,
  source      text        not null default 'manual',
  voided_at   timestamptz,
  voided_by   text        not null default '',
  created_at  timestamptz not null default now(),
  created_by  text        not null default ''
);

create index if not exists events_lead_idx on events (lead_id, occurred_at desc);
create index if not exists events_type_idx on events (type, occurred_at desc);

-- ── Tasks ───────────────────────────────────────────────────────────────────────────────
-- auto_key makes automated tasks idempotent: logging the same send twice can't create a
-- second follow-up reminder.

create table if not exists tasks (
  id               bigserial   primary key,
  lead_id          text        references leads (id) on delete set null,
  title            text        not null,
  type             text        not null default 'other',
  owner            text        not null default '',
  due_on           date,
  due_time         text        not null default '',
  priority         text        not null default 'normal',
  status           text        not null default 'open',
  notes            text        not null default '',
  auto_key         text        unique,
  created_at       timestamptz not null default now(),
  created_by       text        not null default '',
  done_at          timestamptz,
  done_by          text        not null default '',
  cancelled_reason text        not null default ''
);

create index if not exists tasks_open_idx  on tasks (status, due_on);
create index if not exists tasks_owner_idx on tasks (owner, status);
create index if not exists tasks_lead_idx  on tasks (lead_id);

-- ── Ruled out ───────────────────────────────────────────────────────────────────────────
-- Companies researched and rejected. Never deleted: reconsidering one sets revoked_at.

create table if not exists exclusions (
  id             bigserial   primary key,
  company        text        not null,
  domain         text        not null default '',
  reason         text        not null default '',
  category       text        not null default 'other',
  source         text        not null default '',
  reviewed_on    date        not null default current_date,
  reviewed_by    text        not null default '',
  reconsider_if  text        not null default '',
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_by     text        not null default '',
  revoked_reason text        not null default ''
);

create index if not exists exclusions_domain_idx on exclusions (domain);

create table if not exists settings (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  updated_by text        not null default ''
);

-- ── Backfill ────────────────────────────────────────────────────────────────────────────
-- Stage is the lead's current position, read straight off its current status. No dated
-- events are invented: a lead at "Follow-up 1" has no proof of when either touch happened.

update leads set
  stage = case status
    when 'Not sent'       then 'new'
    when 'Emailed'        then 'outreach'
    when 'Called'         then 'outreach'
    when 'Follow-up 1'    then 'outreach'
    when 'Follow-up 2'    then 'outreach'
    when 'Replied'        then 'engaged'
    when 'Meeting booked' then 'meeting'
    when 'Won'            then 'won'
    else 'lost'
  end,
  lost_reason = case status
    when 'No fit' then 'no_fit'
    when 'Dead'   then 'dead'
    else ''
  end,
  stage_changed_at = updated_at,
  legacy_contacted = (
    status in ('Emailed', 'Called', 'Follow-up 1', 'Follow-up 2', 'Replied', 'Meeting booked', 'Won')
    or (status = 'Dead' and date_sent is not null)
  ),
  researched_on = coalesce(researched_on, created_at::date);

-- One marker per lead, dated now (when it happened), saying what was carried over and
-- that earlier contact dates were never recorded.
insert into events (lead_id, type, occurred_at, who, summary, source, meta, created_by)
select
  id,
  'migrated',
  now(),
  'System',
  'Moved onto the pipeline from status "' || status || '"' ||
    case when date_sent is not null then ' (legacy contact date ' || to_char(date_sent, 'YYYY-MM-DD') || ')' else '' end ||
    '. Earlier activity was not recorded as dated events.',
  'migration',
  jsonb_build_object('legacy_status', status, 'date_sent', date_sent, 'owner', owner),
  'System'
from leads;

insert into settings (key, value, updated_by) values
  ('packages', '[{"key":"seed","label":"Seed","amount":350,"currency":"USD"},{"key":"blossom","label":"Blossom","amount":1500,"currency":"USD"},{"key":"bloom","label":"Bloom","amount":3000,"currency":"USD"}]'::jsonb, 'System'),
  ('monthly_capacity', '6'::jsonb, 'System'),
  ('stale_after_days', '14'::jsonb, 'System'),
  ('research_max_age_days', '14'::jsonb, 'System')
on conflict (key) do nothing;
