import seedLeads from '@/db/batch-001.json'

/**
 * DDL, split into individual statements because the Neon HTTP driver runs one per call.
 * Every statement is `if not exists`, so running this on each cold start is a no-op once
 * the tables are there.
 */
export const SCHEMA_STATEMENTS: string[] = [
  `create table if not exists leads (
    id text primary key,
    batch text not null default 'Unfiled',
    seq integer,
    company text not null,
    loc text not null default '',
    geo text not null default 'us',
    site text not null default '',
    biz text not null default '',
    who text not null default '',
    role text not null default '',
    email text not null default '',
    estat text not null default 'UNKNOWN',
    phone text not null default '',
    pstat text not null default 'UNKNOWN',
    channel text not null default 'email',
    opp integer not null default 3,
    buy integer not null default 0,
    conf text not null default 'MEDIUM',
    why text not null default '',
    good text not null default '',
    prob text not null default '',
    signals text not null default '',
    recent text not null default '',
    angle text not null default '',
    owner text not null default '',
    sender text not null default '',
    tmpl text not null default '',
    subj text not null default '',
    mail text not null default '',
    script text not null default '',
    note text not null default '',
    status text not null default 'Not sent',
    date_sent date,
    reply text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by text not null default '',
    updated_by text not null default ''
  )`,
  `create index if not exists leads_batch_idx on leads (batch, seq)`,
  `create index if not exists leads_status_idx on leads (status)`,
  `create index if not exists leads_owner_idx on leads (owner)`,
  `create index if not exists leads_geo_idx on leads (geo)`,
  `create table if not exists activity (
    id bigserial primary key,
    lead_id text,
    who text not null,
    action text not null,
    at timestamptz not null default now()
  )`,
  `create index if not exists activity_at_idx on activity (at desc)`,
  `create index if not exists activity_lead_idx on activity (lead_id)`,
]

/** Marker written to `activity` once Batch 001 has been loaded. */
export const SEED_MARKER = 'seeded Batch 001'

export const SEED_LEADS = seedLeads as Record<string, unknown>[]
