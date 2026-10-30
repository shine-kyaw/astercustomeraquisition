import {
  PRIORITIES, CURRENCIES, PACKAGES, MOCKUP_STATUSES, PROPOSAL_STATUSES, DEPOSIT_STATUSES,
} from './crm'

export const TEAM = [
  { name: 'Shine Kyaw', mail: 'shine@astermade.com', live: true },
  { name: 'Myat Thit Kha', mail: 'mtk@astermade.com', live: true },
  { name: 'Xiao Long Hein', mail: 'xiaolong@astermade.com', live: true },
  { name: 'Lucas Lin', mail: 'lucas@astermade.com', live: true },
  { name: 'Astrid', mail: 'astrid@astermade.com', live: true },
] as const

export const TEAM_NAMES = TEAM.map((t) => t.name) as readonly string[]

/**
 * People who have left. They can't sign in, and their mailboxes can't be chosen as a
 * sender, but leads they owned keep the name as history — so it is still recognised and
 * shown as "(left)" rather than silently blanked.
 */
export const FORMER_TEAM = [
  { name: 'Victor Huang', mail: 'victor@astermade.com' },
  { name: 'Babullee', mail: 'babullee@astermade.com' },
] as const

export const FORMER_NAMES = FORMER_TEAM.map((t) => t.name) as readonly string[]
export const FORMER_MAILS = FORMER_TEAM.map((t) => t.mail) as readonly string[]

/** Statuses after which a lead needs no further work, so a departed owner doesn't matter. */
export const CLOSED_STATUSES = ['Won', 'No fit', 'Dead'] as const

/** An open lead still owned by someone who has left: it needs a new owner. */
export function needsNewOwner(lead: { owner?: unknown; status?: unknown }): boolean {
  return FORMER_NAMES.includes(String(lead.owner ?? '')) &&
    !(CLOSED_STATUSES as readonly string[]).includes(String(lead.status ?? ''))
}

const MAX_NAME = 60

/** Collapse whitespace so "Aung  Ko " and "Aung Ko" sign in as the same person. */
export function cleanName(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Why a sign-in name is unacceptable, or null if it's fine. Shared by the login form,
 * the session route and cookie decoding so all three agree on who can be signed in.
 *
 * Anyone not on TEAM can sign in under "Other" with a typed name — they still need the
 * team password; the name only exists so their edits are attributed to someone. A typed
 * name that matches a roster name (in any case) is refused, so the activity log never
 * shows two spellings of the same teammate.
 */
export function signInNameError(name: string): string | null {
  if (TEAM_NAMES.includes(name)) return null
  if (name !== cleanName(name)) return 'Enter your name'
  if (name.length < 2) return 'Enter your name'
  if (name.length > MAX_NAME) return `Keep your name under ${MAX_NAME} characters`
  if (/[\u0000-\u001f\u007f<>]/.test(name)) return 'That name has characters we can’t use'
  if (TEAM_NAMES.some((t) => t.toLowerCase() === name.toLowerCase())) {
    return 'That’s a team name — pick it from the list instead'
  }
  // Without this, someone who has left could still sign in as themselves under "Other".
  if (FORMER_NAMES.some((t) => t.toLowerCase() === name.toLowerCase())) {
    return 'That person is no longer on the team'
  }
  return null
}

export const STATUSES = [
  'Not sent', 'Emailed', 'Called', 'Follow-up 1', 'Follow-up 2',
  'Replied', 'Meeting booked', 'Won', 'No fit', 'Dead',
] as const

export const GEOS = [
  { k: 'us', label: 'United States' },
  { k: 'uk', label: 'United Kingdom' },
  { k: 'tw', label: 'Taiwan' },
  { k: 'other', label: 'Other' },
] as const

export const VERIFICATION = ['VERIFIED', 'PATTERN-CONFIRMED', 'UNKNOWN'] as const
export const CONFIDENCE = ['HIGH', 'MEDIUM-HIGH', 'MEDIUM', 'LOW'] as const
export const CHANNELS = ['email', 'phone'] as const

export const TEMPLATES = [
  'Template 1 — Funnel',
  'Template 2 — Falling behind',
  'Template 3 — Skipped over',
  'Custom',
] as const

/** Columns a client is allowed to write. Anything else in a request body is dropped. */
export const WRITABLE_FIELDS = [
  'batch', 'seq', 'company', 'loc', 'geo', 'site', 'biz',
  'who', 'role', 'email', 'estat', 'phone', 'pstat', 'channel',
  'opp', 'buy', 'conf',
  'why', 'good', 'prob', 'signals', 'recent', 'angle',
  'owner', 'sender', 'tmpl', 'subj', 'mail', 'script', 'note',
  'status', 'date_sent', 'reply',
  // CRM fields (migration 001). Stage, lost reason and do-not-contact are not here on
  // purpose: they change only through events, so every move is recorded with a reason.
  'priority', 'deal_value', 'currency', 'package', 'expected_close', 'next_step', 'source',
  'researched_on', 'verified_on',
  'mockup_status', 'mockup_url', 'mockup_due',
  'proposal_status', 'proposal_url', 'proposal_amount', 'proposal_sent_on', 'proposal_version',
  'deposit_status', 'project_owner', 'deadline', 'handoff_notes',
] as const

export type WritableField = (typeof WRITABLE_FIELDS)[number]

/** Integer columns, and decimal money columns. Blank means "not set". */
export const INT_FIELDS: readonly WritableField[] = ['opp', 'buy', 'seq', 'proposal_version']
export const MONEY_FIELDS: readonly WritableField[] = ['deal_value', 'proposal_amount']
export const DATE_FIELDS: readonly WritableField[] = [
  'date_sent', 'expected_close', 'researched_on', 'verified_on', 'mockup_due', 'proposal_sent_on', 'deadline',
]

/** Values we constrain, so a typo or a bad payload can't put junk in a filter column. */
export const ENUMS: Partial<Record<WritableField, readonly string[]>> = {
  status: STATUSES,
  estat: VERIFICATION,
  pstat: VERIFICATION,
  conf: CONFIDENCE,
  channel: CHANNELS,
  geo: GEOS.map((g) => g.k),
  priority: PRIORITIES,
  currency: CURRENCIES,
  package: PACKAGES.filter(Boolean),
  mockup_status: MOCKUP_STATUSES.filter(Boolean),
  proposal_status: PROPOSAL_STATUSES.filter(Boolean),
  deposit_status: DEPOSIT_STATUSES.filter(Boolean),
}
