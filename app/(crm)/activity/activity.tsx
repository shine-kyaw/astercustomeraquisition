'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { EVENT_TYPES, eventLabel } from '@/lib/crm'
import { TEAM } from '@/lib/constants'
import { api, pref, setPref, ApiError } from '@/app/components/api'
import { Empty, SkeletonRows, fmtDateTime } from '@/app/components/ui'
import { Icon, EVENT_ICON } from '@/app/components/icons'

type Ev = {
  id: string
  lead_id: string | null
  type: string
  occurred_at: string
  who: string
  summary: string | null
  ext_ref: string | null
  source: string
  meta?: Record<string, unknown> | null
  company: string | null
}
type Log = { id: string | number; who: string; action: string; at: string }

const PAGE = 60

const GROUPS = [
  { key: 'all', label: 'All', types: null },
  { key: 'outreach', label: 'Outreach', types: ['email_sent', 'followup_sent', 'call_attempted', 'call_connected', 'voicemail', 'message_sent'] },
  { key: 'replies', label: 'Replies', types: ['reply_received', 'bounced', 'opted_out'] },
  { key: 'deals', label: 'Deals', types: ['meeting_booked', 'meeting_held', 'mockup_started', 'mockup_ready', 'mockup_presented', 'proposal_sent', 'won', 'lost', 'reopened'] },
  { key: 'notes', label: 'Notes', types: ['note'] },
] as const

const SYSTEM = ['stage_changed', 'status_changed', 'task_done', 'created', 'imported']

type Filters = { who: string; group: string; type: string }
const DEFAULTS: Filters = { who: '', group: 'all', type: '' }

function localYmd(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function dayHeading(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Earlier'
  const now = new Date()
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (localYmd(d) === localYmd(now)) return 'Today'
  if (localYmd(d) === localYmd(y)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

function clock(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export default function Activity() {
  const [tab, setTab] = useState<'feed' | 'log'>('feed')
  const [filters, setFilters] = useState<Filters>(DEFAULTS)
  const [ready, setReady] = useState(false)
  const [events, setEvents] = useState<Ev[] | null>(null)
  const [more, setMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<{ message: string; status: number } | null>(null)
  const [log, setLog] = useState<Log[] | null>(null)
  const [logError, setLogError] = useState('')

  useEffect(() => {
    const saved = pref<Partial<Filters>>('activity.filters', {})
    setFilters({
      who: typeof saved.who === 'string' ? saved.who : '',
      group: GROUPS.some((g) => g.key === saved.group) ? (saved.group as string) : 'all',
      type: typeof saved.type === 'string' && EVENT_TYPES.some((t) => t.key === saved.type) ? saved.type : '',
    })
    setReady(true)
  }, [])

  const query = useCallback((f: Filters, before?: string) => {
    const p = new URLSearchParams({ limit: String(PAGE) })
    if (before) p.set('before', before)
    if (f.who) p.set('who', f.who)
    // A group spans several types and the API takes one, so groups are filtered here instead.
    if (f.type) p.set('type', f.type)
    return `/api/events?${p}`
  }, [])

  useEffect(() => {
    if (!ready || tab !== 'feed') return
    const ctl = new AbortController()
    setEvents(null)
    setError(null)
    api<{ events: Ev[] }>(query(filters), { signal: ctl.signal })
      .then((d) => { setEvents(d.events); setMore(d.events.length >= PAGE) })
      .catch((e) => {
        if ((e as Error).name === 'AbortError') return
        setError({ message: (e as Error).message, status: e instanceof ApiError ? e.status : 0 })
        setEvents([])
        setMore(false)
      })
    return () => ctl.abort()
  }, [ready, tab, filters, query])

  useEffect(() => {
    if (tab !== 'log' || log) return
    api<{ activity: Log[] }>('/api/activity?limit=200')
      .then((d) => setLog(d.activity))
      .catch((e) => { setLogError((e as Error).message); setLog([]) })
  }, [tab, log])

  function change(patch: Partial<Filters>) {
    const next = { ...filters, ...patch }
    setFilters(next)
    setPref('activity.filters', next)
  }

  async function loadMore() {
    if (!events?.length) return
    setLoadingMore(true)
    try {
      const d = await api<{ events: Ev[] }>(query(filters, events[events.length - 1].occurred_at))
      setEvents((cur) => {
        const seen = new Set((cur ?? []).map((e) => e.id))
        return [...(cur ?? []), ...d.events.filter((e) => !seen.has(e.id))]
      })
      setMore(d.events.length >= PAGE)
    } catch (e) {
      setError({ message: (e as Error).message, status: e instanceof ApiError ? e.status : 0 })
    } finally {
      setLoadingMore(false)
    }
  }

  const visible = useMemo(() => {
    const g = GROUPS.find((x) => x.key === filters.group)
    if (!events) return []
    return g?.types ? events.filter((e) => (g.types as readonly string[]).includes(e.type)) : events
  }, [events, filters.group])

  const days = useMemo(() => {
    const out: { label: string; rows: Ev[] }[] = []
    for (const e of visible) {
      const label = dayHeading(e.occurred_at)
      const last = out[out.length - 1]
      if (last && last.label === label) last.rows.push(e)
      else out.push({ label, rows: [e] })
    }
    return out
  }, [visible])

  return (
    <div className="page">
      <div className="phead">
        <div>
          <h1>Activity</h1>
          <p>What the team did, newest first.</p>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'feed'} className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>Feed</button>
        <button role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Edit log</button>
      </div>

      {tab === 'feed' ? (
        <>
          <div className="row wrap" style={{ gap: 10, marginBottom: 14 }}>
            <label className="vh" htmlFor="a-who" style={{ position: 'absolute', left: -9999 }}>Person</label>
            <select id="a-who" value={filters.who} onChange={(e) => change({ who: e.target.value })} style={{ width: 'auto' }}>
              <option value="">Everyone</option>
              {TEAM.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
            <div className="chips" role="group" aria-label="Type of activity">
              {GROUPS.map((g) => (
                <button key={g.key} className={`chip${filters.group === g.key && !filters.type ? ' on' : ''}`} aria-pressed={filters.group === g.key && !filters.type} onClick={() => change({ group: g.key, type: '' })}>
                  {g.label}
                </button>
              ))}
            </div>
            <span className="spacer" />
            <label className="vh" htmlFor="a-type" style={{ position: 'absolute', left: -9999 }}>Single activity type</label>
            <select id="a-type" value={filters.type} onChange={(e) => change({ type: e.target.value, group: 'all' })} style={{ width: 'auto' }}>
              <option value="">Any type</option>
              {EVENT_TYPES.filter((t) => t.key !== 'migrated').map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>

          {error && (error.status === 503 ? <div className="note">{error.message}</div> : <div className="err">{error.message}</div>)}

          {events === null ? (
            <div className="card flush"><SkeletonRows n={8} /></div>
          ) : visible.length === 0 ? (
            error ? null : (
              <div className="card">
                <Empty title="Nothing here yet.">
                  {events.length ? 'No loaded activity matches this filter. Load more to look further back.' : 'Activity appears here as the team logs emails, calls, replies and notes.'}
                </Empty>
                {events.length > 0 && more && <div className="row" style={{ justifyContent: 'center', paddingBottom: 16 }}><button className="btn sm" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button></div>}
              </div>
            )
          ) : (
            <div className="card afeed" style={{ padding: '16px 18px' }}>
              {days.map((d) => (
                <section key={d.label} aria-label={d.label}>
                  <h2 className="day">{d.label}</h2>
                  <div className="tl">
                    {d.rows.map((e) => {
                      const sys = SYSTEM.includes(e.type)
                      const link = e.ext_ref && /^https?:\/\//i.test(e.ext_ref) ? e.ext_ref : null
                      return (
                        <div className={`ev${sys ? ' sys' : ''}`} key={e.id}>
                          <span className="ic" aria-hidden="true"><Icon name={EVENT_ICON[e.type] ?? 'note'} /></span>
                          <div>
                            <div className="what">
                              <b>{e.who}</b> <span>{eventLabel(e.type)}</span>
                              {e.company && e.lead_id && <><span className="dim">·</span><Link href={`/leads/${e.lead_id}`}>{e.company}</Link></>}
                              {e.source === 'status' && <span className="dim" style={{ fontSize: 12 }}>(from a status change)</span>}
                              {!(e.meta as { date_only?: boolean } | null)?.date_only && <span className="tm">{clock(e.occurred_at)}</span>}
                            </div>
                            {(e.summary || link) && (
                              <div className="body">
                                {e.summary}
                                {link && <a href={link} target="_blank" rel="noopener noreferrer">Open in Gmail</a>}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))}
              {more && (
                <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
                  <button className="btn sm" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 12.5, margin: '0 0 14px' }}>Who changed what, and sign-ins. The most recent 200.</p>
          {logError && <div className="err">{logError}</div>}
          {log === null ? (
            <div className="card flush"><SkeletonRows n={8} /></div>
          ) : log.length === 0 ? (
            logError ? null : <div className="card"><Empty title="Nothing logged." /></div>
          ) : (
            <div className="card flush alog">
              <div className="list">
                {log.map((l) => (
                  <div className="item" key={l.id}>
                    <div className="grow" style={{ whiteSpace: 'normal' }}>
                      <span className="t" style={{ whiteSpace: 'normal' }}>{l.who}</span>{' '}
                      <span className="muted" style={{ whiteSpace: 'normal' }}>{l.action}</span>
                    </div>
                    <span className="when">{fmtDateTime(l.at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
