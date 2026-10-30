// Inline icons: a handful of 24px stroke glyphs, so the app needs no icon package.
const paths: Record<string, string> = {
  today: 'M3 10h18M8 3v4M16 3v4M5 6h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
  leads: 'M4 6h16M4 12h16M4 18h10',
  pipeline: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v5h-4z',
  tasks: 'M9 11l2 2 4-4M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  ruled: 'M5 5l14 14M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  draft: 'M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z',
  reply: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v4',
  calendar: 'M3 10h18M8 3v4M16 3v4M5 6h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6ZM14 3v6h6',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6 6 18',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  note: 'M5 4h14v12l-4 4H5V4ZM15 20v-4h4',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 18l-6-6 6-6',
  external: 'M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  logout: 'M15 4h4v16h-4M10 17l5-5-5-5M15 12H3',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  stop: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 8l8 8',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  money: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  board: 'M3 4h18v16H3zM9 4v16M15 4v16',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
}

export type IconName = keyof typeof paths

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}
    >
      <path d={paths[name]} />
    </svg>
  )
}

/** The icon each timeline entry gets. */
export const EVENT_ICON: Record<string, IconName> = {
  email_sent: 'mail', followup_sent: 'mail', email_drafted: 'draft',
  call_attempted: 'phone', call_connected: 'phone', voicemail: 'phone', message_sent: 'reply',
  reply_received: 'reply', bounced: 'alert', opted_out: 'stop',
  meeting_booked: 'calendar', meeting_held: 'calendar',
  mockup_started: 'sparkle', mockup_ready: 'sparkle', mockup_presented: 'sparkle',
  proposal_sent: 'file', won: 'trophy', lost: 'x', reopened: 'arrow', note: 'note',
  stage_changed: 'arrow', status_changed: 'arrow', task_done: 'check', created: 'plus', imported: 'upload', migrated: 'clock',
}
