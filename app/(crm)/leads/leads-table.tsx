'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { STAGES, WORKING_STAGES, researchAgeDays } from '@/lib/crm'
import { TEAM, GEOS, needsNewOwner } from '@/lib/constants'
import { api, pref, setPref, today } from '../../components/api'
import { Icon } from '../../components/icons'
import { LogActivityDialog } from '../../components/log-activity'
import { useMe } from '../../components/shell'
import { Empty, Money, OwnerLabel, SkeletonRows, StageBadge, ago, relDay, useToast } from '../../components/ui'
import { ImportDialog } from './import-dialog'

type Lead = Record<string, any>
type Result = { leads: Lead[]; total: number }

const PAGE = 50
const KEYS = ['q', 'stage', 'owner', 'geo', 'view', 'sort'] as const

const SORTS = [
  ['recent', 'Recently updated'],
  ['next', 'Next action'],
  ['company', 'Company A–Z'],
  ['batch', 'Batch'],
  ['value', 'Value'],
  ['opportunity', 'Opportunity score'],
] as const

const VIEWS = [
  ['', 'All'],
  ['mine', 'Mine'],
  ['no_next_step', 'No next step'],
  ['overdue', 'Overdue'],
  ['high_value', 'High value'],
  ['stale_research', 'Research >14 days'],
  ['reassign', 'Needs new owner'],
  ['dnc', 'Do not contact'],
] as const

export default function LeadsTable() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const { name: me } = useMe()
  const toast = useToast()

  const view = sp.get('view') ?? ''
  const urlQ = sp.get('q') ?? ''
  // A view such as "Do not contact" or "Overdue" has to be able to reach closed leads, so
  // without an explicit stage it looks across every stage instead of only the active ones.
  const stage = sp.get('stage') ?? (view ? 'all' : 'active')
  const owner = sp.get('owner') ?? ''
  const geo = sp.get('geo') ?? ''
  const sort = sp.get('sort') ?? 'recent'
  const page = Math.max(1, Number(sp.get('page')) || 1)

  const [qInput, setQInput] = useState(urlQ)
  const [data, setData] = useState<Result | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; status: number } | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [showImport, setShowImport] = useState(sp.get('import') === '1')
  const [logging, setLogging] = useState<Lead | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [copyError, setCopyError] = useState('')

  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const setParams = useCallback((changes: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    if (!('page' in changes)) next.delete('page')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname])

  // Remembered filters apply only when the link carried none, so a shared link always wins.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    if (sp.get('import') === '1') {
      const next = new URLSearchParams(window.location.search)
      next.delete('import')
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }
    if (KEYS.some((k) => sp.has(k))) return
    const saved = pref<Record<string, string> | null>('leads.filters', null)
    if (saved && typeof saved === 'object') {
      const changes: Record<string, string> = {}
      for (const k of KEYS) if (k !== 'q' && typeof saved[k] === 'string' && saved[k]) changes[k] = saved[k]
      if (Object.keys(changes).length) setParams(changes)
    }
  }, [sp, router, pathname, setParams])

  // Persist what you were looking at (not the search text or page) for next visit.
  useEffect(() => {
    if (!restored.current) return
    if (!KEYS.some((k) => sp.has(k))) return
    const saved: Record<string, string> = {}
    for (const k of KEYS) if (k !== 'q') saved[k] = sp.get(k) ?? ''
    setPref('leads.filters', saved)
  }, [sp])

  useEffect(() => {
    if (qInput === urlQ) return
    const t = setTimeout(() => setParams({ q: qInput.trim() }), 250)
    return () => clearTimeout(t)
  }, [qInput, urlQ, setParams])

  useEffect(() => { setQInput(urlQ) }, [urlQ])

  const apiQuery = useMemo(() => {
    const p = new URLSearchParams()
    if (urlQ) p.set('q', urlQ)
    if (stage) p.set('stage', stage)
    if (owner) p.set('owner', owner === 'me' ? me : owner)
    if (geo) p.set('geo', geo)
    if (view) p.set('view', view)
    p.set('sort', sort)
    p.set('limit', String(PAGE))
    p.set('offset', String((page - 1) * PAGE))
    p.set('today', today())
    return p.toString()
  }, [urlQ, stage, owner, geo, view, sort, page, me])

  useEffect(() => {
    const ctl = new AbortController()
    setLoading(true)
    api<Result>(`/api/leads?${apiQuery}`, { signal: ctl.signal })
      .then((d) => { setData(d); setError(null); setLoading(false) })
      .catch((e) => {
        if ((e as Error).name === 'AbortError') return
        setError({ message: (e as Error).message, status: (e as { status?: number }).status ?? 0 })
        setLoading(false)
      })
    return () => ctl.abort()
  }, [apiQuery, reloadTick])

  const reload = useCallback(() => setReloadTick((n) => n + 1), [])

  async function copyExclusionList() {
    setCopyError('')
    let text = ''
    let count = 0
    try {
      const d = await api<{ text: string; count: number }>('/api/exclusion-list')
      text = d.text
      count = d.count
    } catch (e) {
      setCopyError((e as Error).message)
      return
    }
    let ok = false
    // navigator.clipboard is missing on insecure origins and can be refused by permissions
    // policy, so fall back to the textarea-and-execCommand route before giving up.
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { ok = document.execCommand('copy') } catch { ok = false }
      ta.remove()
    }
    if (!ok) {
      // Don't let the list vanish: it is in the console for anyone who can copy from there.
      console.log(text)
      setCopyError('Could not copy to the clipboard. The exclusion list has been printed to the browser console instead.')
      return
    }
    setCopied(count)
    clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(null), 2500)
  }

  const total = data?.total ?? 0
  const leads = data?.leads ?? []
  const from = total ? (page - 1) * PAGE + 1 : 0
  const to = Math.min(page * PAGE, total)
  const hasFilters = !!(urlQ || owner || geo || view || stage !== 'active' || sort !== 'recent')
  const t = today()

  return (
    <div className="page">
      <div className="phead">
        <div>
          <h1>Leads</h1>
          <p>
            {data
              ? `${total.toLocaleString()} ${total === 1 ? 'company' : 'companies'}${hasFilters ? ' match these filters' : ' in play'}.`
              : 'Every company Aster is pursuing or has pursued.'}
          </p>
        </div>
        <div className="actions">
          <button
            className="btn"
            onClick={copyExclusionList}
            title="Copies every company already in the system or ruled out. Paste it into a new research batch so nobody re-researches a company we already have."
          >
            <Icon name="copy" />
            {copied !== null ? `Copied — ${copied} ${copied === 1 ? 'company' : 'companies'}` : 'Copy exclusion list'}
          </button>
          <Link className="btn" href="/leads/new"><Icon name="plus" /> Add lead</Link>
          <button className="btn p" onClick={() => setShowImport(true)}><Icon name="upload" /> Import batch</button>
        </div>
      </div>

      {copyError && <div className="err">{copyError}</div>}

      <div className="leads-toolbar">
        <div className="search">
          <input
            type="search"
            aria-label="Search leads"
            placeholder="Search company, person, location, notes"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>
        <select aria-label="Stage" value={stage} onChange={(e) => setParams({ stage: e.target.value })}>
          <option value="active">All active</option>
          <option value="all">All stages</option>
          {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select aria-label="Owner" value={owner} onChange={(e) => setParams({ owner: e.target.value })}>
          <option value="">Everyone</option>
          <option value="me">Me</option>
          {TEAM.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
          <option value="unassigned">Unassigned</option>
        </select>
        <select aria-label="Region" value={geo} onChange={(e) => setParams({ geo: e.target.value })}>
          <option value="">Any region</option>
          {GEOS.map((g) => <option key={g.k} value={g.k}>{g.label}</option>)}
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setParams({ sort: e.target.value })}>
          {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      <div className="chips leads-views" role="group" aria-label="Saved views">
        {VIEWS.map(([k, label]) => (
          <button
            key={k || 'all'}
            className={`chip${view === k ? ' on' : ''}`}
            aria-pressed={view === k}
            onClick={() => setParams({ view: k, stage: null })}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (error.status === 503
        ? <div className="note"><b>The database needs updating.</b> {error.message}</div>
        : <div className="err">{error.message}</div>)}

      {loading && !data ? (
        <div className="card flush"><SkeletonRows n={8} /></div>
      ) : !leads.length && !error ? (
        <Empty title="No leads match.">
          {hasFilters ? (
            <p style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => { setQInput(''); router.replace(pathname, { scroll: false }) }}>Clear filters</button>
            </p>
          ) : (
            <p className="muted" style={{ marginTop: 6 }}>Import a batch or add a lead to get started.</p>
          )}
        </Empty>
      ) : leads.length > 0 && (
        <div className="table-wrap" aria-busy={loading} style={loading ? { opacity: 0.6 } : undefined}>
          <table className="t leads-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Stage</th>
                <th>Owner</th>
                <th>Next action</th>
                <th className="c-last">Last activity</th>
                <th className="r c-value">Value</th>
                <th className="c-score">Score</th>
                <th><span className="sr-only" style={{ position: 'absolute', left: -9999 }}>Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => {
                const age = l.stage === 'new' ? researchAgeDays(l.researched_on, t) : null
                const overdue = !!l.next_task_due && String(l.next_task_due).slice(0, 10) < t
                const working = (WORKING_STAGES as readonly string[]).includes(l.stage)
                const sub = [l.who, l.role, l.loc].filter(Boolean).join(' · ')
                return (
                  <tr key={l.id}>
                    <td className="co">
                      <Link href={`/leads/${l.id}`}>{l.company}</Link>
                      <span className="flags">
                        {l.do_not_contact && <span className="badge red">Do not contact</span>}
                        {age !== null && age > 14 && <span className="badge amber">Research {age} days old</span>}
                      </span>
                      {sub && <div className="sub" title={sub}>{sub}</div>}
                    </td>
                    <td><StageBadge stage={l.stage} lostReason={l.lost_reason} /></td>
                    <td>
                      <div className="own">
                        <OwnerLabel name={l.owner} />
                        {needsNewOwner(l) && <span className="badge red">Needs new owner</span>}
                      </div>
                    </td>
                    <td className="nx">
                      {l.next_task_title ? (
                        <>
                          <div>{l.next_task_title}</div>
                          <div className={`sub${overdue ? ' red' : ''}`}>{relDay(l.next_task_due, t)}</div>
                        </>
                      ) : working && !l.do_not_contact ? (
                        <span className="badge amber">No next step</span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td className="c-last muted">{ago(l.last_activity_at)}</td>
                    <td className="r c-value"><Money amount={l.deal_value} currency={l.currency} /></td>
                    <td className="c-score num muted">{l.opp ?? '–'}/5 · {l.buy ?? '–'}</td>
                    <td className="act">
                      {!l.do_not_contact && (
                        <button className="iconbtn" aria-label={`Log activity for ${l.company}`} title="Log activity" onClick={() => setLogging(l)}>
                          <Icon name="plus" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="leads-pager">
          <span className="num">{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}</span>
          <div className="row">
            <button className="btn sm" disabled={page <= 1 || loading} onClick={() => setParams({ page: page > 2 ? String(page - 1) : null })}>Previous</button>
            <button className="btn sm" disabled={to >= total || loading} onClick={() => setParams({ page: String(page + 1) })}>Next</button>
          </div>
        </div>
      )}

      {logging && (
        <LogActivityDialog
          lead={logging as never}
          initialType={logging.stage === 'new' ? 'email_sent' : 'note'}
          onClose={() => setLogging(null)}
          onDone={() => { setLogging(null); reload() }}
        />
      )}

      {showImport && (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onImported={() => { reload(); toast('Batch imported') }}
        />
      )}
    </div>
  )
}
