'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { STAGES, WORKING_STAGES, LOST_REASONS, CURRENCIES, stageRank, type Package } from '@/lib/crm'
import { FORMER_NAMES } from '@/lib/constants'
import { api, ApiError, pref, setPref, today } from '@/app/components/api'
import { Dialog, Money, PriorityBadge, StageBadge, OwnerLabel, initials, relDay, ago, fmtDate, useToast } from '@/app/components/ui'
import { Icon } from '@/app/components/icons'
import { LogActivityDialog, type LeadLite } from '@/app/components/log-activity'
import { useMe } from '@/app/components/shell'

type Lead = {
  id: string
  company: string
  who?: string | null
  owner?: string | null
  stage: string
  phone?: string
  email?: string
  priority?: string
  deal_value?: string | null
  currency?: string
  package?: string
  expected_close?: string | null
  do_not_contact?: boolean
  proposal_sent_on?: string | null
  next_task_title?: string | null
  next_task_due?: string | null
  last_activity_at?: string | null
}

type Filter = 'all' | 'mine' | 'high' | 'stalled' | 'closing' | 'awaiting'
type View = 'board' | 'table'
type SortKey = 'stage' | 'company' | 'owner' | 'next' | 'last' | 'value' | 'close'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All active' },
  { key: 'mine', label: 'Mine' },
  { key: 'high', label: 'High value' },
  { key: 'stalled', label: 'Stalled' },
  { key: 'closing', label: 'Closing soon' },
  { key: 'awaiting', label: 'Awaiting reply' },
]

const DAY = 864e5
const CARD_CAP = 50
const ENGAGED_PLUS = ['engaged', 'meeting', 'mockup', 'proposal']
const isActive = (s: string) => s !== 'won' && s !== 'lost'

function sumByCurrency(leads: Lead[]): { currency: string; amount: number }[] {
  const m = new Map<string, number>()
  for (const l of leads) {
    if (l.deal_value === null || l.deal_value === undefined || l.deal_value === '') continue
    const n = Number(l.deal_value)
    if (!Number.isFinite(n)) continue
    const c = l.currency || 'USD'
    m.set(c, (m.get(c) ?? 0) + n)
  }
  return [...m].map(([currency, amount]) => ({ currency, amount }))
}

function Totals({ rows }: { rows: { currency: string; amount: number }[] }) {
  return <>{rows.map((r, i) => <span key={r.currency}>{i > 0 && ' · '}<Money amount={r.amount} currency={r.currency} /></span>)}</>
}

function matches(l: Lead, f: Filter, me: string, t: string): boolean {
  if (f === 'all') return true
  if (f === 'mine') return l.owner === me
  if (f === 'high') return l.priority === 'high' || (l.deal_value !== null && l.deal_value !== undefined && l.deal_value !== '')
  if (!isActive(l.stage)) return false
  if (f === 'awaiting') return l.stage === 'outreach'
  if (f === 'stalled') {
    if (!ENGAGED_PLUS.includes(l.stage)) return false
    return !l.last_activity_at || Date.now() - Date.parse(l.last_activity_at) > 14 * DAY
  }
  if (f === 'closing') {
    if (!l.expected_close) return false
    const d = Math.round((Date.parse(`${l.expected_close.slice(0, 10)}T00:00:00Z`) - Date.parse(`${t}T00:00:00Z`)) / DAY)
    return d <= 30
  }
  return true
}

function toLite(l: Lead): LeadLite {
  return {
    id: l.id, company: l.company, who: l.who ?? undefined, owner: l.owner ?? undefined, stage: l.stage,
    phone: l.phone, email: l.email, do_not_contact: l.do_not_contact, currency: l.currency, deal_value: l.deal_value, package: l.package,
  }
}

type Dlg = { kind: 'won' | 'lost'; lead: Lead } | { kind: 'log'; lead: Lead; type: string } | null

export default function Board() {
  const toast = useToast()
  const me = useMe()
  const params = useSearchParams()
  const t = today()

  const [leads, setLeads] = useState<Lead[]>([])
  const [totals, setTotals] = useState({ won: 0, lost: 0, active: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [view, setView] = useState<View>('board')
  const [filter, setFilter] = useState<Filter>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<Dlg>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'stage', dir: 1 })
  const seq = useRef(0)
  const scrolled = useRef(false)

  useEffect(() => {
    setView(pref<View>('pipeline.view', 'board'))
    setFilter(pref<Filter>('pipeline.filter', 'all'))
  }, [])

  const load = useCallback(async () => {
    const mine = ++seq.current
    try {
      const [a, w, c] = await Promise.all([
        api<{ leads: Lead[]; total: number }>(`/api/leads?stage=active&limit=500&sort=next&today=${t}`),
        api<{ leads: Lead[]; total: number }>('/api/leads?stage=won&limit=30&sort=recent'),
        api<{ leads: Lead[]; total: number }>('/api/leads?stage=lost&limit=30&sort=recent'),
      ])
      if (mine !== seq.current) return
      setLeads([...a.leads, ...w.leads, ...c.leads])
      setTotals({ active: a.total, won: w.total, lost: c.total })
      setError(null)
    } catch (e) {
      if (mine !== seq.current) return
      setError(e instanceof ApiError ? e : new ApiError(0, (e as Error).message))
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [t])
  useEffect(() => { load() }, [load])

  function changeView(v: View) { setView(v); setPref('pipeline.view', v) }
  function changeFilter(f: Filter) { setFilter(f); setPref('pipeline.filter', f) }

  // Linked from the dashboard: bring that column into view once it exists.
  const target = params.get('stage') === 'closed' ? 'lost' : params.get('stage')
  useEffect(() => {
    if (!target || loading || view !== 'board' || scrolled.current) return
    const el = document.getElementById(`col-${target}`)
    if (!el) return
    scrolled.current = true
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', inline: 'center', block: 'nearest' })
  }, [target, loading, view])

  const visible = useMemo(
    () => leads.filter((l) => matches(l, filter, me.name, t)),
    [leads, filter, me.name, t]
  )
  const filterCounts = useMemo(() => {
    const c = {} as Record<Filter, number>
    for (const f of FILTERS) c[f.key] = leads.filter((l) => isActive(l.stage) && matches(l, f.key, me.name, t)).length
    return c
  }, [leads, me.name, t])

  const activeLeads = leads.filter((l) => isActive(l.stage))
  const openValue = sumByCurrency(activeLeads.filter((l) => ENGAGED_PLUS.includes(l.stage)))

  // ── Moving ────────────────────────────────────────────────────────────────────────────

  /** Optimistic: the card moves now; a failure puts it back and says why. */
  async function commit(lead: Lead, patch: Record<string, unknown>, to: string, after?: () => void) {
    const original = lead
    setLeads((all) => all.map((l) => (l.id === lead.id ? { ...l, stage: to } : l)))
    try {
      const res = await api<{ lead: Partial<Lead> }>(`/api/leads/${lead.id}`, { method: 'PATCH', body: patch })
      setLeads((all) => all.map((l) => (l.id === lead.id ? { ...l, ...res.lead, stage: to } : l)))
      after?.()
    } catch (e) {
      setLeads((all) => all.map((l) => (l.id === lead.id ? original : l)))
      toast((e as Error).message, 'err')
    }
    load()
  }

  // The single path for drag and for the Move menu.
  function move(lead: Lead, to: string) {
    if (lead.stage === to) return
    if (to === 'outreach' && lead.do_not_contact) {
      toast(`${lead.company} asked not to be contacted, so it can’t be moved to Outreach.`, 'err')
      return
    }
    if (to === 'outreach' && lead.stage === 'new') {
      // A stage change is not a send: logging the email is what moves it.
      setDialog({ kind: 'log', lead, type: 'email_sent' })
      return
    }
    if (to === 'won') { setDialog({ kind: 'won', lead }); return }
    if (to === 'lost') { setDialog({ kind: 'lost', lead }); return }
    if (to === 'proposal') {
      commit(lead, { stage: 'proposal' }, 'proposal', () =>
        toast('Moved to Proposal. Log the proposal (amount, link) so the follow-up is scheduled.'))
      return
    }
    commit(lead, { stage: to }, to)
  }

  function onDrop(e: React.DragEvent, to: string) {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || dragId
    setOverCol(null)
    setDragId(null)
    const lead = leads.find((l) => l.id === id)
    if (lead) move(lead, to)
  }

  // ── Render ────────────────────────────────────────────────────────────────────────────

  const showAllNote = totals.active > activeLeads.length

  return (
    <div className="page">
      <div className="phead">
        <div>
          <h1>Pipeline</h1>
          <p>
            {loading ? 'Loading…' : (
              <>
                {totals.active} active
                {openValue.length > 0 && <> · <Totals rows={openValue} /> open</>}
              </>
            )}
          </p>
        </div>
        <div className="actions">
          <div className="seg" role="group" aria-label="View">
            <button className={view === 'board' ? 'on' : ''} aria-pressed={view === 'board'} onClick={() => changeView('board')}>Board</button>
            <button className={view === 'table' ? 'on' : ''} aria-pressed={view === 'table'} onClick={() => changeView('table')}>Table</button>
          </div>
        </div>
      </div>

      <div className="fbar">
        <div className="chips" role="group" aria-label="Filter">
          {FILTERS.map((f) => (
            <button key={f.key} className={`chip${filter === f.key ? ' on' : ''}`} aria-pressed={filter === f.key} onClick={() => changeFilter(f.key)}>
              {f.label}{!loading && <span className="n">{filterCounts[f.key]}</span>}
            </button>
          ))}
        </div>
      </div>

      {error && (
        error.status === 503
          ? <div className="note"><b>The database needs updating.</b> {error.message}</div>
          : <div className="err">{error.message} <button className="btn xs" onClick={() => { setLoading(true); load() }}>Try again</button></div>
      )}
      {showAllNote && <div className="note">Showing the first {activeLeads.length} of {totals.active} active leads. Narrow the filter or use <Link href="/leads">Leads</Link> for the rest.</div>}

      {loading ? (
        <div className="board" aria-busy="true">
          {STAGES.map((s, i) => (
            <div className="col skel-col" key={s.key}>
              <div className="chead"><h3>{s.label}</h3></div>
              <div className="cards">
                {Array.from({ length: 3 - (i % 2) }, (_, j) => <div className="skel" key={j} style={{ height: 74, borderRadius: 10 }} />)}
              </div>
            </div>
          ))}
        </div>
      ) : view === 'board' ? (
        <div className="board">
          {STAGES.map((s) => {
            const all = visible.filter((l) => l.stage === s.key)
            const open = expanded.has(s.key)
            const shown = open ? all : all.slice(0, CARD_CAP)
            const value = sumByCurrency(all)
            const closed = s.key === 'won' || s.key === 'lost'
            return (
              <section
                key={s.key}
                id={`col-${s.key}`}
                className={`col${overCol === s.key ? ' drop' : ''}${target === s.key ? ' hl' : ''}`}
                aria-label={`${s.label}, ${all.length} leads`}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverCol(s.key) } }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol((c) => (c === s.key ? null : c)) }}
                onDrop={(e) => onDrop(e, s.key)}
              >
                <div className="chead" title={s.hint}>
                  <h3>{s.label}</h3>
                  <span className="n">{all.length}</span>
                  {value.length > 0 && <span className="v"><Totals rows={value} /></span>}
                </div>
                <div className="cards">
                  {all.length === 0 && <div className="drop-ph">Drop here</div>}
                  {shown.map((l) => (
                    <Card
                      key={l.id}
                      lead={l}
                      today={t}
                      dragging={dragId === l.id}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'move'; setDragId(l.id) }}
                      onDragEnd={() => { setDragId(null); setOverCol(null) }}
                      onMove={(to) => move(l, to)}
                      onLogProposal={() => setDialog({ kind: 'log', lead: l, type: 'proposal_sent' })}
                    />
                  ))}
                  {all.length > CARD_CAP && !open && (
                    <button className="btn xs" onClick={() => setExpanded((x) => new Set(x).add(s.key))}>Show all {all.length}</button>
                  )}
                  {closed && (
                    <div className="col-note">
                      {totals[s.key as 'won' | 'lost'] > 30 ? 'Showing latest 30. ' : 'Showing latest. '}
                      <Link href={`/leads?stage=${s.key}`}>See all in Leads</Link>
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <PipelineTable leads={visible} today={t} sort={sort} setSort={setSort} onMove={move} />
      )}

      {dialog?.kind === 'log' && (
        <LogActivityDialog
          lead={toLite(dialog.lead)}
          initialType={dialog.type}
          onClose={() => setDialog(null)}
          onDone={() => { load() }}
        />
      )}
      {dialog?.kind === 'won' && (
        <WonDialog lead={dialog.lead} onClose={() => setDialog(null)}
          onSubmit={(body) => { const l = dialog.lead; setDialog(null); commit(l, { stage: 'won', ...body }, 'won') }} />
      )}
      {dialog?.kind === 'lost' && (
        <LostDialog lead={dialog.lead} onClose={() => setDialog(null)}
          onSubmit={(reason) => { const l = dialog.lead; setDialog(null); commit(l, { stage: 'lost', lost_reason: reason }, 'lost') }} />
      )}
    </div>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────────────────────

function MoveSelect({ lead, onMove, table = false }: { lead: Lead; onMove: (to: string) => void; table?: boolean }) {
  return (
    <select
      className={`mv${table ? ' tbl' : ''}`}
      aria-label={`Move ${lead.company} to another stage`}
      value={lead.stage}
      onChange={(e) => onMove(e.target.value)}
      draggable={false}
    >
      {STAGES.map((s) => <option key={s.key} value={s.key}>{table ? s.label : `Move: ${s.label}`}</option>)}
    </select>
  )
}

function NextAction({ lead, today: t }: { lead: Lead; today: string }) {
  if (lead.next_task_title) {
    const overdue = Boolean(lead.next_task_due) && String(lead.next_task_due).slice(0, 10) < t
    return (
      <>
        {lead.next_task_title}
        {lead.next_task_due && <> · <span className={overdue ? 'red' : ''}>{relDay(lead.next_task_due, t)}</span></>}
      </>
    )
  }
  if (WORKING_STAGES.includes(lead.stage as never)) return <span className="amb">No next step</span>
  return <span className="dim">—</span>
}

function Card({ lead, today: t, dragging, onDragStart, onDragEnd, onMove, onLogProposal }: {
  lead: Lead
  today: string
  dragging: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onMove: (to: string) => void
  onLogProposal: () => void
}) {
  const owner = lead.owner ? `${lead.owner}${FORMER_NAMES.includes(lead.owner) ? ' (left)' : ''}` : 'Unassigned'
  return (
    <div className={`kcard${dragging ? ' dragging' : ''}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="co"><Link href={`/leads/${lead.id}`} draggable={false}>{lead.company}</Link></div>
      {lead.who && <div className="meta">{lead.who}</div>}
      {isActive(lead.stage) && <div className="next"><NextAction lead={lead} today={t} /></div>}
      <div className="foot">
        <span className="avatar" title={owner} aria-label={`Owner: ${owner}`}>{lead.owner ? initials(lead.owner) : '?'}</span>
        {lead.deal_value && <Money amount={lead.deal_value} currency={lead.currency} />}
        <PriorityBadge p={lead.priority} />
        {lead.do_not_contact && <span className="badge red">Do not contact</span>}
        <span className="sp" />
        <MoveSelect lead={lead} onMove={onMove} />
      </div>
      {lead.stage === 'proposal' && !lead.proposal_sent_on && !lead.do_not_contact && (
        <button className="btn xs logp" onClick={onLogProposal}><Icon name="file" /> Log proposal</button>
      )}
    </div>
  )
}

function PipelineTable({ leads, today: t, sort, setSort, onMove }: {
  leads: Lead[]
  today: string
  sort: { key: SortKey; dir: 1 | -1 }
  setSort: (s: { key: SortKey; dir: 1 | -1 }) => void
  onMove: (l: Lead, to: string) => void
}) {
  const rows = useMemo(() => {
    const val = (l: Lead): string | number => {
      switch (sort.key) {
        case 'stage': return stageRank(l.stage)
        case 'company': return l.company.toLowerCase()
        case 'owner': return (l.owner ?? '').toLowerCase()
        case 'next': return l.next_task_due ? String(l.next_task_due).slice(0, 10) : '9999'
        case 'last': return l.last_activity_at ?? ''
        case 'value': return l.deal_value ? Number(l.deal_value) : -1
        case 'close': return l.expected_close ? String(l.expected_close).slice(0, 10) : '9999'
      }
    }
    return [...leads].sort((a, b) => {
      const x = val(a), y = val(b)
      const c = x < y ? -1 : x > y ? 1 : 0
      return c ? c * sort.dir : a.company.localeCompare(b.company)
    })
  }, [leads, sort])

  function head(key: SortKey, label: string, cls?: string) {
    const on = sort.key === key
    return (
      <th className={cls} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button className="sorthead" onClick={() => setSort({ key, dir: on && sort.dir === 1 ? -1 : 1 })}>
          {label}{on && <span className="ar" aria-hidden="true">{sort.dir === 1 ? '▲' : '▼'}</span>}
        </button>
      </th>
    )
  }

  if (!rows.length) return <div className="empty"><b>No leads match this filter</b></div>
  return (
    <div className="table-wrap">
      <table className="t">
        <thead>
          <tr>
            {head('company', 'Company')}
            {head('stage', 'Stage')}
            {head('owner', 'Owner')}
            {head('next', 'Next action')}
            {head('last', 'Last activity')}
            {head('value', 'Value', 'r')}
            {head('close', 'Expected close')}
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td className="co">
                <Link href={`/leads/${l.id}`}>{l.company}</Link>
                {l.do_not_contact && <> <span className="badge red">Do not contact</span></>}
                {l.who && <div className="sub">{l.who}</div>}
              </td>
              <td>
                <div className="row" style={{ gap: 8 }}>
                  <StageBadge stage={l.stage} />
                  <MoveSelect lead={l} onMove={(to) => onMove(l, to)} table />
                </div>
              </td>
              <td><OwnerLabel name={l.owner} /></td>
              <td>{isActive(l.stage) ? <NextAction lead={l} today={t} /> : <span className="dim">—</span>}</td>
              <td className="muted">{ago(l.last_activity_at)}</td>
              <td className="r">{l.deal_value ? <Money amount={l.deal_value} currency={l.currency} /> : <span className="dim">—</span>}</td>
              <td>{l.expected_close ? fmtDate(l.expected_close) : <span className="dim">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WonDialog({ lead, onClose, onSubmit }: {
  lead: Lead
  onClose: () => void
  onSubmit: (body: { deal_value?: string; currency: string; package?: string }) => void
}) {
  const [amount, setAmount] = useState(lead.deal_value ? String(lead.deal_value) : '')
  const [currency, setCurrency] = useState(lead.currency || 'USD')
  const [pkg, setPkg] = useState(lead.package ?? '')
  const [packages, setPackages] = useState<Package[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ settings: { packages: Package[] } }>('/api/settings').then((d) => setPackages(d.settings.packages)).catch(() => {})
  }, [])

  function pick(key: string) {
    setPkg(key)
    const p = packages.find((x) => x.key === key)
    // Only fills an empty amount: a reference price never overwrites a real quote.
    if (p && !amount) { setAmount(String(p.amount)); setCurrency(p.currency) }
  }

  function submit() {
    const clean = amount.replace(/[,\s]/g, '')
    if (clean && !Number.isFinite(Number(clean))) { setError('Amount must be a number'); return }
    onSubmit({ ...(clean ? { deal_value: clean } : {}), currency, ...(pkg ? { package: pkg } : {}) })
  }

  return (
    <Dialog
      title={`Mark ${lead.company} as won`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" onClick={submit}>Mark as won</button></>}
    >
      <div className="note">Won means agreed, not paid. The delivery handoff starts and every sales reminder ends.</div>
      {error && <div className="err">{error}</div>}
      <div className="fgrid">
        <div className="f">
          <label htmlFor="pw-pkg">Package</label>
          <select id="pw-pkg" value={pkg} onChange={(e) => pick(e.target.value)}>
            <option value="">—</option>
            {packages.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="f">
          <label htmlFor="pw-amt">Agreed amount</label>
          <div className="row" style={{ gap: 6 }}>
            <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ width: 96 }}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <input id="pw-amt" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>
      </div>
    </Dialog>
  )
}

function LostDialog({ lead, onClose, onSubmit }: { lead: Lead; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const options = LOST_REASONS.filter((r) => r.key !== 'dead')
  const hint = options.find((r) => r.key === reason)?.hint
  return (
    <Dialog
      title={`Close ${lead.company}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn p" onClick={() => (reason ? onSubmit(reason) : setError('Choose a reason'))}>Close lead</button>
        </>
      }
    >
      {error && <div className="err">{error}</div>}
      <div className="fgrid">
        <div className="f wide">
          <label htmlFor="pl-reason">Reason</label>
          <select id="pl-reason" value={reason} onChange={(e) => { setReason(e.target.value); setError('') }} required>
            <option value="">Choose a reason…</option>
            {options.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          {hint && <div className="hint">{hint}</div>}
        </div>
      </div>
    </Dialog>
  )
}
