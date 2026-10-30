import { q } from './db'
import { CONTACT_EVENTS } from './crm'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export const REPORT_DEFINITIONS: Record<string, string> = {
  researched: 'Leads added in the period (research imported or entered by hand).',
  contacted: 'Leads with their first outreach action in the period. Drafts never count.',
  replied: 'Leads with a reply logged in the period.',
  meetings: 'Leads with a meeting booked in the period.',
  proposals: 'Leads with a proposal sent in the period.',
  won: 'Leads marked won in the period.',
  emails_sent: 'Emails and follow-ups actually sent in the period.',
  calls: 'Calls attempted, voicemails and connected calls in the period. Connected calls are also shown on their own.',
  reply_rate: 'Leads that replied ÷ leads first emailed in the period. Replies to emails sent before the period are not counted.',
  win_rate: 'Won ÷ (won + closed) for leads closed in the period. Closed as "No fit" before any contact is excluded, since those were never pitched.',
  cycle: 'Days from a lead being added to being won, for leads won in the period.',
  tracking: 'Dated events only exist from the migration onward. Earlier activity is visible in current-stage counts but not in these period figures.',
}

/**
 * Period reports from the event timeline. Everything here counts something that was
 * recorded as happening, on the day it happened — no inference from current status.
 */
export async function getReport(fromRaw?: string, toRaw?: string) {
  const to = toRaw && ISO_DAY.test(toRaw) ? toRaw : new Date().toISOString().slice(0, 10)
  const from = fromRaw && ISO_DAY.test(fromRaw) ? fromRaw : new Date(Date.parse(to) - 29 * 864e5).toISOString().slice(0, 10)
  const range = [from, to]
  // occurred_at falls on [from, to] inclusive of the whole last day.
  const inRange = `e.occurred_at >= $1::date and e.occurred_at < ($2::date + 1)`

  const [funnel] = await q<Record<string, number>>(
    `with ev as (select * from events e where e.voided_at is null and e.lead_id is not null)
     select
       (select count(*) from leads where created_at >= $1::date and created_at < ($2::date + 1))::int as researched,
       (select count(*) from (select lead_id, min(occurred_at) as first from ev where type = any($3::text[]) group by lead_id) f
         where f.first >= $1::date and f.first < ($2::date + 1))::int as contacted,
       (select count(distinct lead_id) from ev e where type = 'reply_received' and ${inRange})::int as replied,
       (select count(distinct lead_id) from ev e where type = 'meeting_booked' and ${inRange})::int as meetings,
       (select count(distinct lead_id) from ev e where type = 'proposal_sent' and ${inRange})::int as proposals,
       (select count(distinct lead_id) from ev e where type = 'won' and ${inRange})::int as won`,
    [...range, CONTACT_EVENTS]
  )

  const [outreach] = await q<Record<string, number>>(
    `select
       count(*) filter (where type = 'email_sent')::int as emails,
       count(*) filter (where type = 'followup_sent')::int as followups,
       count(*) filter (where type in ('call_attempted','voicemail','call_connected'))::int as calls,
       count(*) filter (where type = 'call_connected')::int as calls_connected,
       count(*) filter (where type = 'message_sent')::int as messages,
       count(*) filter (where type = 'email_drafted')::int as drafts,
       count(*) filter (where type = 'reply_received')::int as replies,
       count(*) filter (where type = 'reply_received' and meta->>'kind' in ('interested','question'))::int as interested_replies
     from events e where e.voided_at is null and ${inRange}`,
    range
  )

  // Reply rate after the first email vs after the follow-up, for leads first emailed in
  // the period. A reply is credited to the follow-up only if one had gone out before it.
  const [replyRates] = await q<Record<string, number>>(
    `with first_email as (
       select lead_id, min(occurred_at) as at from events
        where voided_at is null and type = 'email_sent' group by lead_id
     ), cohort as (
       select * from first_email where at >= $1::date and at < ($2::date + 1)
     ), first_reply as (
       select e.lead_id, min(e.occurred_at) as at from events e join cohort c on c.lead_id = e.lead_id
        where e.voided_at is null and e.type = 'reply_received' and e.occurred_at >= c.at group by e.lead_id
     ), followed as (
       select e.lead_id, min(e.occurred_at) as at from events e join cohort c on c.lead_id = e.lead_id
        where e.voided_at is null and e.type = 'followup_sent' group by e.lead_id
     )
     select
       (select count(*) from cohort)::int as emailed,
       (select count(*) from first_reply)::int as replied,
       (select count(*) from first_reply r left join followed f on f.lead_id = r.lead_id where f.at is null or r.at < f.at)::int as replied_before_followup,
       (select count(*) from first_reply r join followed f on f.lead_id = r.lead_id where r.at >= f.at)::int as replied_after_followup,
       (select count(*) from followed)::int as followed_up`,
    range
  )

  const byDimension = (column: string) => q(
    // column is one of three fixed names below, never input.
    `with first_contact as (
       select lead_id, min(occurred_at) as at from events
        where voided_at is null and type = any($3::text[]) group by lead_id
     )
     select coalesce(nullif(l.${column}, ''), '(none)') as key,
            count(*)::int as contacted,
            count(*) filter (where exists (select 1 from events e where e.lead_id = l.id and e.voided_at is null and e.type = 'reply_received'))::int as replied,
            count(*) filter (where exists (select 1 from events e where e.lead_id = l.id and e.voided_at is null and e.type = 'meeting_booked'))::int as meetings,
            count(*) filter (where l.stage = 'won')::int as won
       from first_contact fc join leads l on l.id = fc.lead_id
      where fc.at >= $1::date and fc.at < ($2::date + 1)
      group by 1 order by contacted desc`,
    [...range, CONTACT_EVENTS]
  )
  const [byTemplate, byGeo, byOwner] = await Promise.all([byDimension('tmpl'), byDimension('geo'), byDimension('owner')])

  const [closing] = await q<Record<string, number | string | null>>(
    `with closed as (
       select e.lead_id, e.type, e.meta->>'reason' as reason, e.occurred_at from events e
        where e.voided_at is null and e.type in ('won','lost') and ${inRange}
     )
     select
       count(*) filter (where type = 'won')::int as won,
       count(*) filter (where type = 'lost' and not (reason = 'no_fit' and not exists (
         select 1 from events c where c.lead_id = closed.lead_id and c.voided_at is null and c.type = any($3::text[]))))::int as lost_pitched,
       round(avg(extract(epoch from (occurred_at - (select created_at from leads where id = closed.lead_id))) / 86400)
             filter (where type = 'won'))::int as avg_cycle_days,
       (select count(distinct w.lead_id) from closed w where w.type = 'won'
          and exists (select 1 from events p where p.lead_id = w.lead_id and p.type = 'proposal_sent' and p.voided_at is null))::int as won_with_proposal
     from closed`,
    [...range, CONTACT_EVENTS]
  )

  const wonRevenue = await q(
    `select l.currency, sum(l.deal_value) as amount, count(*)::int as count,
            count(*) filter (where l.deal_value is null)::int as without_value
       from events e join leads l on l.id = e.lead_id
      where e.voided_at is null and e.type = 'won' and ${inRange}
      group by l.currency`,
    range
  )
  const byPackage = await q(
    `select coalesce(nullif(l.package, ''), '(none)') as package, l.currency, count(*)::int as count, sum(l.deal_value) as amount
       from events e join leads l on l.id = e.lead_id
      where e.voided_at is null and e.type = 'won' and ${inRange}
      group by 1, 2 order by 3 desc`,
    range
  )
  const lostReasons = await q(
    `select coalesce(e.meta->>'reason', 'unspecified') as reason, count(*)::int as count
       from events e where e.voided_at is null and e.type = 'lost' and ${inRange}
      group by 1 order by 2 desc`,
    range
  )

  const [tasks] = await q<Record<string, number>>(
    `select
       count(*) filter (where status = 'done' and done_at >= $1::date and done_at < ($2::date + 1))::int as completed,
       count(*) filter (where status = 'done' and done_at >= $1::date and done_at < ($2::date + 1)
                          and (due_on is null or done_at::date <= due_on))::int as on_time,
       count(*) filter (where status = 'open' and due_on < current_date and $2::date is not null)::int as overdue_now
     from tasks`,
    range
  )

  const [{ tracking_since }] = await q<{ tracking_since: string | null }>(
    `select min(applied_at) as tracking_since from schema_migrations where version = 1`
  )

  return {
    from, to, tracking_since,
    funnel, outreach, replyRates, byTemplate, byGeo, byOwner, closing, wonRevenue, byPackage, lostReasons, tasks,
    definitions: REPORT_DEFINITIONS,
  }
}
