'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { TEAM, STATUSES } from '@/lib/constants'

type Lead = Record<string, any>
type Activity = { id: number; who: string; action: string; at: string }

const FILTERS = [
  ['all', 'All'], ['open', 'Not contacted'], ['active', 'In play'], ['won', 'Won'],
  ['mine', 'Mine'], ['email', 'Email first'], ['phone', 'Phone first'],
  ['us', 'US'], ['uk', 'UK'], ['tw', 'Taiwan'],
] as const

function dotColour(status: string) {
  if (status === 'Not sent') return 'var(--dim)'
  if (status === 'Replied' || status === 'Won') return 'var(--green)'
  if (status === 'Meeting booked') return 'var(--gold)'
  if (status === 'No fit' || status === 'Dead') return 'var(--red)'
  return 'var(--blue)'
}

export default function LeadList({ me }: { me: string }) {
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [showLog, setShowLog] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    try {
      const res = await fetch('/api/leads')
      if (res.status === 401) { router.push('/login'); return }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not load leads')
      setLeads(data.leads)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function loadActivity() {
    const res = await fetch('/api/activity?limit=100')
    if (res.ok) setActivity((await res.json()).activity)
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(id: string, body: Record<string, unknown>) {
    // Optimistic: the list stays responsive, and a failure re-syncs from the server.
    setLeads((cur) => cur.map((l) => (l.id === id ? { ...l, ...body } : l)))
    const res = await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Could not save that change')
      load()
    } else if (showLog) {
      loadActivity()
    }
  }

  async function signOut() {
    await fetch('/api/session', { method: 'DELETE' })
    router.push('/login')
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return leads.filter((l) => {
      if (q) {
        const hay = [l.company, l.who, l.role, l.loc, l.note, l.email, l.phone, l.owner, l.subj, l.batch]
          .join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      switch (filter) {
        case 'open': return l.status === 'Not sent'
        case 'active': return !['Not sent', 'Won', 'No fit', 'Dead'].includes(l.status)
        case 'won': return l.status === 'Won'
        case 'mine': return l.owner === me
        case 'email': return l.channel === 'email'
        case 'phone': return l.channel === 'phone'
        case 'us': case 'uk': case 'tw': return l.geo === filter
        default: return true
      }
    })
  }, [leads, filter, query, me])

  const stats = useMemo(() => {
    const n = leads.length
    const touched = leads.filter((l) => l.status !== 'Not sent').length
    return {
      n,
      email: leads.filter((l) => l.estat === 'VERIFIED').length,
      phone: leads.filter((l) => l.pstat === 'VERIFIED').length,
      opp: n ? (leads.reduce((a, l) => a + (Number(l.opp) || 0), 0) / n).toFixed(1) : '0',
      us: leads.filter((l) => l.geo === 'us').length,
      touched,
      replied: leads.filter((l) => ['Replied', 'Meeting booked', 'Won'].includes(l.status)).length,
      pct: n ? (touched / n) * 100 : 0,
    }
  }, [leads])

  const batches = useMemo(() => [...new Set(shown.map((l) => l.batch || 'Unfiled'))], [shown])

  return (
    <div className="wrap">
      <div className="topline">
        <div>
          <div className="brand">
            <div className="mark">Aster<span>.</span></div>
            <div className="tag">Lead Engine</div>
          </div>
          <p className="sub">
            Shared prospect tracker. Everything saves to the database immediately and everyone
            sees the same list — changes are attributed to you.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, color: 'var(--violet)', fontWeight: 600 }}>{me}</span>
          <button className="btn sm" onClick={signOut}>Sign out</button>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><div className="n gold">{stats.n}</div><div className="l">Leads</div></div>
        <div className="stat"><div className="n grn">{stats.email}</div><div className="l">Direct emails</div></div>
        <div className="stat"><div className="n grn">{stats.phone}</div><div className="l">Verified phones</div></div>
        <div className="stat"><div className="n gold">{stats.opp}</div><div className="l">Avg opportunity</div></div>
        <div className="stat"><div className="n blu">{stats.us}</div><div className="l">US leads</div></div>
        <div className="stat"><div className="n blu">{stats.touched}</div><div className="l">Contacted</div></div>
        <div className="stat"><div className="n amb">{stats.replied}</div><div className="l">Replied</div></div>
      </div>
      <div className="bar"><i style={{ width: `${stats.pct}%` }} /></div>

      {error && <div className="err" style={{ marginTop: 18 }}>{error}</div>}

      <div className="toolbar">
        <Link className="btn p" href="/leads/new">+ Add lead</Link>
        <input
          type="text"
          placeholder="Search company, person, location, notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn sm" onClick={() => { setShowLog(!showLog); if (!showLog) loadActivity() }}>
          {showLog ? 'Hide activity' : 'Activity log'}
        </button>
        <button className="btn sm" onClick={load}>Refresh</button>
      </div>

      <div className="filters">
        {FILTERS.map(([k, label]) => (
          <button key={k} className={`fbtn${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>

      {showLog && (
        <div className="card">
          <h4>Activity</h4>
          {activity.length ? (
            activity.map((a) => (
              <div className="logrow" key={a.id}>
                <span className="t">{new Date(a.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <span className="w">{a.who}</span>
                <span>{a.action}</span>
              </div>
            ))
          ) : (
            <p>Nothing logged yet.</p>
          )}
        </div>
      )}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : !shown.length ? (
        <div className="empty">
          No leads match. Clear the search, pick another filter, or <Link href="/leads/new">add a lead</Link>.
        </div>
      ) : (
        batches.map((batch) => {
          const inBatch = shown.filter((l) => (l.batch || 'Unfiled') === batch)
          return (
            <div key={batch}>
              <div className="batchhead">
                <h3>{batch}</h3>
                <div className="rule" />
                <span style={{ fontSize: 12, color: 'var(--dim)' }}>
                  {inBatch.length} lead{inBatch.length === 1 ? '' : 's'}
                </span>
              </div>
              {inBatch.map((l) => (
                <div className={`lead${['Won', 'No fit', 'Dead'].includes(l.status) ? ' done' : ''}`} key={l.id}>
                  <div className="lrow">
                    <div className="rank">{l.seq ?? '·'}</div>
                    <div className="lmain">
                      <div className="cname"><Link href={`/leads/${l.id}`}>{l.company}</Link></div>
                      <div className="cmeta">
                        <b>{l.who || 'Decision maker unknown'}</b>
                        {l.role ? ` · ${l.role}` : ''} · {l.loc}
                      </div>
                      <div className="pills">
                        <span className="pill o">Opportunity {l.opp}/5</span>
                        <span className="pill">Signals {l.buy}</span>
                        <span className={`pill ${l.estat === 'VERIFIED' ? 'v' : l.estat === 'UNKNOWN' ? 'u' : ''}`}>Email {l.estat}</span>
                        <span className={`pill ${l.pstat === 'VERIFIED' ? 'v' : 'u'}`}>Phone {l.pstat}</span>
                        <span className="pill geo">{String(l.geo || '').toUpperCase()}</span>
                        {l.owner && <span className="pill own">{l.owner}</span>}
                        <span className="pill">
                          <span className="dot" style={{ background: dotColour(l.status) }} />
                          {l.status}
                        </span>
                      </div>
                      <div className="inline">
                        <select value={l.status} onChange={(e) => patch(l.id, { status: e.target.value, ...(e.target.value !== 'Not sent' && !l.date_sent ? { date_sent: new Date().toISOString().slice(0, 10) } : {}) })}>
                          {STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                        <select value={l.owner || ''} onChange={(e) => patch(l.id, { owner: e.target.value })}>
                          <option value="">unassigned</option>
                          {TEAM.map((t) => <option key={t.name}>{t.name}</option>)}
                        </select>
                        <Link className="btn sm" href={`/leads/${l.id}`}>Open</Link>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        })
      )}

      <footer>
        <p>Live sending mailboxes: <b>shine@ · mtk@ · xiaolong@ · lucas@ astermade.com</b></p>
        <p style={{ marginTop: 6 }}>
          Credibility to cite: <b>Power Tagun Engineering</b> (Asia General Holding) and{' '}
          <b>Kaung Thu Kha Group Co., Ltd.</b>
        </p>
      </footer>
    </div>
  )
}
