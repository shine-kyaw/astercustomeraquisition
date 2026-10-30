'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { TASK_TYPES, PRIORITIES, taskTypeLabel } from '@/lib/crm'
import { TEAM } from '@/lib/constants'
import { api, today, pref, setPref, ApiError } from '@/app/components/api'
import { Dialog, ConfirmButton, Empty, OwnerLabel, PriorityBadge, SkeletonRows, relDay, fmtDateTime, useToast } from '@/app/components/ui'
import { Icon } from '@/app/components/icons'
import { LogActivityDialog } from '@/app/components/log-activity'
import { useMe } from '@/app/components/shell'

type Task = {
  id: string
  lead_id: string | null
  title: string
  type: string
  owner: string
  due_on: string | null
  due_time: string | null
  priority: string
  status: string
  notes: string | null
  created_at: string
  done_at: string | null
  done_by: string | null
  cancelled_reason: string | null
  company: string | null
  stage: string | null
  contact: string | null
}

type Filters = { owner: string; status: 'open' | 'done' | 'cancelled' }
const DEFAULTS: Filters = { owner: 'me', status: 'open' }

// Which activity the "Log" button pre-selects for each kind of task.
const LOG_TYPE: Record<string, string> = {
  call: 'call_connected', follow_up: 'followup_sent', reply: 'reply_received', meeting: 'meeting_held',
  proposal_followup: 'reply_received', send_email: 'email_sent', mockup: 'mockup_ready', present: 'mockup_presented',
}

const DAY = 864e5
function daysFrom(ymd: string | null, t: string): number | null {
  if (!ymd) return null
  return Math.round((Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`) - Date.parse(`${t}T00:00:00Z`)) / DAY)
}

const SECTIONS = [
  { key: 'overdue', label: 'Overdue', empty: 'Nothing overdue.' },
  { key: 'today', label: 'Today', empty: 'Nothing due today.' },
  { key: 'tomorrow', label: 'Tomorrow', empty: '' },
  { key: 'week', label: 'This week', empty: '' },
  { key: 'later', label: 'Later', empty: '' },
  { key: 'none', label: 'No date', empty: '' },
] as const
type SectionKey = (typeof SECTIONS)[number]['key']

function sectionOf(t: Task, now: string): SectionKey {
  const d = daysFrom(t.due_on, now)
  if (d === null) return 'none'
  if (d < 0) return 'overdue'
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d <= 7) return 'week'
  return 'later'
}

export default function Tasks() {
  const toast = useToast()
  const { refreshCounts } = useMe()
  const [filters, setFilters] = useState<Filters>(DEFAULTS)
  const [ready, setReady] = useState(false)
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [error, setError] = useState<{ message: string; status: number } | null>(null)
  const [justDone, setJustDone] = useState<Set<string>>(new Set())
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [logging, setLogging] = useState<Task | null>(null)
  const [rescheduling, setRescheduling] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  // Preferences live in localStorage, so they are read after mount to keep server and client markup identical.
  useEffect(() => {
    const saved = pref<Partial<Filters>>('tasks.filters', {})
    setFilters({
      owner: typeof saved.owner === 'string' && saved.owner ? saved.owner : DEFAULTS.owner,
      status: saved.status === 'done' || saved.status === 'cancelled' ? saved.status : 'open',
    })
    setReady(true)
    const pending = timers.current
    return () => { pending.forEach((x) => clearTimeout(x)) }
  }, [])

  const load = useCallback(async (f: Filters, signal?: AbortSignal) => {
    try {
      const d = await api<{ tasks: Task[] }>(`/api/tasks?owner=${encodeURIComponent(f.owner)}&status=${f.status}&today=${today()}`, { signal })
      setTasks(d.tasks)
      setError(null)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError({ message: (e as Error).message, status: e instanceof ApiError ? e.status : 0 })
      setTasks((t) => t ?? [])
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    const ctl = new AbortController()
    setTasks(null)
    setJustDone(new Set())
    load(filters, ctl.signal)
    return () => ctl.abort()
  }, [ready, filters, load])

  function change(patch: Partial<Filters>) {
    const next = { ...filters, ...patch }
    setFilters(next)
    setPref('tasks.filters', next)
  }

  const now = today()

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await api<{ task: Task }>(`/api/tasks/${id}`, { method: 'PATCH', body })
    refreshCounts()
    return res.task
  }

  function dropLater(id: string) {
    clearTimeout(timers.current.get(id))
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id)
      setJustDone((s) => { const n = new Set(s); n.delete(id); return n })
      setTasks((list) => list && list.filter((t) => t.id !== id))
    }, 4000))
  }

  // The row stays, struck through, for a few seconds so a mis-click can be undone in place.
  async function complete(t: Task) {
    setJustDone((s) => new Set(s).add(t.id))
    dropLater(t.id)
    try {
      await patch(t.id, { status: 'done' })
    } catch (e) {
      clearTimeout(timers.current.get(t.id))
      setJustDone((s) => { const n = new Set(s); n.delete(t.id); return n })
      toast((e as Error).message, 'err')
    }
  }

  async function undo(t: Task) {
    clearTimeout(timers.current.get(t.id))
    timers.current.delete(t.id)
    setJustDone((s) => { const n = new Set(s); n.delete(t.id); return n })
    try {
      await patch(t.id, { status: 'open' })
    } catch (e) {
      toast((e as Error).message, 'err')
      load(filters)
    }
  }

  async function reschedule(t: Task, due_on: string) {
    if (!due_on) return
    try {
      await patch(t.id, { due_on })
      setTasks((list) => list && list.map((x) => (x.id === t.id ? { ...x, due_on } : x)))
      setRescheduling(null)
      toast('Rescheduled')
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  async function cancel(t: Task) {
    try {
      await patch(t.id, { status: 'cancelled', reason: 'Cancelled by hand' })
      setTasks((list) => list && list.filter((x) => x.id !== t.id))
      toast('Task cancelled')
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  const open = filters.status === 'open'
  const everyone = filters.owner !== 'me'

  const grouped = useMemo(() => {
    const g: Record<SectionKey, Task[]> = { overdue: [], today: [], tomorrow: [], week: [], later: [], none: [] }
    for (const t of tasks ?? []) g[sectionOf(t, now)].push(t)
    return g
  }, [tasks, now])

  const subtitle = open && tasks
    ? `${grouped.overdue.length} overdue · ${grouped.today.length} today · ${grouped.today.length + grouped.tomorrow.length + grouped.week.length} this week`
    : 'What each person has to do next.'

  const history = useMemo(() => {
    if (open || !tasks) return []
    return [...tasks].sort((a, b) => String(b.done_at ?? b.created_at).localeCompare(String(a.done_at ?? a.created_at)))
  }, [tasks, open])

  function row(t: Task, mode: 'open' | 'done' | 'cancelled') {
    const finished = justDone.has(t.id)
    const dueDays = daysFrom(t.due_on, now)
    return (
      <div className={`item trow${finished ? ' finished' : ''}`} key={t.id}>
        {mode === 'open' && !finished ? (
          <button className="tick" aria-label="Mark done" title={t.title} onClick={() => complete(t)}><Icon name="check" /></button>
        ) : (
          <span
            className="tick"
            aria-hidden="true"
            style={mode === 'cancelled' ? { color: 'var(--dim)' } : { background: 'var(--green-soft)', borderColor: 'var(--green)', color: 'var(--green)' }}
          >
            <Icon name={mode === 'cancelled' ? 'x' : 'check'} />
          </span>
        )}
        <div className="grow">
          <div className="t">{t.title}</div>
          <div className="meta">
            <span className="badge">{taskTypeLabel(t.type)}</span>
            {t.company && t.lead_id && <Link href={`/leads/${t.lead_id}`}>{t.company}</Link>}
            {everyone && <OwnerLabel name={t.owner} />}
            {mode === 'open' && (
              <span className={dueDays !== null && dueDays < 0 ? 'red' : undefined}>
                {t.due_on ? relDay(t.due_on, now) : 'No date'}{t.due_time ? ` · ${t.due_time.slice(0, 5)}` : ''}
              </span>
            )}
            {mode === 'done' && <span>Done {fmtDateTime(t.done_at)}{t.done_by ? ` by ${t.done_by}` : ''}</span>}
            {mode === 'cancelled' && <span>Cancelled {fmtDateTime(t.done_at)}{t.cancelled_reason ? ` · ${t.cancelled_reason}` : ''}</span>}
            <PriorityBadge p={t.priority} />
          </div>
        </div>
        {mode === 'open' && (
          <div className="acts">
            {finished ? (
              <button className="btn xs" onClick={() => undo(t)}>Undo</button>
            ) : rescheduling === t.id ? (
              <>
                <label className="vh" htmlFor={`rs-${t.id}`}>New due date</label>
                <input
                  id={`rs-${t.id}`}
                  type="date"
                  defaultValue={t.due_on?.slice(0, 10) ?? now}
                  style={{ width: 'auto', padding: '4px 8px' }}
                  onChange={(e) => reschedule(t, e.target.value)}
                  autoFocus
                />
                <button className="btn xs ghost" onClick={() => setRescheduling(null)}>Close</button>
              </>
            ) : (
              <>
                {t.lead_id && <button className="btn xs" onClick={() => setLogging(t)}>Log</button>}
                <button className="btn xs ghost" onClick={() => setRescheduling(t.id)}>Reschedule</button>
                <ConfirmButton className="btn xs ghost" confirmText="Confirm cancel" onConfirm={() => cancel(t)}>Cancel</ConfirmButton>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  const specific = TEAM.some((m) => m.name === filters.owner) ? filters.owner : ''

  return (
    <div className="page">
      <div className="phead">
        <div>
          <h1>Tasks</h1>
          <p>{subtitle}</p>
        </div>
        <div className="actions">
          <button className="btn p" onClick={() => setNewOpen(true)}><Icon name="plus" /> New task</button>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12.5, margin: '-6px 0 16px', maxWidth: 720 }}>
        Follow-ups are created automatically when you log an email as sent (call on day 1, one follow-up on day 3) and are cancelled when they reply, book a meeting, or close.
      </p>

      <div className="row wrap" style={{ gap: 10, marginBottom: 16 }}>
        <div className="seg" role="group" aria-label="Owner">
          <button className={filters.owner === 'me' ? 'on' : ''} aria-pressed={filters.owner === 'me'} onClick={() => change({ owner: 'me' })}>Mine</button>
          <button className={filters.owner === 'all' ? 'on' : ''} aria-pressed={filters.owner === 'all'} onClick={() => change({ owner: 'all' })}>Everyone</button>
        </div>
        <label className="vh" htmlFor="t-owner">Show one person’s tasks</label>
        <select id="t-owner" value={specific} onChange={(e) => e.target.value && change({ owner: e.target.value })} style={{ width: 'auto' }}>
          <option value="">Person…</option>
          {TEAM.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
        </select>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Status">
          {(['open', 'done', 'cancelled'] as const).map((s) => (
            <button key={s} className={filters.status === s ? 'on' : ''} aria-pressed={filters.status === s} onClick={() => change({ status: s })}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {error && (error.status === 503 ? <div className="note">{error.message}</div> : <div className="err">{error.message}</div>)}

      {tasks === null ? (
        <div className="card flush"><SkeletonRows n={6} /></div>
      ) : open ? (
        tasks.length === 0 ? (
          error ? null : <div className="card"><Empty title="Nothing open.">{filters.owner === 'me' ? 'You are clear. New tasks appear here as you log outreach.' : 'No open tasks for this view.'}</Empty></div>
        ) : (
          <div className="stack" style={{ gap: 16 }}>
            {SECTIONS.map((s) => {
              const rows = grouped[s.key]
              if (!rows.length) {
                // Overdue and Today say so when empty, which is the good news; the rest stay out of the way.
                return s.empty ? (
                  <div key={s.key} className="card flush">
                    <div className="chead"><div className="tsec-h"><h3>{s.label}</h3><span className="n">0</span></div></div>
                    <div className="item"><span className="dim" style={{ fontSize: 13 }}>{s.empty}</span></div>
                  </div>
                ) : null
              }
              return (
                <section key={s.key} className="card flush" aria-label={s.label}>
                  <div className="chead"><div className={`tsec-h${s.key === 'overdue' ? ' hot' : ''}`}><h3>{s.label}</h3><span className="n">{rows.length}</span></div></div>
                  <div className="list">{rows.map((t) => row(t, 'open'))}</div>
                </section>
              )
            })}
          </div>
        )
      ) : history.length === 0 ? (
        error ? null : <div className="card"><Empty title={filters.status === 'done' ? 'Nothing completed yet.' : 'Nothing cancelled.'} /></div>
      ) : (
        <div className="card flush"><div className="list">{history.map((t) => row(t, filters.status as 'done' | 'cancelled'))}</div></div>
      )}

      {logging && logging.lead_id && (
        <LogActivityDialog
          lead={{ id: logging.lead_id, company: logging.company ?? 'this lead', who: logging.contact ?? undefined, owner: logging.owner, stage: logging.stage ?? undefined }}
          initialType={LOG_TYPE[logging.type] ?? 'note'}
          onClose={() => setLogging(null)}
          onDone={() => { refreshCounts(); load(filters) }}
        />
      )}
      {newOpen && <NewTask onClose={() => setNewOpen(false)} onCreated={() => { refreshCounts(); load(filters) }} />}
    </div>
  )
}

function NewTask({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast()
  const { name } = useMe()
  const [title, setTitle] = useState('')
  const [type, setType] = useState('other')
  const [owner, setOwner] = useState<string>(name || TEAM[0].name)
  const [due, setDue] = useState(today())
  const [time, setTime] = useState('')
  const [priority, setPriority] = useState('normal')
  const [notes, setNotes] = useState('')
  const [lead, setLead] = useState<{ id: string; company: string } | null>(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: string; company: string; loc?: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return }
    const ctl = new AbortController()
    const h = setTimeout(() => {
      api<{ leads: { id: string; company: string; loc?: string }[] }>(`/api/leads?q=${encodeURIComponent(q.trim())}&limit=8`, { signal: ctl.signal })
        .then((d) => setResults(d.leads))
        .catch(() => {})
    }, 200)
    return () => { clearTimeout(h); ctl.abort() }
  }, [q])

  async function submit() {
    if (!title.trim()) { setError('Give the task a title'); return }
    setBusy(true)
    setError('')
    try {
      await api('/api/tasks', {
        body: { title: title.trim(), type, owner, due_on: due || null, due_time: time || null, priority, notes: notes.trim(), lead_id: lead?.id ?? null },
      })
      toast('Task added')
      onCreated()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="New task"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Add task'}</button></>}
    >
      {error && <div className="err">{error}</div>}
      <div className="fgrid">
        <div className="f wide">
          <label htmlFor="nt-title">Title</label>
          <input id="nt-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="f">
          <label htmlFor="nt-type">Type</label>
          <select id="nt-type" value={type} onChange={(e) => setType(e.target.value)}>
            {TASK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div className="f">
          <label htmlFor="nt-owner">Owner</label>
          <select id="nt-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {TEAM.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
        </div>
        <div className="f">
          <label htmlFor="nt-due">Due date</label>
          <input id="nt-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <div className="f">
          <label htmlFor="nt-time">Time (optional)</label>
          <input id="nt-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div className="f">
          <label htmlFor="nt-pri">Priority</label>
          <select id="nt-pri" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
        </div>
        <div className="f wide">
          <label htmlFor="nt-lead">Related lead (optional)</label>
          {lead ? (
            <div className="row" style={{ gap: 8 }}>
              <span className="badge gold">{lead.company}</span>
              <button type="button" className="btn xs ghost" onClick={() => { setLead(null); setQ('') }}>Remove</button>
            </div>
          ) : (
            <>
              <input id="nt-lead" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by company" autoComplete="off" />
              {results.length > 0 && (
                <div className="tpick">
                  {results.map((r) => (
                    <button key={r.id} type="button" onClick={() => { setLead({ id: r.id, company: r.company }); setResults([]) }}>
                      {r.company}{r.loc && <span className="dim"> · {r.loc}</span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="f wide">
          <label htmlFor="nt-notes">Notes (optional)</label>
          <textarea id="nt-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Dialog>
  )
}
