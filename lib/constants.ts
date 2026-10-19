export const TEAM = [
  { name: 'Shine Kyaw', mail: 'shine@astermade.com', live: true },
  { name: 'Myat Thit Kha', mail: 'mtk@astermade.com', live: true },
  { name: 'Xiao Long Hein', mail: 'xiaolong@astermade.com', live: true },
  { name: 'Lucas Lin', mail: 'lucas@astermade.com', live: true },
  { name: 'Victor Huang', mail: 'victor@astermade.com', live: false },
  { name: 'Babullee', mail: 'babullee@astermade.com', live: false },
] as const

export const TEAM_NAMES = TEAM.map((t) => t.name) as readonly string[]

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
] as const

export type WritableField = (typeof WRITABLE_FIELDS)[number]

/** Values we constrain, so a typo or a bad payload can't put junk in a filter column. */
export const ENUMS: Partial<Record<WritableField, readonly string[]>> = {
  status: STATUSES,
  estat: VERIFICATION,
  pstat: VERIFICATION,
  conf: CONFIDENCE,
  channel: CHANNELS,
  geo: GEOS.map((g) => g.k),
}
