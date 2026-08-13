-- Aster Lead Engine schema.
-- Safe to run more than once.

create table if not exists leads (
  id            text primary key,
  batch         text        not null default 'Unfiled',
  seq           integer,

  company       text        not null,
  loc           text        not null default '',
  geo           text        not null default 'us',
  site          text        not null default '',
  biz           text        not null default '',

  who           text        not null default '',
  role          text        not null default '',
  email         text        not null default '',
  estat         text        not null default 'UNKNOWN',
  phone         text        not null default '',
  pstat         text        not null default 'UNKNOWN',
  channel       text        not null default 'email',

  opp           integer     not null default 3,
  buy           integer     not null default 0,
  conf          text        not null default 'MEDIUM',

  why           text        not null default '',
  good          text        not null default '',
  prob          text        not null default '',
  signals       text        not null default '',
  recent        text        not null default '',
  angle         text        not null default '',

  owner         text        not null default '',
  sender        text        not null default '',
  tmpl          text        not null default '',
  subj          text        not null default '',
  mail          text        not null default '',
  script        text        not null default '',
  note          text        not null default '',

  status        text        not null default 'Not sent',
  date_sent     date,
  reply         text        not null default '',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    text        not null default '',
  updated_by    text        not null default ''
);

create index if not exists leads_batch_idx  on leads (batch, seq);
create index if not exists leads_status_idx on leads (status);
create index if not exists leads_owner_idx  on leads (owner);
create index if not exists leads_geo_idx    on leads (geo);

-- Append-only. Who changed what, so a shared list stays accountable.
create table if not exists activity (
  id       bigserial   primary key,
  lead_id  text,
  who      text        not null,
  action   text        not null,
  at       timestamptz not null default now()
);

create index if not exists activity_at_idx      on activity (at desc);
create index if not exists activity_lead_idx    on activity (lead_id);
