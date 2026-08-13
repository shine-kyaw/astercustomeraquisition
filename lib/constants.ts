export const TEAM = [
  { name: 'Shine Kyaw', mail: 'shine@astermade.com', live: true },
  { name: 'Myat Thit Kha', mail: 'mtk@astermade.com', live: true },
  { name: 'Xiao Long Hein', mail: 'xiaolong@astermade.com', live: true },
  { name: 'Lucas Lin', mail: 'lucas@astermade.com', live: true },
  { name: 'Victor Huang', mail: 'victor@astermade.com', live: false },
  { name: 'Babullee', mail: 'babullee@astermade.com', live: false },
] as const

export const TEAM_NAMES = TEAM.map((t) => t.name) as readonly string[]

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
