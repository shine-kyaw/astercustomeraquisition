// Unit tests for the pipeline rules in lib/crm.ts. No database, no server.
//   node --test tests/crm.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planEvent, statusForStage, eventForStatus, statusToStage, addDays, type LeadState } from '../lib/crm.ts'

const lead = (o: Partial<LeadState> = {}): LeadState => ({
  id: 'L1', company: 'Acme', stage: 'new', status: 'Not sent', owner: 'Shine Kyaw', who: 'Dana', phone: '+1 555', ...o,
})
const ev = (type: string, meta: Record<string, unknown> = {}, summary = '') => ({ type, date: '2026-10-30', who: 'Lucas Lin', meta, summary })

test('a draft changes nothing: no stage, no status, no reminders', () => {
  const p = planEvent(lead(), ev('email_drafted'))
  assert.deepEqual(p.lead, {})
  assert.equal(p.createTasks.length, 0)
})

test('first email sent: outreach, Emailed, call on day 1 and follow-up on day 3 (the skill cadence)', () => {
  const p = planEvent(lead(), ev('email_sent'))
  assert.equal(p.lead.stage, 'outreach')
  assert.equal(p.lead.status, 'Emailed')
  assert.equal(p.lead.date_sent, '2026-10-30')
  const call = p.createTasks.find((t) => t.type === 'call')
  const fu = p.createTasks.find((t) => t.type === 'follow_up')
  assert.equal(call?.due_on, '2026-10-31')
  assert.equal(fu?.due_on, '2026-11-02')
  assert.equal(fu?.owner, 'Shine Kyaw', 'reminders go to the lead owner, not whoever logged it')
  assert.equal(p.createTasks.some((t) => /follow-up 2/i.test(t.title)), false, 'there is no second follow-up')
})

test('no phone, no call reminder', () => {
  const p = planEvent(lead({ phone: '' }), ev('email_sent'))
  assert.equal(p.createTasks.some((t) => t.type === 'call'), false)
})

test('a status-driven send never rewrites the status the skill just set', () => {
  const p = planEvent(lead({ status: 'Emailed' }), ev('email_sent'), { statusDriven: true })
  assert.equal(p.lead.status, undefined)
  assert.equal(p.lead.stage, 'outreach')
})

test('follow-up sent: completes the follow-up, schedules a close-out review, no further touch', () => {
  const p = planEvent(lead({ stage: 'outreach', status: 'Emailed' }), ev('followup_sent'))
  assert.equal(p.lead.status, 'Follow-up 1')
  assert.deepEqual(p.completeTypes, ['follow_up'])
  assert.equal(p.createTasks.length, 1)
  assert.equal(p.createTasks[0].type, 'review')
})

test('interested reply: engaged, Replied, cold reminders cancelled, reply task today', () => {
  const p = planEvent(lead({ stage: 'outreach', status: 'Follow-up 1' }), ev('reply_received', { kind: 'interested' }, 'Tell me more'))
  assert.equal(p.lead.stage, 'engaged')
  assert.equal(p.lead.status, 'Replied')
  assert.equal(p.lead.reply, 'Tell me more')
  assert.deepEqual(p.cancel?.types, ['send_email', 'call', 'follow_up', 'review'])
  assert.equal(p.createTasks[0].type, 'reply')
  assert.equal(p.createTasks[0].due_on, '2026-10-30')
})

test('"no / stop" reply: opted out, do-not-contact, every reminder cancelled', () => {
  const p = planEvent(lead({ stage: 'outreach', status: 'Emailed' }), ev('reply_received', { kind: 'no' }))
  assert.equal(p.lead.stage, 'lost')
  assert.equal(p.lead.lost_reason, 'opted_out')
  assert.equal(p.lead.do_not_contact, true)
  assert.equal(p.lead.status, 'Dead')
  assert.equal(p.cancel?.types, 'all')
  assert.equal(p.createTasks.length, 0)
})

test('"not now" reply: closed, Dead, retry in three months', () => {
  const p = planEvent(lead({ stage: 'outreach', status: 'Emailed' }), ev('reply_received', { kind: 'not_now' }))
  assert.equal(p.lead.lost_reason, 'not_now')
  assert.equal(p.createTasks[0].type, 'retry')
  assert.equal(p.createTasks[0].due_on, addDays('2026-10-30', 90))
})

test('meeting booked: meeting stage, status, cold and reply reminders stop, meeting task on the day', () => {
  const p = planEvent(lead({ stage: 'engaged', status: 'Replied' }), ev('meeting_booked', { at: '2026-11-05T10:00' }))
  assert.equal(p.lead.stage, 'meeting')
  assert.equal(p.lead.status, 'Meeting booked')
  assert.ok(p.cancel && p.cancel.types !== 'all' && p.cancel.types.includes('reply'))
  assert.equal(p.createTasks[0].due_on, '2026-11-05')
  assert.equal(p.createTasks[0].due_time, '10:00')
})

test('proposal sent: records value and version, follow-up in 3 days, never claims it was emailed', () => {
  const p = planEvent(lead({ stage: 'mockup', status: 'Meeting booked', proposal_version: 1 }), ev('proposal_sent', { amount: '1500', currency: 'USD', package: 'blossom' }))
  assert.equal(p.lead.stage, 'proposal')
  assert.equal(p.lead.proposal_version, 2)
  assert.equal(p.lead.deal_value, 1500)
  assert.equal(p.lead.status, undefined, 'status is not touched by a proposal')
  assert.equal(p.createTasks[0].type, 'proposal_followup')
})

test('won: Won, all reminders end, handoff task, deposit pending (not paid)', () => {
  const p = planEvent(lead({ stage: 'proposal', status: 'Meeting booked', proposal_status: 'sent' }), ev('won', { amount: 7350000, currency: 'MMK' }))
  assert.equal(p.lead.stage, 'won')
  assert.equal(p.lead.status, 'Won')
  assert.equal(p.lead.currency, 'MMK')
  assert.equal(p.lead.deposit_status, 'pending')
  assert.equal(p.lead.proposal_status, 'accepted')
  assert.equal(p.cancel?.types, 'all')
  assert.equal(p.createTasks[0].type, 'handoff')
})

test('closed as no fit maps to the legacy "No fit"; other reasons to "Dead"', () => {
  assert.equal(planEvent(lead(), ev('lost', { reason: 'no_fit' })).lead.status, 'No fit')
  assert.equal(planEvent(lead({ stage: 'outreach', status: 'Emailed' }), ev('lost', { reason: 'declined' })).lead.status, 'Dead')
})

test('outreach to a closed lead reopens it; a won lead is never moved by outreach', () => {
  const p = planEvent(lead({ stage: 'lost', status: 'Dead' }), ev('email_sent'))
  assert.equal(p.lead.stage, 'outreach')
  assert.equal(p.lead.lost_reason, '')
  const w = planEvent(lead({ stage: 'won', status: 'Won' }), ev('email_sent'))
  assert.equal(w.lead.stage, undefined)
})

test('stages never move backwards through events', () => {
  const p = planEvent(lead({ stage: 'proposal', status: 'Meeting booked' }), ev('reply_received', { kind: 'question' }))
  assert.equal(p.lead.stage, undefined)
})

test('dragging to Outreach without logging a send keeps "Not sent" (the skill drafts from it)', () => {
  assert.equal(statusForStage('outreach', 'Not sent'), 'Not sent')
  const p = planEvent(lead(), ev('stage_changed', { to: 'outreach' }))
  assert.equal(p.lead.stage, 'outreach')
  assert.equal(p.lead.status, undefined)
})

test('stage → legacy status mapping', () => {
  assert.equal(statusForStage('new', 'Emailed'), 'Not sent')
  assert.equal(statusForStage('engaged', 'Emailed'), 'Replied')
  assert.equal(statusForStage('meeting', 'Replied'), 'Meeting booked')
  assert.equal(statusForStage('proposal', 'Meeting booked'), 'Meeting booked')
  assert.equal(statusForStage('lost', 'Emailed', 'no_fit'), 'No fit')
})

test('legacy status → event translation, including the "back to Not sent" correction', () => {
  assert.deepEqual(eventForStatus('Not sent', 'Emailed'), { type: 'email_sent' })
  assert.deepEqual(eventForStatus('Emailed', 'Not sent'), { voidStatusContacts: true })
  assert.deepEqual(eventForStatus('Emailed', 'Follow-up 1'), { type: 'followup_sent' })
  assert.deepEqual(eventForStatus('Emailed', 'Dead'), { type: 'lost', meta: { reason: 'dead' } })
  assert.equal(eventForStatus('Emailed', 'Emailed'), null)
  assert.equal(statusToStage('Follow-up 2'), 'outreach')
})
