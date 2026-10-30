// The CRM's vocabulary and rules, with no database access — so the browser can import it,
// and so the rules can be tested on their own.
//
// Three ideas are kept apart here, because the legacy `status` field mixed them up:
//   stage  — where the deal is now (one value, moves forward and occasionally back)
//   event  — something that happened (many, dated, never rewritten)
//   task   — something that still has to happen
// `status` survives as a compatibility field: the aster-lead-engine skill reads and PATCHes
// it, so every stage change keeps it in step, and every status PATCH is translated into the
// event it describes.

export const STAGES = [
  { key: 'new', label: 'New', hint: 'Researched, not contacted yet' },
  { key: 'outreach', label: 'Outreach', hint: 'Contacted, waiting for a reply' },
  { key: 'engaged', label: 'Engaged', hint: 'They replied or showed interest' },
  { key: 'meeting', label: 'Meeting', hint: 'A call or walkthrough is booked' },
  { key: 'mockup', label: 'Mockup', hint: 'Preparing or presenting the free homepage mockup' },
  { key: 'proposal', label: 'Proposal', hint: 'Proposal sent, waiting on a decision' },
  { key: 'won', label: 'Won', hint: 'Agreed. Hand over to delivery' },
  { key: 'lost', label: 'Closed', hint: 'No fit, no response, declined or opted out' },
] as const

export type Stage = (typeof STAGES)[number]['key']
export const STAGE_KEYS = STAGES.map((s) => s.key) as readonly Stage[]
export const ACTIVE_STAGES: readonly Stage[] = ['new', 'outreach', 'engaged', 'meeting', 'mockup', 'proposal']
/** Stages where someone is actively working a conversation, so a missing next step matters. */
export const WORKING_STAGES: readonly Stage[] = ['outreach', 'engaged', 'meeting', 'mockup', 'proposal']

export function stageRank(s: string): number {
  const i = STAGE_KEYS.indexOf(s as Stage)
  return i === -1 ? 0 : i
}
export function stageLabel(s: string): string {
  return STAGES.find((x) => x.key === s)?.label ?? s
}

export const LOST_REASONS = [
  { key: 'no_fit', label: 'No fit', hint: 'Fails qualification: good site already, agency credit, too big' },
  { key: 'no_response', label: 'No response', hint: 'Outreach finished with no reply' },
  { key: 'not_now', label: 'Not now', hint: 'Said maybe later. Retry in three months' },
  { key: 'declined', label: 'Declined', hint: 'Saw the offer and said no' },
  { key: 'went_elsewhere', label: 'Went elsewhere', hint: 'Chose another provider' },
  { key: 'opted_out', label: 'Opted out', hint: 'Asked not to be contacted again' },
  { key: 'bounced', label: 'Bounced', hint: 'Address failed; no working contact' },
  { key: 'unreachable', label: 'Unreachable', hint: 'Business closed or never answers' },
  { key: 'dead', label: 'Dead (no reason recorded)', hint: 'Carried over from the old "Dead" status' },
] as const
export type LostReason = (typeof LOST_REASONS)[number]['key']
export const LOST_REASON_KEYS = LOST_REASONS.map((r) => r.key) as readonly string[]
export function lostReasonLabel(k: string): string {
  return LOST_REASONS.find((r) => r.key === k)?.label ?? k
}

export const PRIORITIES = ['low', 'normal', 'high'] as const
export const CURRENCIES = ['USD', 'MMK', 'SGD', 'GBP', 'TWD', 'EUR'] as const
export const PACKAGES = ['', 'seed', 'blossom', 'bloom', 'custom'] as const
export const MOCKUP_STATUSES = ['', 'requested', 'in_progress', 'ready', 'presented', 'revision'] as const
export const PROPOSAL_STATUSES = ['', 'drafting', 'sent', 'accepted', 'declined'] as const
export const DEPOSIT_STATUSES = ['', 'pending', 'invoiced', 'paid'] as const

export type Package = { key: string; label: string; amount: number; currency: string }

// ── Events ──────────────────────────────────────────────────────────────────────────────

export const EVENT_TYPES = [
  // Outreach actually performed. These, and only these, count as "contacted".
  { key: 'email_sent', label: 'Email sent', group: 'outreach', contact: true },
  { key: 'followup_sent', label: 'Follow-up sent', group: 'outreach', contact: true },
  { key: 'call_attempted', label: 'Call: no answer', group: 'outreach', contact: true },
  { key: 'voicemail', label: 'Voicemail left', group: 'outreach', contact: true },
  { key: 'call_connected', label: 'Call: spoke to them', group: 'outreach', contact: true },
  { key: 'message_sent', label: 'WhatsApp / Viber / SMS sent', group: 'outreach', contact: true },
  // Prepared, not sent. Never counts as contact.
  { key: 'email_drafted', label: 'Email drafted', group: 'outreach', contact: false },
  // Their side.
  { key: 'reply_received', label: 'Reply received', group: 'response', contact: false },
  { key: 'bounced', label: 'Email bounced', group: 'response', contact: false },
  { key: 'opted_out', label: 'Asked not to be contacted', group: 'response', contact: false },
  // The closing process.
  { key: 'meeting_booked', label: 'Meeting booked', group: 'deal', contact: false },
  { key: 'meeting_held', label: 'Meeting held', group: 'deal', contact: false },
  { key: 'mockup_started', label: 'Mockup started', group: 'deal', contact: false },
  { key: 'mockup_ready', label: 'Mockup ready', group: 'deal', contact: false },
  { key: 'mockup_presented', label: 'Mockup presented', group: 'deal', contact: false },
  { key: 'proposal_sent', label: 'Proposal sent', group: 'deal', contact: false },
  { key: 'won', label: 'Won', group: 'deal', contact: false },
  { key: 'lost', label: 'Closed', group: 'deal', contact: false },
  { key: 'reopened', label: 'Reopened', group: 'deal', contact: false },
  { key: 'note', label: 'Note', group: 'internal', contact: false },
  // Written by the system, never logged by hand.
  { key: 'stage_changed', label: 'Stage changed', group: 'system', contact: false },
  { key: 'status_changed', label: 'Status changed', group: 'system', contact: false },
  { key: 'task_done', label: 'Task completed', group: 'system', contact: false },
  { key: 'created', label: 'Lead added', group: 'system', contact: false },
  { key: 'imported', label: 'Imported', group: 'system', contact: false },
  { key: 'migrated', label: 'Carried over', group: 'system', contact: false },
] as const

export type EventType = (typeof EVENT_TYPES)[number]['key']
export const EVENT_KEYS = EVENT_TYPES.map((e) => e.key) as readonly string[]
export const CONTACT_EVENTS = EVENT_TYPES.filter((e) => e.contact).map((e) => e.key) as readonly string[]
export const SYSTEM_EVENTS = EVENT_TYPES.filter((e) => e.group === 'system').map((e) => e.key) as readonly string[]
export function eventLabel(k: string): string {
  return EVENT_TYPES.find((e) => e.key === k)?.label ?? k
}

/** How they replied, which decides what happens next (from the skill's reply table). */
export const REPLY_KINDS = [
  { key: 'interested', label: 'Interested / tell me more' },
  { key: 'question', label: 'Asked a question' },
  { key: 'wrong_person', label: 'Wrong person / forwarded' },
  { key: 'not_now', label: 'Not now / maybe later' },
  { key: 'no', label: 'No / stop' },
] as const
const POSITIVE_REPLIES = ['interested', 'question', 'wrong_person', 'unknown']

// ── Tasks ───────────────────────────────────────────────────────────────────────────────

export const TASK_TYPES = [
  { key: 'send_email', label: 'Send email' },
  { key: 'call', label: 'Call' },
  { key: 'follow_up', label: 'Follow up' },
  { key: 'review', label: 'Review: no reply' },
  { key: 'reply', label: 'Reply to them' },
  { key: 'meeting', label: 'Meeting' },
  { key: 'mockup', label: 'Prepare mockup' },
  { key: 'present', label: 'Present mockup' },
  { key: 'proposal', label: 'Prepare proposal' },
  { key: 'proposal_followup', label: 'Follow up on proposal' },
  { key: 'handoff', label: 'Delivery handoff' },
  { key: 'retry', label: 'Retry later' },
  { key: 'research', label: 'Research / verify' },
  { key: 'other', label: 'Other' },
] as const
export const TASK_TYPE_KEYS = TASK_TYPES.map((t) => t.key) as readonly string[]
export function taskTypeLabel(k: string): string {
  return TASK_TYPES.find((t) => t.key === k)?.label ?? k
}
/** Cold-outreach reminders: they stop the moment a conversation starts. */
export const COLD_TASKS = ['send_email', 'call', 'follow_up', 'review'] as const

// ── Legacy status ───────────────────────────────────────────────────────────────────────

const PRE_REPLY = ['Not sent', 'Emailed', 'Called', 'Follow-up 1', 'Follow-up 2']
const OUTREACH_STATUSES = ['Emailed', 'Called', 'Follow-up 1', 'Follow-up 2']

export function statusToStage(status: string): Stage {
  switch (status) {
    case 'Not sent': return 'new'
    case 'Emailed': case 'Called': case 'Follow-up 1': case 'Follow-up 2': return 'outreach'
    case 'Replied': return 'engaged'
    case 'Meeting booked': return 'meeting'
    case 'Won': return 'won'
    default: return 'lost'
  }
}

/**
 * The legacy status a stage implies, given the current one. Only moves the status when the
 * stage says something the status contradicts — e.g. "Engaged" while the status still says
 * "Emailed". Never invents an outreach status: moving a card to Outreach without logging
 * a send leaves "Not sent" alone, because the skill uses "Not sent" to find leads to email.
 */
export function statusForStage(stage: string, status: string, lostReason = ''): string {
  switch (stage) {
    case 'new': return 'Not sent'
    case 'outreach': return status
    case 'engaged': case 'mockup': case 'proposal':
      return PRE_REPLY.includes(status) || status === 'No fit' || status === 'Dead' ? 'Replied' : status === 'Won' ? 'Replied' : status
    case 'meeting': return 'Meeting booked'
    case 'won': return 'Won'
    case 'lost': return lostReason === 'no_fit' ? 'No fit' : 'Dead'
    default: return status
  }
}

// ── What an event does ──────────────────────────────────────────────────────────────────

export type LeadState = {
  id: string
  company: string
  stage: string
  status: string
  owner: string
  who?: string
  phone?: string
  date_sent?: string | null
  do_not_contact?: boolean
  proposal_version?: number | null
  proposal_status?: string
  deal_value?: number | string | null
}

export type NewTask = {
  auto_key: string
  title: string
  type: string
  due_on: string
  due_time?: string
  owner: string
  priority: 'low' | 'normal' | 'high'
}

export type Plan = {
  lead: Record<string, unknown>
  createTasks: NewTask[]
  completeTypes: string[]
  cancel: { types: readonly string[] | 'all'; reason: string } | null
}

export type EventInput = {
  type: string
  date: string            // YYYY-MM-DD, the user's local date it happened
  who: string
  summary?: string
  meta?: Record<string, unknown>
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Decide what an event changes. Pure: the caller turns the plan into SQL.
 *
 * `statusDriven` is set when the event was inferred from a legacy status PATCH. The status
 * has already been written by then, so the plan must not overwrite it.
 *
 * The cadence is the skill's, not a new one: email on day 0, a call on day 1 if there is a
 * number, one follow-up on day 3, then stop. The day-7 "review" task is a prompt to close
 * the lead out, not another touch.
 */
export function planEvent(lead: LeadState, ev: EventInput, opts: { statusDriven?: boolean } = {}): Plan {
  const p: Plan = { lead: {}, createTasks: [], completeTypes: [], cancel: null }
  const meta = ev.meta ?? {}
  const owner = lead.owner || ev.who
  const name = lead.who ? `${lead.who} at ${lead.company}` : lead.company
  const d = ev.date
  const rank = stageRank(lead.stage)

  const moveTo = (stage: Stage, lostReason = '') => {
    p.lead.stage = stage
    p.lead.lost_reason = stage === 'lost' ? lostReason : ''
  }
  // Forward only — except that outreach to a closed lead reopens it (a three-month retry).
  const advance = (stage: Stage) => {
    if (lead.stage === 'won') return
    if (lead.stage === 'lost' || stageRank(stage) > rank) moveTo(stage)
  }
  const task = (key: string, type: string, title: string, due: string, priority: NewTask['priority'] = 'normal', due_time = '') =>
    p.createTasks.push({ auto_key: key, type, title, due_on: due, due_time, owner, priority })

  switch (ev.type) {
    case 'email_sent': {
      advance('outreach')
      if (!lead.date_sent) p.lead.date_sent = d
      if (!opts.statusDriven && ['Not sent', 'No fit', 'Dead'].includes(lead.status)) p.lead.status = 'Emailed'
      p.completeTypes.push('send_email')
      if (lead.phone) task(`cold:call:${lead.id}:${d}`, 'call', `Call ${name}`, addDays(d, 1))
      task(`cold:followup:${lead.id}:${d}`, 'follow_up', `Follow-up 1 to ${name} (reply in the same thread, something new)`, addDays(d, 3))
      break
    }
    case 'followup_sent': {
      advance('outreach')
      if (!opts.statusDriven && ['Not sent', 'Emailed', 'Called'].includes(lead.status)) p.lead.status = 'Follow-up 1'
      p.completeTypes.push('follow_up')
      task(`cold:review:${lead.id}:${d}`, 'review', `No reply from ${lead.company}? Close as no response and set a retry`, addDays(d, 4), 'low')
      break
    }
    case 'call_attempted':
    case 'voicemail':
    case 'call_connected':
    case 'message_sent': {
      advance('outreach')
      if (!lead.date_sent) p.lead.date_sent = d
      if (!opts.statusDriven && ['Not sent', 'No fit', 'Dead'].includes(lead.status)) p.lead.status = 'Called'
      p.completeTypes.push('call')
      break
    }
    case 'reply_received': {
      const kind = String(meta.kind ?? 'unknown')
      if (ev.summary) p.lead.reply = ev.summary
      if (kind === 'no') return planEvent(lead, { ...ev, type: 'opted_out' }, opts)
      if (kind === 'not_now') {
        moveTo('lost', 'not_now')
        if (!opts.statusDriven) p.lead.status = 'Dead'
        p.cancel = { types: 'all', reason: 'Said not now' }
        task(`retry:${lead.id}:${d}`, 'retry', `Retry ${lead.company} (said not now on ${d})`, addDays(d, 90), 'low')
        break
      }
      if (POSITIVE_REPLIES.includes(kind)) {
        advance('engaged')
        if (!opts.statusDriven && PRE_REPLY.concat(['No fit', 'Dead']).includes(lead.status)) p.lead.status = 'Replied'
        p.cancel = { types: COLD_TASKS, reason: 'They replied' }
        task(`reply:${lead.id}:${d}`, 'reply', `Reply to ${name}`, d, 'high')
      }
      break
    }
    case 'bounced': {
      moveTo('lost', 'bounced')
      if (!opts.statusDriven) p.lead.status = 'Dead'
      p.cancel = { types: COLD_TASKS, reason: 'Email bounced' }
      task(`research:bounce:${lead.id}:${d}`, 'research', `Bounced: find a published address for ${lead.company}, or call instead`, addDays(d, 1))
      break
    }
    case 'opted_out': {
      moveTo('lost', 'opted_out')
      if (!opts.statusDriven) p.lead.status = 'Dead'
      p.lead.do_not_contact = true
      p.lead.dnc_reason = ev.summary || 'Asked not to be contacted'
      p.lead.dnc_at = new Date().toISOString()
      p.cancel = { types: 'all', reason: 'Opted out' }
      break
    }
    case 'meeting_booked': {
      advance('meeting')
      if (!opts.statusDriven && lead.status !== 'Won') p.lead.status = 'Meeting booked'
      p.cancel = { types: [...COLD_TASKS, 'reply'], reason: 'Meeting booked' }
      const at = String(meta.at ?? '')
      const day = /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : d
      const time = /T(\d{2}:\d{2})/.exec(at)?.[1] ?? ''
      task(`meeting:${lead.id}:${day}`, 'meeting', at ? `Meeting with ${name}` : `Confirm the meeting time with ${name}`, day, 'high', time)
      break
    }
    case 'meeting_held':
      p.completeTypes.push('meeting')
      break
    case 'mockup_started':
      advance('mockup')
      p.lead.mockup_status = 'in_progress'
      if (meta.due) p.lead.mockup_due = meta.due
      task(`mockup:${lead.id}`, 'mockup', `Prepare the homepage mockup for ${lead.company}`, String(meta.due || addDays(d, 5)))
      break
    case 'mockup_ready':
      advance('mockup')
      p.lead.mockup_status = 'ready'
      if (meta.url) p.lead.mockup_url = meta.url
      p.completeTypes.push('mockup')
      task(`present:${lead.id}`, 'present', `Walk ${name} through the mockup`, addDays(d, 2), 'high')
      break
    case 'mockup_presented':
      advance('mockup')
      p.lead.mockup_status = 'presented'
      p.completeTypes.push('present', 'meeting')
      break
    case 'proposal_sent': {
      advance('proposal')
      const version = num(meta.version) ?? (Number(lead.proposal_version) || 0) + 1
      p.lead.proposal_status = 'sent'
      p.lead.proposal_sent_on = d
      p.lead.proposal_version = version
      const amount = num(meta.amount)
      if (amount !== null) { p.lead.proposal_amount = amount; p.lead.deal_value = amount }
      if (meta.currency) p.lead.currency = meta.currency
      if (meta.package) p.lead.package = meta.package
      if (meta.url) p.lead.proposal_url = meta.url
      p.completeTypes.push('proposal')
      task(`proposalfu:${lead.id}:v${version}`, 'proposal_followup', `Follow up on the proposal with ${name}`, addDays(d, 3), 'high')
      break
    }
    case 'won': {
      moveTo('won')
      if (!opts.statusDriven) p.lead.status = 'Won'
      const amount = num(meta.amount)
      if (amount !== null) p.lead.deal_value = amount
      if (meta.currency) p.lead.currency = meta.currency
      if (meta.package) p.lead.package = meta.package
      if (lead.proposal_status === 'sent') p.lead.proposal_status = 'accepted'
      p.lead.deposit_status = String(meta.deposit || 'pending')
      p.cancel = { types: 'all', reason: 'Won' }
      task(`handoff:${lead.id}`, 'handoff', `Hand ${lead.company} over to delivery`, d, 'high')
      break
    }
    case 'lost': {
      const reason = LOST_REASON_KEYS.includes(String(meta.reason)) ? String(meta.reason) : 'no_response'
      if (reason === 'opted_out') return planEvent(lead, { ...ev, type: 'opted_out' }, opts)
      moveTo('lost', reason)
      if (!opts.statusDriven) p.lead.status = reason === 'no_fit' ? 'No fit' : 'Dead'
      if (lead.proposal_status === 'sent' && reason === 'declined') p.lead.proposal_status = 'declined'
      p.cancel = { types: 'all', reason: `Closed: ${lostReasonLabel(reason)}` }
      if (reason === 'not_now' || reason === 'no_response') {
        task(`retry:${lead.id}:${d}`, 'retry', `Retry ${lead.company} (closed ${d}, ${lostReasonLabel(reason).toLowerCase()})`, addDays(d, 90), 'low')
      }
      break
    }
    case 'reopened': {
      const to = (STAGE_KEYS.includes(meta.to as Stage) && meta.to !== 'lost' && meta.to !== 'won' ? meta.to : 'engaged') as Stage
      moveTo(to)
      if (!opts.statusDriven) p.lead.status = statusForStage(to, lead.status)
      break
    }
    case 'stage_changed': {
      const to = String(meta.to ?? '') as Stage
      if (!STAGE_KEYS.includes(to) || to === 'won' || to === 'lost') break // those go through won/lost
      moveTo(to)
      if (!opts.statusDriven) p.lead.status = statusForStage(to, lead.status)
      if (to === 'new') p.cancel = { types: COLD_TASKS, reason: 'Moved back to New' }
      break
    }
    default:
      break
  }

  if (p.lead.stage !== undefined && p.lead.stage !== lead.stage) p.lead.stage_changed_at = new Date().toISOString()
  else delete p.lead.stage
  if (p.lead.stage === undefined && p.lead.lost_reason === '' && lead.stage !== 'lost') delete p.lead.lost_reason
  if (p.lead.status === lead.status) delete p.lead.status
  return p
}

/**
 * The event a legacy status PATCH describes. Returns null when the move needs no event
 * (no change), or a marker that earlier status-sourced contact events must be voided
 * (the skill's "put it back to Not sent" correction for a draft that never went out).
 */
export function eventForStatus(
  from: string,
  to: string
): { type: string; meta?: Record<string, unknown> } | { voidStatusContacts: true } | null {
  if (from === to) return null
  switch (to) {
    case 'Not sent': return OUTREACH_STATUSES.includes(from) ? { voidStatusContacts: true } : { type: 'stage_changed', meta: { to: 'new' } }
    case 'Emailed': return { type: 'email_sent' }
    case 'Called': return { type: 'call_attempted' }
    case 'Follow-up 1': case 'Follow-up 2': return { type: 'followup_sent' }
    case 'Replied': return { type: 'reply_received', meta: { kind: 'unknown' } }
    case 'Meeting booked': return { type: 'meeting_booked' }
    case 'Won': return { type: 'won' }
    case 'No fit': return { type: 'lost', meta: { reason: 'no_fit' } }
    case 'Dead': return { type: 'lost', meta: { reason: 'dead' } }
    default: return null
  }
}

/** Is the research behind an unsent email too old to send without re-checking? (The skill: 14 days.) */
export function researchAgeDays(researchedOn: string | null | undefined, today: string): number | null {
  if (!researchedOn) return null
  const a = Date.parse(`${String(researchedOn).slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${today}T00:00:00Z`)
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 864e5) : null
}

export function todayLocal(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}
