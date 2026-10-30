import { q } from './db'
import { getSettings } from './settings'
import { CONTACT_EVENTS, STAGE_KEYS, todayLocal } from './crm'
import { FORMER_NAMES } from './constants'

/**
 * Definitions shown next to every number, so nobody has to guess what one means. They
 * are the contract: if a query below stops matching its sentence, the query is wrong.
 */
export const METRIC_DEFINITIONS: Record<string, string> = {
  active: 'Leads not yet won or closed, including ones not contacted yet.',
  qualified: 'Every lead except those closed as "No fit". Research already qualified them before they entered the app.',
  contacted: 'Leads with at least one outreach action actually performed: an email or follow-up sent, a call attempted or connected, a voicemail, or a message. Drafts and stage moves do not count. Includes leads whose old status proved contact before events were recorded.',
  replied: 'Leads that replied: a logged reply, or an old status of Replied, Meeting booked or Won at migration.',
  meetings: 'Leads with a meeting booked: a logged booking, or an old status of Meeting booked at migration.',
  proposals: 'Leads with at least one proposal logged as sent.',
  won: 'Leads at the Won stage. Won means agreed. It does not mean paid; see deposit status.',
  pipeline_value: 'Sum of deal values on open leads (Engaged onward), per currency. Never converted between currencies.',
  pipeline_estimate: 'Open leads with a package but no deal value, priced at the package reference price. An estimate, not a quote.',
  won_value: 'Sum of deal values on won leads, per currency. Contract value, not cash collected.',
}

type Money = { currency: string; amount: number; count: number }

function money(rows: { currency: string; amount: string | number; count: number }[]): Money[] {
  return rows.map((r) => ({ currency: r.currency, amount: Number(r.amount), count: Number(r.count) }))
}

export async function getDashboard(me: string, opts: { today?: string; scope?: 'mine' | 'team' } = {}) {
  const today = opts.today && /^\d{4}-\d{2}-\d{2}$/.test(opts.today) ? opts.today : todayLocal()
  const settings = await getSettings()
  const mine = opts.scope !== 'team'

  // $1 is always today and $2 the signed-in person, when scoped to them. Every query
  // mentions $1 (Postgres rejects a bound parameter that a statement never uses).
  const taskParams = mine ? [today, me] : [today]
  const taskSelect = `select t.id, t.title, t.type, t.owner, t.due_on, t.due_time, t.priority, t.lead_id,
                             l.company, l.stage, l.who as contact,
                             (t.due_on < $1::date) as overdue
                        from tasks t left join leads l on l.id = t.lead_id
                       where t.status = 'open' and (l.id is null or l.deleted_at is null) ${mine ? 'and t.owner = $2' : ''}`

  const [overdue, dueToday, upcoming, replies, meetings] = await Promise.all([
    q(`${taskSelect} and t.due_on < $1 order by t.due_on, t.id limit 100`, taskParams),
    q(`${taskSelect} and t.due_on = $1 order by case t.priority when 'high' then 0 when 'normal' then 1 else 2 end, t.due_time, t.id`, taskParams),
    q(`${taskSelect} and t.due_on > $1 and t.due_on <= ($1::date + 7) and t.type not in ('meeting') order by t.due_on, t.id limit 50`, taskParams),
    q(`${taskSelect} and t.type = 'reply' order by t.due_on, t.id`, taskParams),
    q(`${taskSelect} and t.type = 'meeting' and (t.due_on is null or t.due_on >= $1) order by t.due_on nulls first, t.due_time limit 20`, taskParams),
  ])

  const ownerFilter = mine ? 'and l.owner = $1' : ''
  const ownerParam = mine ? [me] : []

  const [noNextStep, proposals, stalled, staleResearch, reassign, worthFounder] = await Promise.all([
    q(`select l.id, l.company, l.stage, l.owner, l.who, l.stage_changed_at
         from leads l
        where l.deleted_at is null and not l.do_not_contact
          and l.stage in ('outreach','engaged','meeting','mockup','proposal')
          and not exists (select 1 from tasks t where t.lead_id = l.id and t.status = 'open') ${ownerFilter}
        order by array_position(array['proposal','mockup','meeting','engaged','outreach']::text[], l.stage), l.stage_changed_at nulls last
        limit 50`, ownerParam),
    q(`select l.id, l.company, l.owner, l.proposal_sent_on, l.proposal_amount, l.currency, l.package, l.proposal_url
         from leads l where l.deleted_at is null and l.stage = 'proposal' ${ownerFilter}
        order by l.proposal_sent_on nulls first`, ownerParam),
    q(`select l.id, l.company, l.stage, l.owner, la.last_at
         from leads l
         left join lateral (select max(e.occurred_at) as last_at from events e
                             where e.lead_id = l.id and e.voided_at is null and e.type not in ('migrated')) la on true
        where l.deleted_at is null and l.stage in ('engaged','meeting','mockup','proposal')
          and coalesce(la.last_at, l.stage_changed_at, l.updated_at) < now() - ($${mine ? 2 : 1} || ' days')::interval ${ownerFilter}
        order by la.last_at nulls first limit 30`, [...ownerParam, String(settings.stale_after_days)]),
    q(`select count(*)::int as n from leads l
        where l.deleted_at is null and l.stage = 'new' and not l.do_not_contact
          and l.researched_on < ($${mine ? 2 : 1}::date - $${mine ? 3 : 2}::int) ${ownerFilter}`,
      [...ownerParam, today, settings.research_max_age_days]),
    q(`select l.id, l.company, l.owner, l.stage from leads l
        where l.deleted_at is null and l.owner = any($1::text[]) and l.stage not in ('won','lost')
        order by l.company`, [FORMER_NAMES]),
    q(`select l.id, l.company, l.owner, l.stage from leads l
        where l.deleted_at is null and l.stage not in ('won','lost')
          and (l.note ilike '%worth shine%' or l.priority = 'high')
        order by l.priority desc, l.company limit 20`),
  ])

  return {
    today,
    scope: mine ? 'mine' : 'team',
    attention: {
      overdue, dueToday, upcoming, replies, meetings, noNextStep, proposals, stalled,
      staleResearch: (staleResearch[0] as { n: number })?.n ?? 0,
      reassign,
    },
    founder: { worthFounder, proposals, stalled },
    overview: await getOverview(),
    pipeline: await getPipelineSummary(),
    team: await getTeamSummary(today),
    settings: { monthly_capacity: settings.monthly_capacity, stale_after_days: settings.stale_after_days },
    definitions: METRIC_DEFINITIONS,
  }
}

/** Whole-history counts, per the definitions above. */
export async function getOverview() {
  const [row] = await q<Record<string, number>>(
    `with contact as (
       select distinct lead_id from events
        where voided_at is null and type = any($1::text[]) and lead_id is not null
     ),
     legacy as (
       select lead_id, meta->>'legacy_status' as s from events where type = 'migrated'
     )
     select
       count(*) filter (where l.stage not in ('won','lost'))::int as active,
       count(*) filter (where not (l.stage = 'lost' and l.lost_reason = 'no_fit'))::int as qualified,
       count(*) filter (where l.legacy_contacted or c.lead_id is not null)::int as contacted,
       count(*) filter (where exists (select 1 from events e where e.lead_id = l.id and e.voided_at is null and e.type = 'reply_received')
                          or lg.s in ('Replied','Meeting booked','Won'))::int as replied,
       count(*) filter (where exists (select 1 from events e where e.lead_id = l.id and e.voided_at is null and e.type = 'meeting_booked')
                          or lg.s = 'Meeting booked')::int as meetings,
       count(*) filter (where exists (select 1 from events e where e.lead_id = l.id and e.voided_at is null and e.type = 'proposal_sent'))::int as proposals,
       count(*) filter (where l.stage = 'won')::int as won,
       count(*)::int as total
     from leads l
     left join contact c on c.lead_id = l.id
     left join legacy lg on lg.lead_id = l.id
     where l.deleted_at is null`,
    [CONTACT_EVENTS]
  )

  const settings = await getSettings()
  const [pipelineValue, wonValue, estimate] = await Promise.all([
    q<{ currency: string; amount: string; count: number }>(
      `select currency, sum(deal_value) as amount, count(*)::int as count from leads
        where deleted_at is null and stage in ('engaged','meeting','mockup','proposal') and deal_value is not null
        group by currency order by currency`),
    q<{ currency: string; amount: string; count: number }>(
      `select currency, sum(deal_value) as amount, count(*)::int as count from leads
        where deleted_at is null and stage = 'won' and deal_value is not null
        group by currency order by currency`),
    q<{ package: string; count: number }>(
      `select package, count(*)::int as count from leads
        where deleted_at is null and stage in ('engaged','meeting','mockup','proposal') and deal_value is null and package <> ''
        group by package`),
  ])

  const est: Record<string, Money> = {}
  for (const r of estimate) {
    const p = settings.packages.find((x) => x.key === r.package)
    if (!p) continue
    est[p.currency] ??= { currency: p.currency, amount: 0, count: 0 }
    est[p.currency].amount += p.amount * r.count
    est[p.currency].count += r.count
  }

  const [noValue] = await q<{ n: number }>(
    `select count(*)::int as n from leads where deleted_at is null and stage = 'won' and deal_value is null`
  )

  return {
    counts: row,
    pipelineValue: money(pipelineValue),
    pipelineEstimate: Object.values(est),
    wonValue: money(wonValue),
    wonWithoutValue: noValue?.n ?? 0,
  }
}

export async function getPipelineSummary() {
  const rows = await q<{ stage: string; count: number; currency: string | null; amount: string | null }>(
    `select stage, count(*)::int as count, currency, sum(deal_value) as amount
       from leads where deleted_at is null
      group by stage, currency`
  )
  return STAGE_KEYS.map((stage) => {
    const here = rows.filter((r) => r.stage === stage)
    return {
      stage,
      count: here.reduce((a, r) => a + r.count, 0),
      value: here.filter((r) => r.amount !== null).map((r) => ({ currency: r.currency ?? 'USD', amount: Number(r.amount) })),
    }
  })
}

/** Workload, not surveillance: what each person has on, and what's slipping. */
export async function getTeamSummary(today: string) {
  return q(
    `with owners as (
       select owner from leads where deleted_at is null and owner <> '' and stage not in ('won','lost')
       union select owner from tasks where status = 'open' and owner <> ''
     )
     select o.owner,
       (select count(*) from leads l where l.deleted_at is null and l.owner = o.owner and l.stage not in ('won','lost'))::int as active,
       (select count(*) from tasks t where t.owner = o.owner and t.status = 'open')::int as open_tasks,
       (select count(*) from tasks t where t.owner = o.owner and t.status = 'open' and t.due_on < $1)::int as overdue,
       (select count(*) from tasks t where t.owner = o.owner and t.status = 'done' and t.done_at > now() - interval '7 days')::int as done_7d,
       (select count(*) from events e where e.who = o.owner and e.voided_at is null and e.source in ('manual','status')
          and e.occurred_at > now() - interval '7 days')::int as logged_7d
     from owners o order by active desc, o.owner`,
    [today]
  )
}
