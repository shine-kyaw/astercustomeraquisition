'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { STAGES } from '@/lib/crm'
import { api, ApiError, pref, setPref, today } from '../components/api'
import { Icon } from '../components/icons'
import { LogActivityDialog, type LeadLite } from '../components/log-activity'
import { useMe } from '../components/shell'
import {
  Info, Money, OwnerLabel, PriorityBadge, SkeletonRows, StageBadge, ago, moneyList, relDay, useToast,
} from '../components/ui'
import './dashboard.css'

type Task = {
  id: string; title: string; type: string; owner: string; due_on: string | null; due_time: string | null
  priority: string; lead_id: string | null; company: string | null; stage: string | null; contact: string | null
}
type LeadRow = { id: string; company: string; stage: string; owner: string; who?: string }
type ProposalRow = {
  id: string; company: string; owner: string; proposal_sent_on: string | null; proposal_amount: string | null
  currency: string; package: string
}
type StalledRow = LeadRow & { last_at: string | null }
type Amount = { currency: string; amount: number }

type Data = {
  today: string
  scope: 'mine' | 'team'
  me: string
  role: string
  attention: {
    overdue: Task[]; dueToday: Task[]; replies: Task[]; meetings: Task[]
    noNextStep: LeadRow[]; proposals: ProposalRow[]; stalled: StalledRow[]; staleResearch: number; reassign: LeadRow[]
  }
  founder: { worthFounder: LeadRow[] }
  overview: {
    counts: Record<string, number>
    pipelineValue: Amount[]; pipelineEstimate: Amount[]; wonValue: Amount[]; wonWithoutValue: number
  }
  pipeline: { stage: string; count: number; value: Amount[] }[]
  team: { owner: string; active: number; open_tasks: number; overdue: number; done_7d: number }[]
  settings: { monthly_capacity: number; stale_after_days: number }
  definitions: Record<string, string>
}

const LOG_TYPE: Record<string, string> = {
  call: 'call_connected', follow_up: 'followup_sent', reply: 'reply_received', meeting: 'meeting_held',
  proposal_followup: 'reply_received', send_email: 'email_sent',
}

const METRICS: { key: string; label: string }[] = [
  { key: 'active', label: 'Active' }, { key: 'contacted', label: 'Contacted' }, { key: 'replied', label: 'Replied' },
  { key: 'meetings', label: 'Meetings' }, { key: 'proposals', label: 'Proposals' }, { key: 'won', label: 'Won' },
]

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function longDate(ymd: string) {
  const d = new Date(`${ymd}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString('en-GB', { weekday: 'long' })
  return `${day}, ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 864e5)
}

export default function Dashboard() {
  const toast = useToast()
  const me = useMe()
  const [scope, setScope] = useState<'mine' | 'team'>('mine')
  const [ready, setReady] = useState(false)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<{ message: string; status: number } | null>(null)
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [logging, setLogging] = useState<{ lead: LeadLite; type: string } | null>(null)
  const seq = useRef(0)

  // The remembered scope is read after mount so the server and first client render agree.
  useEffect(() => {
    setScope(pref<'mine' | 'team'>('dash.scope', 'mine') === 'team' ? 'team' : 'mine')
    setReady(true)
  }, [])

  const load = useCallback(async (silent = false) => {
    const mySeq = ++seq.current
    if (!silent) { setError(null); setData(null) }
    try {
      const d = await api<Data>(`/api/dashboard?today=${today()}&scope=${scope}`)
      if (mySeq !== seq.current) return
      setData(d)
      setGone(new Set())
      setError(null)
    } catch (e) {
      if (mySeq !== seq.current || (e as Error).name === 'AbortError') return
      // A quiet background refresh that fails shouldn't wipe what's already on screen.
      if (silent) return
      setError({ message: (e as Error).message, status: e instanceof ApiError ? e.status : 0 })
    }
  }, [scope])

  useEffect(() => { if (ready) load() }, [ready, load])

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  function pickScope(s: 'mine' | 'team') {
    setScope(s)
    setPref('dash.scope', s)
  }

  async function complete(t: Task) {
    setGone((g) => new Set(g).add(t.id))
    try {
      await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: 'done' } })
      toast(`Done: ${t.title}`)
      me.refreshCounts()
      load(true)
    } catch (e) {
      setGone((g) => { const n = new Set(g); n.delete(t.id); return n })
      toast((e as Error).message, 'err')
    }
  }

  function logFor(lead: LeadLite, type: string) {
    setLogging({ lead, type })
  }

  // A task can sit in several server lists (an overdue reply is both). Show it once, in the
  // most urgent section, and drop any we've just completed.
  const seen = new Set<string>()
  const take = (rows: Task[] = []) => rows.filter((t) => {
    if (gone.has(t.id) || seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })
  const a = data?.attention
  const replies = take(a?.replies)
  const overdue = take(a?.overdue)
  const dueToday = take(a?.dueToday)
  const meetings = take(a?.meetings)
  const noNext = a?.noNextStep ?? []
  const proposals = a?.proposals ?? []
  const stalled = a?.stalled ?? []
  const reassign = a?.reassign ?? []
  const staleResearch = a?.staleResearch ?? 0
  const anything = replies.length + overdue.length + dueToday.length + meetings.length + noNext.length
    + proposals.length + stalled.length + reassign.length + staleResearch > 0
  const isTeam = scope === 'team'
  const isAdmin = me.role === 'owner' || me.role === 'admin'
  const first = (data?.me || me.name || '').split(' ')[0]

  const parts: string[] = []
  if (overdue.length) parts.push(`${overdue.length} overdue`)
  if (dueToday.length) parts.push(`${dueToday.length} due today`)
  if (replies.length) parts.push(`${plural(replies.length, 'reply', 'replies')} waiting`)
  const summary = parts.length ? parts.join(' · ') : 'Nothing overdue. A clear day.'

  return (
    <div className="page">
      <div className="phead">
        <div>
          <h1>{greeting()}{first ? `, ${first}` : ''}</h1>
          <p>{data ? `${longDate(data.today)} · ${summary}` : ' '}</p>
        </div>
        <div className="actions">
          <div className="seg" role="group" aria-label="Whose work to show">
            <button type="button" className={scope === 'mine' ? 'on' : ''} aria-pressed={scope === 'mine'} onClick={() => pickScope('mine')}>My work</button>
            <button type="button" className={scope === 'team' ? 'on' : ''} aria-pressed={scope === 'team'} onClick={() => pickScope('team')}>Whole team</button>
          </div>
        </div>
      </div>

      {error && (
        error.status === 503
          ? (
            <div className="note">
              <b>The database needs updating.</b> {error.message}{' '}
              <button type="button" className="btn sm" style={{ marginLeft: 8 }} onClick={() => load()}>Retry</button>
            </div>
          )
          : (
            <div className="err row" style={{ justifyContent: 'space-between' }}>
              <span>{error.message}</span>
              <button type="button" className="btn sm" onClick={() => load()}>Retry</button>
            </div>
          )
      )}

      {!data && !error && (
        <div className="dash">
          <div className="card flush"><SkeletonRows n={6} /></div>
          <div className="card flush"><SkeletonRows n={5} /></div>
        </div>
      )}

      {data && (
        <div className="dash">
          <div>
            {!anything && (
              <div className="card"><div className="empty"><b>All clear</b>Nothing needs your attention right now.</div></div>
            )}

            {replies.length > 0 && (
              <Section title="Replies waiting" count={replies.length} tone="red">
                {replies.map((t) => <TaskRow key={t.id} t={t} today={data.today} team={isTeam} onDone={complete} onLog={logFor} />)}
              </Section>
            )}
            {overdue.length > 0 && (
              <Section title="Overdue" count={overdue.length} tone="amber">
                {overdue.map((t) => <TaskRow key={t.id} t={t} today={data.today} team={isTeam} onDone={complete} onLog={logFor} />)}
              </Section>
            )}
            {dueToday.length > 0 && (
              <Section title="Due today" count={dueToday.length}>
                {dueToday.map((t) => <TaskRow key={t.id} t={t} today={data.today} team={isTeam} onDone={complete} onLog={logFor} />)}
              </Section>
            )}
            {meetings.length > 0 && (
              <Section title="Upcoming meetings" count={meetings.length}>
                {meetings.map((t) => <TaskRow key={t.id} t={t} today={data.today} team={isTeam} onDone={complete} onLog={logFor} />)}
              </Section>
            )}

            {proposals.length > 0 && (
              <Section title="Proposals awaiting a decision" count={proposals.length}>
                {proposals.map((p) => {
                  const days = p.proposal_sent_on ? daysBetween(p.proposal_sent_on, data.today) : null
                  return (
                    <div className="item" key={p.id}>
                      <div className="grow">
                        <Link className="t" href={`/leads/${p.id}`}>{p.company}</Link>
                        <div className="s">{days === null ? 'Sent date not recorded' : days === 0 ? 'Sent today' : `Sent ${plural(days, 'day')} ago`}</div>
                      </div>
                      <div className="meta">
                        {p.proposal_amount ? <Money amount={p.proposal_amount} currency={p.currency} /> : <span className="dim">No amount</span>}
                        {isTeam && <span className="hide-sm"><OwnerLabel name={p.owner} /></span>}
                        <button type="button" className="btn xs" onClick={() => logFor({ id: p.id, company: p.company, stage: 'proposal' }, 'reply_received')}>Log</button>
                      </div>
                    </div>
                  )
                })}
              </Section>
            )}

            {noNext.length > 0 && (
              <Section title="No next step" count={noNext.length} hint="Active conversations with nothing scheduled.">
                {noNext.map((l) => (
                  <div className="item" key={l.id}>
                    <div className="grow">
                      <Link className="t" href={`/leads/${l.id}`}>{l.company}</Link>
                      <div className="s">{l.who || 'No contact name'}</div>
                    </div>
                    <div className="meta">
                      <StageBadge stage={l.stage} />
                      {isTeam && <span className="hide-sm"><OwnerLabel name={l.owner} /></span>}
                      <Link className="btn xs" href={`/leads/${l.id}`}>Add a task</Link>
                      <button type="button" className="btn xs ghost" onClick={() => logFor({ id: l.id, company: l.company, who: l.who, stage: l.stage }, 'note')}>Log activity</button>
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {stalled.length > 0 && (
              <Section title="Stalled" count={stalled.length} hint={`No activity for ${data.settings.stale_after_days} days or more.`}>
                {stalled.map((l) => (
                  <div className="item" key={l.id}>
                    <div className="grow">
                      <Link className="t" href={`/leads/${l.id}`}>{l.company}</Link>
                      <div className="s">{l.last_at ? `Last activity ${ago(l.last_at)}` : 'No activity recorded'}</div>
                    </div>
                    <div className="meta">
                      <StageBadge stage={l.stage} />
                      {isTeam && <span className="hide-sm"><OwnerLabel name={l.owner} /></span>}
                      <button type="button" className="btn xs" onClick={() => logFor({ id: l.id, company: l.company, stage: l.stage }, 'note')}>Log</button>
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {reassign.length > 0 && (
              <Section title="Needs a new owner" count={reassign.length} hint="Owned by someone who has left the team.">
                {reassign.map((l) => (
                  <div className="item" key={l.id}>
                    <div className="grow">
                      <Link className="t" href={`/leads/${l.id}`}>{l.company}</Link>
                      <div className="s"><OwnerLabel name={l.owner} /></div>
                    </div>
                    <div className="meta">
                      <StageBadge stage={l.stage} />
                      <Link className="btn xs" href={`/leads/${l.id}`}>Assign</Link>
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {staleResearch > 0 && (
              <div className="note" style={{ marginTop: 0 }}>
                {plural(staleResearch, 'unsent lead')} {staleResearch === 1 ? 'has' : 'have'} research older than 14 days. Re-verify before sending.{' '}
                <Link href="/leads?view=stale_research">Review them</Link>
              </div>
            )}
          </div>

          <aside>
            <div className="card">
              <h4>Sales overview</h4>
              <div className="dash-metrics">
                {METRICS.map((m) => (
                  <div className="metric" key={m.key}>
                    <div className="v">{data.overview.counts[m.key] ?? 0}</div>
                    <div className="k">{m.label}{data.definitions[m.key] && <Info text={data.definitions[m.key]} />}</div>
                  </div>
                ))}
              </div>
              <dl className="kv" style={{ marginTop: 14 }}>
                <dt>Pipeline value <Info text={data.definitions.pipeline_value} /></dt>
                <dd>{moneyList(data.overview.pipelineValue)}</dd>
                {data.overview.pipelineEstimate.length > 0 && (
                  <>
                    <dt>Estimate <Info text={data.definitions.pipeline_estimate} /></dt>
                    <dd className="stack" style={{ gap: 2 }}>
                      {data.overview.pipelineEstimate.map((r) => <Money key={r.currency} amount={r.amount} currency={r.currency} estimate />)}
                    </dd>
                  </>
                )}
                <dt>Won value <Info text={data.definitions.won_value} /></dt>
                <dd>{moneyList(data.overview.wonValue)}</dd>
              </dl>
              {data.overview.wonWithoutValue > 0 && (
                <p className="amb" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
                  {plural(data.overview.wonWithoutValue, 'won deal')} {data.overview.wonWithoutValue === 1 ? 'has' : 'have'} no value recorded.
                </p>
              )}
            </div>

            <PipelineCard pipeline={data.pipeline} />

            <div className="card" style={{ padding: '12px 18px' }}>
              <span className="muted" style={{ fontSize: 12.5 }}>
                Delivery capacity: {plural(data.settings.monthly_capacity, 'project')} a month
              </span>
            </div>

            {isTeam && data.team.length > 0 && (
              <div className="card flush">
                <div className="chead"><h3>Workload</h3></div>
                <div className="table-wrap">
                  <table className="t">
                    <thead><tr><th>Owner</th><th className="r">Active</th><th className="r">Open</th><th className="r">Overdue</th><th className="r">Done, 7d</th></tr></thead>
                    <tbody>
                      {data.team.map((r) => (
                        <tr key={r.owner}>
                          <td><OwnerLabel name={r.owner} /></td>
                          <td className="r num">{r.active}</td>
                          <td className="r num">{r.open_tasks}</td>
                          <td className={`r num${r.overdue > 0 ? ' red' : ''}`}>{r.overdue}</td>
                          <td className="r num">{r.done_7d}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {isTeam && isAdmin && data.founder.worthFounder.length > 0 && (
              <div className="card flush">
                <div className="chead"><h3>Worth your attention <span className="badge">{data.founder.worthFounder.length}</span></h3></div>
                <div className="list">
                  {data.founder.worthFounder.map((l) => (
                    <div className="item" key={l.id}>
                      <div className="grow">
                        <Link className="t" href={`/leads/${l.id}`}>{l.company}</Link>
                        <div className="s"><OwnerLabel name={l.owner} /></div>
                      </div>
                      <StageBadge stage={l.stage} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {logging && (
        <LogActivityDialog
          lead={logging.lead}
          initialType={logging.type}
          onClose={() => setLogging(null)}
          onDone={() => { setLogging(null); me.refreshCounts(); load(true) }}
        />
      )}
    </div>
  )
}

function Section({ title, count, tone, hint, children }: { title: string; count: number; tone?: 'red' | 'amber'; hint?: string; children: ReactNode }) {
  return (
    <div className="card flush">
      <div className="chead">
        <h3>{title} <span className={`badge${tone ? ` ${tone}` : ''}`}>{count}</span></h3>
        {hint && <span className="dim hide-sm" style={{ fontSize: 12 }}>{hint}</span>}
      </div>
      <div className="list">{children}</div>
    </div>
  )
}

function TaskRow({ t, today, team, onDone, onLog }: {
  t: Task; today: string; team: boolean; onDone: (t: Task) => void; onLog: (lead: LeadLite, type: string) => void
}) {
  const time = t.due_time ? String(t.due_time).slice(0, 5) : ''
  const overdue = Boolean(t.due_on) && String(t.due_on).slice(0, 10) < today
  const due = t.type === 'meeting' && t.due_on
    ? `${relDay(t.due_on, today)}${time ? `, ${time}` : ''}`
    : `${relDay(t.due_on, today)}${time && !overdue ? ` · ${time}` : ''}`
  return (
    <div className="item">
      <button type="button" className="dash-check" aria-label={`Mark done: ${t.title}`} onClick={() => onDone(t)}><Icon name="check" /></button>
      <div className="grow">
        <div className="t">{t.title}</div>
        <div className="s">
          {t.lead_id ? <Link href={`/leads/${t.lead_id}`}>{t.company}</Link> : 'No lead'}
          {t.contact ? ` · ${t.contact}` : ''}
        </div>
      </div>
      <div className="meta">
        {team && <span className="hide-sm"><OwnerLabel name={t.owner} /></span>}
        <span className={overdue ? 'red' : undefined}>{due}</span>
        <PriorityBadge p={t.priority} />
        {t.lead_id && (
          <button
            type="button" className="btn xs ghost"
            onClick={() => onLog({ id: t.lead_id as string, company: t.company ?? '', who: t.contact ?? undefined, stage: t.stage ?? undefined }, LOG_TYPE[t.type] ?? 'note')}
          >Log</button>
        )}
      </div>
    </div>
  )
}

function PipelineCard({ pipeline }: { pipeline: Data['pipeline'] }) {
  const open = STAGES.filter((s) => s.key !== 'won' && s.key !== 'lost')
  const closed = STAGES.filter((s) => s.key === 'won' || s.key === 'lost')
  const counts = new Map(pipeline.map((p) => [p.stage as string, p]))
  const max = Math.max(1, ...open.map((s) => counts.get(s.key)?.count ?? 0))
  const withValue = open.filter((s) => (counts.get(s.key)?.value.length ?? 0) > 0)
  return (
    <div className="card flush">
      <div className="chead"><h3>Pipeline</h3><Link href="/pipeline" className="muted" style={{ fontSize: 12 }}>Open board</Link></div>
      <div style={{ padding: '6px 0' }}>
        {open.map((s) => {
          const n = counts.get(s.key)?.count ?? 0
          return (
            <Link key={s.key} href={`/pipeline?stage=${s.key}`} className="dash-stage" title={s.hint}>
              <span>{s.label}</span>
              <span className="bar" aria-hidden="true"><i style={{ width: `${(n / max) * 100}%`, opacity: n ? 1 : 0 }} /></span>
              <span className="n">{n}</span>
            </Link>
          )
        })}
      </div>
      <div className="row" style={{ borderTop: '1px solid var(--border)', padding: '10px 18px', gap: 18, fontSize: 12.5 }}>
        {closed.map((s) => (
          <Link key={s.key} href={`/pipeline?stage=${s.key}`} className="muted">
            {s.label} <b className="num" style={{ color: 'var(--text)', marginLeft: 4 }}>{counts.get(s.key)?.count ?? 0}</b>
          </Link>
        ))}
      </div>
      {withValue.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 18px', fontSize: 12, color: 'var(--dim)' }}>
          {withValue.map((s) => (
            <div key={s.key} className="row" style={{ justifyContent: 'space-between', padding: '2px 0' }}>
              <span>{s.label}</span>
              <span className="row" style={{ gap: 8 }}>
                {counts.get(s.key)!.value.map((v) => <Money key={v.currency} amount={v.amount} currency={v.currency} />)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
