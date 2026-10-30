'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  STAGES, WORKING_STAGES, LOST_REASONS, CURRENCIES, PACKAGES, PRIORITIES, MOCKUP_STATUSES, PROPOSAL_STATUSES,
  DEPOSIT_STATUSES, TASK_TYPES, REPLY_KINDS, SYSTEM_EVENTS, eventLabel, lostReasonLabel, taskTypeLabel,
  researchAgeDays, type Package,
} from '@/lib/crm'
import { TEAM, needsNewOwner, FORMER_NAMES } from '@/lib/constants'
import { api, today, ApiError } from '@/app/components/api'
import {
  Dialog, ConfirmButton, StageBadge, OwnerLabel, PriorityBadge, Money, Empty, relDay, fmtDate, fmtDateTime, fmtWhen, ago, useToast,
} from '@/app/components/ui'
import { Icon, EVENT_ICON } from '@/app/components/icons'
import { useMe } from '@/app/components/shell'
import { LogActivityDialog } from '@/app/components/log-activity'
import './lead.css'

// Rows come straight from the API: numerics as strings, dates as 'YYYY-MM-DD'.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Lead = Record<string, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
type Timeline = { events: Row[]; tasks: { open: Row[]; done: Row[] } }
type TabKey = 'overview' | 'activity' | 'outreach' | 'research' | 'tasks' | 'deal'

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const day = (v: unknown) => s(v).slice(0, 10)
const dash = (v: unknown): ReactNode => (s(v).trim() ? s(v) : <span className="dim">—</span>)

function domain(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
function href(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}
function isUrl(v: unknown): boolean {
  return /^https?:\/\//i.test(s(v).trim())
}

function VerifyBadge({ v }: { v: string }) {
  if (v === 'VERIFIED') return <span className="badge green">Verified</span>
  if (v === 'PATTERN-CONFIRMED') return <span className="badge amber">Pattern-confirmed</span>
  return <span className="badge dim">Unknown</span>
}

export default function LeadDetail({ id }: { id: string }) {
  const toast = useToast()
  const { name: me, role, refreshCounts } = useMe()
  const admin = role === 'owner' || role === 'admin'

  const [lead, setLead] = useState<Lead | null>(null)
  const [tl, setTl] = useState<Timeline | null>(null)
  const [error, setError] = useState<{ status: number; message: string } | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  const [showVoided, setShowVoided] = useState(false)
  const [packages, setPackages] = useState<Package[]>([])
  const [dialog, setDialog] = useState<null | { kind: 'log'; type: string } | { kind: 'task' } | { kind: 'won' } | { kind: 'lost' }>(null)
  const [dncReason, setDncReason] = useState('')

  const load = useCallback(async () => {
    try {
      const [l, e] = await Promise.all([
        api<{ lead: Lead }>(`/api/leads/${id}`),
        api<Timeline>(`/api/leads/${id}/events${showVoided ? '?voided=1' : ''}`),
      ])
      setLead(l.lead)
      setTl(e)
      setError(null)
    } catch (e) {
      const err = e as ApiError
      setError({ status: err.status ?? 0, message: err.message })
    }
  }, [id, showVoided])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    // Reference prices are only hints; a failure here shouldn't break the page.
    api<{ settings: { packages: Package[] } }>('/api/settings').then((d) => setPackages(d.settings.packages ?? [])).catch(() => {})
  }, [])

  async function patch(body: Record<string, unknown>, ok = 'Saved'): Promise<boolean> {
    try {
      await api(`/api/leads/${id}`, { method: 'PATCH', body })
      toast(ok)
      await load()
      refreshCounts()
      return true
    } catch (e) {
      toast((e as Error).message, 'err')
      return false
    }
  }

  if (error) {
    return (
      <div className="page">
        {error.status === 404 ? (
          <Deleted id={id} admin={admin} onRestored={async () => { await load() }} />
        ) : error.status === 503 ? (
          <div className="note"><b>The database needs updating.</b> {error.message}</div>
        ) : (
          <>
            <div className="err" role="alert">{error.message}</div>
            <Link className="btn" href="/leads"><Icon name="back" /> Back to leads</Link>
          </>
        )}
      </div>
    )
  }

  if (!lead || !tl) return <Skeleton />

  const stage = s(lead.stage)
  const dnc = Boolean(lead.do_not_contact)
  const working = (WORKING_STAGES as readonly string[]).includes(stage)
  const nextTask = tl.tasks.open[0] as Row | undefined
  const age = researchAgeDays(day(lead.researched_on) || null, today())
  const staleResearch = stage === 'new' && age !== null && age > 14

  function moveStage(to: string) {
    if (to === stage) return
    if (to === 'outreach' && stage === 'new') setDialog({ kind: 'log', type: 'email_sent' })
    else if (to === 'won') setDialog({ kind: 'won' })
    else if (to === 'lost') setDialog({ kind: 'lost' })
    else patch({ stage: to }, `Moved to ${STAGES.find((x) => x.key === to)?.label ?? to}`)
  }

  const logType = stage === 'new' ? 'email_sent' : stage === 'outreach' ? 'reply_received' : 'note'

  async function completeTask(taskId: number | string) {
    try {
      await api(`/api/tasks/${taskId}`, { method: 'PATCH', body: { status: 'done' } })
      toast('Task done')
      await load()
      refreshCounts()
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  const tabs: { key: TabKey; label: string; n?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'activity', label: 'Activity', n: tl.events.filter((e) => !e.voided_at).length },
    { key: 'outreach', label: 'Outreach' },
    { key: 'research', label: 'Research' },
    { key: 'tasks', label: 'Tasks', n: tl.tasks.open.length },
    { key: 'deal', label: 'Deal' },
  ]

  return (
    <div className="page">
      <div className="ld-head">
        <Link className="muted" href="/leads" style={{ fontSize: 12.5, display: 'inline-flex', gap: 5, alignItems: 'center', marginBottom: 8 }}>
          <Icon name="back" /> Leads
        </Link>
        <h1>{s(lead.company)}</h1>
        <div className="ld-meta">
          {lead.site && (
            <a className="ld-site" href={href(s(lead.site))} target="_blank" rel="noopener noreferrer">
              {domain(s(lead.site))} <Icon name="external" />
            </a>
          )}
          <StageBadge stage={stage} lostReason={s(lead.lost_reason)} />
          <OwnerLabel name={s(lead.owner)} />
          {needsNewOwner(lead) && <span className="badge red">Needs a new owner</span>}
          <PriorityBadge p={s(lead.priority)} />
          {lead.deal_value && <Money amount={lead.deal_value} currency={s(lead.currency)} />}
          {dnc && <span className="badge red">Do not contact{lead.dnc_reason ? ` · ${s(lead.dnc_reason)}` : ''}</span>}
        </div>

        <div className="ld-actions">
          <button className="btn p" onClick={() => setDialog({ kind: 'log', type: logType })}><Icon name="plus" /> Log activity</button>
          <button className="btn" onClick={() => setDialog({ kind: 'task' })}>Add task</button>
          <label className="sr" htmlFor="stage-move" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Move to stage</label>
          <select id="stage-move" value={stage} onChange={(e) => moveStage(e.target.value)}>
            {STAGES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
          <Link className="btn ghost" href={`/leads/${id}/edit`}>Edit all fields</Link>
          {stage === 'won' && <Link className="btn" href={`/leads/${id}/handoff`}><Icon name="file" /> Handoff</Link>}
        </div>
      </div>

      {dnc && admin && (
        <div className="note ld-warn">
          <div className="row wrap">
            <span><b>Do not contact.</b> Outreach can’t be logged against this lead.</span>
            <span className="spacer" />
            <input
              type="text" aria-label="Reason for lifting do-not-contact" placeholder="Reason" value={dncReason}
              onChange={(e) => setDncReason(e.target.value)} style={{ width: 200 }}
            />
            <ConfirmButton onConfirm={() => patch({ do_not_contact: false, reason: dncReason }, 'Do-not-contact lifted')}>
              Lift do-not-contact
            </ConfirmButton>
          </div>
        </div>
      )}

      <div className="ld">
        <div>
          <div className="tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
                {t.label}{t.n !== undefined && <span className="n">{t.n}</span>}
              </button>
            ))}
          </div>

          {tab === 'overview' && <Overview lead={lead} />}
          {tab === 'activity' && (
            <Activity
              events={tl.events} me={me} admin={admin} showVoided={showVoided}
              onToggle={() => setShowVoided((v) => !v)} onChanged={load}
            />
          )}
          {tab === 'outreach' && <Outreach lead={lead} dnc={dnc} onLog={(type) => setDialog({ kind: 'log', type })} />}
          {tab === 'research' && <Research lead={lead} />}
          {tab === 'tasks' && <Tasks tl={tl} onAdd={() => setDialog({ kind: 'task' })} onChanged={async () => { await load(); refreshCounts() }} />}
          {tab === 'deal' && <Deal key={s(lead.updated_at)} lead={lead} packages={packages} onSave={(b) => patch(b, 'Deal saved')} />}
        </div>

        <aside className="ld-side" aria-label="Lead summary">
          <div className="card">
            <h4>Next action</h4>
            {nextTask ? (
              <div className="ld-task">
                <div style={{ minWidth: 0 }}>
                  <div className="t">{s(nextTask.title)}</div>
                  <div className={`s ${nextTask.due_on && day(nextTask.due_on) < today() ? 'red' : 'muted'}`} style={{ fontSize: 12.5, marginTop: 2 }}>
                    {relDay(day(nextTask.due_on), today())}{nextTask.due_time ? ` · ${s(nextTask.due_time).slice(0, 5)}` : ''}
                    <span className="dim"> · {s(nextTask.owner) || 'Unassigned'}</span>
                  </div>
                </div>
                <button className="btn sm" onClick={() => completeTask(nextTask.id)}><Icon name="check" /> Done</button>
              </div>
            ) : working ? (
              <div className="row wrap">
                <span className="badge amber">No next step</span>
                <span className="spacer" />
                <button className="btn sm" onClick={() => setDialog({ kind: 'task' })}>Add task</button>
              </div>
            ) : (
              <span className="dim" style={{ fontSize: 13 }}>No open tasks</span>
            )}
          </div>

          <div className="card">
            <h4>Contact</h4>
            <dl className="kv">
              <dt>Who</dt><dd>{dash(lead.who)}</dd>
              <dt>Role</dt><dd>{dash(lead.role)}</dd>
              <dt>Email</dt>
              <dd>
                {lead.email ? <><a href={`mailto:${s(lead.email)}`}>{s(lead.email)}</a> <VerifyBadge v={s(lead.estat)} /></> : <span className="dim">—</span>}
              </dd>
              <dt>Phone</dt>
              <dd>
                {lead.phone ? <><a href={`tel:${s(lead.phone).replace(/[^\d+]/g, '')}`}>{s(lead.phone)}</a> <VerifyBadge v={s(lead.pstat)} /></> : <span className="dim">—</span>}
              </dd>
              <dt>Channel</dt><dd>{dash(lead.channel)}</dd>
              <dt>Location</dt><dd>{dash(lead.loc)}</dd>
              <dt>Sender</dt><dd>{dash(lead.sender)}</dd>
            </dl>
          </div>

          <QuickNote id={id} onDone={load} />

          <div className="card">
            <h4>Facts</h4>
            {staleResearch && (
              <div className="note" style={{ margin: '0 0 10px', padding: '8px 11px', fontSize: 12.5 }}>
                Research is {age} days old. Re-verify every claim before sending.
              </div>
            )}
            <dl className="kv">
              <dt>Batch</dt><dd>{dash(lead.batch)}</dd>
              <dt>Source</dt><dd>{dash(lead.source)}</dd>
              <dt>Researched</dt>
              <dd>{lead.researched_on ? <>{fmtDate(day(lead.researched_on))}{age !== null && <span className="dim"> · {age}d ago</span>}</> : <span className="dim">—</span>}</dd>
              <dt>Verified</dt><dd>{lead.verified_on ? fmtDate(day(lead.verified_on)) : <span className="dim">—</span>}</dd>
              <dt>Added</dt><dd>{fmtDate(s(lead.created_at))}{lead.created_by && <span className="dim"> · {s(lead.created_by)}</span>}</dd>
              {lead.date_sent && (<><dt>First contacted</dt><dd>{fmtDate(day(lead.date_sent))}</dd></>)}
            </dl>
          </div>
        </aside>
      </div>

      {dialog?.kind === 'log' && (
        <LogActivityDialog
          lead={leadLite(lead)} initialType={dialog.type}
          onClose={() => setDialog(null)}
          onDone={async () => { setDialog(null); await load(); refreshCounts() }}
        />
      )}
      {dialog?.kind === 'task' && (
        <TaskDialog
          lead={lead} me={me}
          onClose={() => setDialog(null)}
          onDone={async () => { setDialog(null); toast('Task added'); await load(); refreshCounts() }}
        />
      )}
      {dialog?.kind === 'won' && (
        <WonDialog
          lead={lead} packages={packages}
          onClose={() => setDialog(null)}
          onSave={async (b) => { if (await patch({ stage: 'won', ...b }, 'Marked as won')) setDialog(null) }}
        />
      )}
      {dialog?.kind === 'lost' && (
        <LostDialog
          onClose={() => setDialog(null)}
          onSave={async (reason) => { if (await patch({ stage: 'lost', lost_reason: reason }, 'Closed')) setDialog(null) }}
        />
      )}
    </div>
  )
}

function leadLite(l: Lead) {
  return {
    id: s(l.id), company: s(l.company), who: s(l.who), owner: s(l.owner), stage: s(l.stage), phone: s(l.phone),
    email: s(l.email), do_not_contact: Boolean(l.do_not_contact), currency: s(l.currency), deal_value: l.deal_value, package: s(l.package),
  }
}

// ── States ──────────────────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="page" aria-busy="true">
      <div className="ld-head">
        <div className="skel" style={{ width: 280, height: 30 }} />
        <div className="row" style={{ marginTop: 14 }}><div className="skel" style={{ width: 90, height: 20 }} /><div className="skel" style={{ width: 120, height: 20 }} /></div>
      </div>
      <div className="ld">
        <div className="card stack">{[80, 60, 70, 40].map((w, i) => <div key={i} className="skel" style={{ width: `${w}%` }} />)}</div>
        <div className="card stack"><div className="skel" /><div className="skel" style={{ width: '60%' }} /></div>
      </div>
    </div>
  )
}

function Deleted({ id, admin, onRestored }: { id: string; admin: boolean; onRestored: () => void }) {
  const toast = useToast()
  async function restore() {
    try {
      await api(`/api/leads/${id}`, { method: 'PATCH', body: { restore: true } })
      toast('Lead restored')
      onRestored()
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }
  return (
    <Empty title={admin ? 'This lead was deleted' : 'Lead not found'}>
      <p>{admin ? 'It is hidden from every list. Restoring it puts it back as it was.' : 'It may have been deleted, or the link is wrong.'}</p>
      <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
        {admin && <button className="btn p" onClick={restore}>Restore lead</button>}
        <Link className="btn" href="/leads">Back to leads</Link>
      </div>
    </Empty>
  )
}

// ── Side panel ──────────────────────────────────────────────────────────────────────────

function QuickNote({ id, onDone }: { id: string; onDone: () => void }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  async function add() {
    if (!text.trim()) return
    setBusy(true)
    try {
      await api(`/api/leads/${id}/events`, { body: { type: 'note', date: today(), summary: text.trim() } })
      setText('')
      toast('Note added')
      onDone()
    } catch (e) {
      toast((e as Error).message, 'err')
    }
    setBusy(false)
  }
  return (
    <div className="card">
      <h4><label htmlFor="quick-note">Quick note</label></h4>
      <textarea id="quick-note" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Internal only" />
      <div style={{ marginTop: 8 }}>
        <button className="btn sm" onClick={add} disabled={busy || !text.trim()}>Add note</button>
      </div>
    </div>
  )
}

// ── Tabs ────────────────────────────────────────────────────────────────────────────────

function Overview({ lead }: { lead: Lead }) {
  const blocks: [string, unknown][] = [
    ['What the business does', lead.biz],
    ['Why Aster should contact them', lead.why],
    ['The personalised angle', lead.angle],
    ['Notes', lead.note],
    ['Their reply', lead.reply],
  ]
  return (
    <div className="card">
      <dl className="kv" style={{ gridTemplateColumns: '1fr' }}>
        {blocks.map(([k, v]) => (
          <div key={k} className="ld-sec" style={{ margin: 0, paddingBottom: 14 }}>
            <dt style={{ marginBottom: 4, fontSize: 11.5 }}>{k}</dt>
            <dd>{s(v).trim() ? <div className="prose">{s(v)}</div> : <span className="dim">—</span>}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Activity({ events, me, admin, showVoided, onToggle, onChanged }: {
  events: Row[]; me: string; admin: boolean; showVoided: boolean; onToggle: () => void; onChanged: () => void
}) {
  const toast = useToast()
  async function remove(evId: number | string) {
    try {
      await api(`/api/events/${evId}`, { method: 'DELETE' })
      toast('Entry removed')
      onChanged()
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }
  const shown = showVoided ? events : events.filter((e) => !e.voided_at)
  return (
    <div className="card">
      <div className="row wrap" style={{ marginBottom: 6 }}>
        <h4 style={{ margin: 0 }}>Timeline</h4>
        <span className="spacer" />
        <label className="check no-print"><input type="checkbox" checked={showVoided} onChange={onToggle} /> Show removed</label>
      </div>
      {shown.length === 0 ? (
        <Empty title="Nothing logged yet">Use Log activity to record an email, call or reply.</Empty>
      ) : (
        <div className="tl">
          {shown.map((e) => {
            const meta: Row = e.meta && typeof e.meta === 'object' ? e.meta : {}
            const voided = Boolean(e.voided_at)
            const migrated = e.type === 'migrated' || e.source === 'migrated'
            const canRemove = !voided && !SYSTEM_EVENTS.includes(s(e.type)) && (admin || s(e.who) === me)
            const kind = REPLY_KINDS.find((k) => k.key === meta.kind)?.label
            return (
              <div key={e.id} className={`ev${voided ? ' void' : ''}`} style={migrated ? { opacity: voided ? undefined : 0.7 } : undefined}>
                <span className="ic"><Icon name={EVENT_ICON[s(e.type)] ?? 'note'} /></span>
                <div style={{ minWidth: 0 }}>
                  <div className="what">
                    <b>{eventLabel(s(e.type))}</b>
                    {e.who && <span className="muted"> · {s(e.who)}</span>}
                    {e.source === 'status' && <span className="dim"> (recorded from a status change)</span>}
                    {voided && <span className="dim"> (removed)</span>}
                  </div>
                  <div className="when">{fmtWhen(s(e.occurred_at), e.meta)}{(e.meta as { date_only?: boolean } | null)?.date_only ? "" : ` · ${ago(s(e.occurred_at))}`}</div>
                  {e.summary && <div className="body">{s(e.summary)}</div>}
                  <div className="ld-ev-meta">
                    {kind && <span>Reply: {kind}</span>}
                    {meta.at && <span>Meeting {fmtDateTime(s(meta.at))}{meta.with ? ` with ${s(meta.with)}` : ''}</span>}
                    {meta.link && isUrl(meta.link) && <a href={s(meta.link)} target="_blank" rel="noopener noreferrer">Meeting link</a>}
                    {meta.amount && <span><Money amount={meta.amount} currency={s(meta.currency)} />{meta.package ? ` · ${s(meta.package)}` : ''}</span>}
                    {meta.reason && <span>Reason: {lostReasonLabel(s(meta.reason))}</span>}
                    {meta.url && isUrl(meta.url) && <a href={s(meta.url)} target="_blank" rel="noopener noreferrer">Link</a>}
                    {isUrl(e.ext_ref) ? (
                      <a href={s(e.ext_ref)} target="_blank" rel="noopener noreferrer">Open in Gmail</a>
                    ) : e.ext_ref ? <span>Ref: {s(e.ext_ref)}</span> : null}
                    {canRemove && (
                      <ConfirmButton
                        className="btn xs ghost"
                        confirmText="Click again to remove"
                        onConfirm={() => remove(e.id)}
                      >
                        <span title="Removing an entry does not undo its effects on the stage or tasks">Remove</span>
                      </ConfirmButton>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Outreach({ lead, dnc, onLog }: { lead: Lead; dnc: boolean; onLog: (type: string) => void }) {
  const toast = useToast()
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast(`${what} copied`)
    } catch {
      toast('Could not copy. Select the text and copy it by hand.', 'err')
    }
  }
  const has = lead.subj || lead.mail || lead.script
  return (
    <div className="card">
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          Template: {s(lead.tmpl) || '—'} · Send from: {s(lead.sender) || '—'}
        </span>
        <span className="spacer" />
        {!dnc && (
          <>
            <button className="btn sm" onClick={() => onLog('email_drafted')}><Icon name="draft" /> Log draft created</button>
            <button className="btn sm p" onClick={() => onLog('email_sent')}><Icon name="mail" /> Log email sent</button>
          </>
        )}
      </div>
      <p className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Drafts live in Gmail. Log the email as sent only once it has actually gone out.
      </p>
      {!has && <Empty title="No outreach written yet">Add a subject, email and phone script through Edit all fields.</Empty>}
      {(lead.subj || lead.mail) && (
        <div className="mail">
          <div className="row wrap" style={{ marginBottom: 8 }}>
            <div className="subj" style={{ flex: 1, minWidth: 0 }}>Subject: {s(lead.subj) || '—'}</div>
            {lead.subj && <button className="btn xs" onClick={() => copy(s(lead.subj), 'Subject')}><Icon name="copy" /> Copy subject</button>}
            {lead.mail && <button className="btn xs" onClick={() => copy(s(lead.mail), 'Email')}><Icon name="copy" /> Copy email</button>}
          </div>
          <pre>{s(lead.mail)}</pre>
        </div>
      )}
      {lead.note && (
        <div style={{ marginTop: 14 }}>
          <h4 className="label" style={{ marginBottom: 6 }}>Notes (including follow-up wording)</h4>
          <div className="prose">{s(lead.note)}</div>
        </div>
      )}
      {lead.script && (
        <div style={{ marginTop: 14 }}>
          <h4 className="label" style={{ marginBottom: 6 }}>Phone script</h4>
          <div className="script">{s(lead.script)}</div>
        </div>
      )}
    </div>
  )
}

function Research({ lead }: { lead: Lead }) {
  const signals = s(lead.signals).split('\n').map((x) => x.trim()).filter(Boolean)
  const blocks: [string, unknown][] = [
    ['Positive observation', lead.good],
    ['Website problem', lead.prob],
    ['Recent context', lead.recent],
  ]
  return (
    <div className="card">
      <dl className="kv" style={{ marginBottom: 16 }}>
        <dt>Opportunity</dt><dd>{lead.opp ? `${s(lead.opp)} / 5` : <span className="dim">—</span>}</dd>
        <dt>Confidence</dt><dd>{dash(lead.conf)}</dd>
      </dl>
      <div className="ld-sec">
        <h4>Buying signals</h4>
        {signals.length ? <ul className="ld-bullets">{signals.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span className="dim">—</span>}
      </div>
      {blocks.map(([k, v]) => (
        <div className="ld-sec" key={k}>
          <h4>{k}</h4>
          {s(v).trim() ? <div className="prose">{s(v)}</div> : <span className="dim">—</span>}
        </div>
      ))}
      <Link className="btn sm" href={`/leads/${s(lead.id)}/edit`}>Edit all fields</Link>
    </div>
  )
}

function Tasks({ tl, onAdd, onChanged }: { tl: Timeline; onAdd: () => void; onChanged: () => void }) {
  const toast = useToast()
  async function setStatus(taskId: number | string, body: Record<string, unknown>, msg: string) {
    try {
      await api(`/api/tasks/${taskId}`, { method: 'PATCH', body })
      toast(msg)
      onChanged()
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }
  const now = today()
  return (
    <div className="stack">
      <div className="card flush">
        <div className="chead">
          <h3>Open <span className="dim">{tl.tasks.open.length}</span></h3>
          <button className="btn sm" onClick={onAdd}><Icon name="plus" /> Add task</button>
        </div>
        {tl.tasks.open.length === 0 ? (
          <Empty title="No open tasks" />
        ) : (
          <div className="list">
            {tl.tasks.open.map((t) => (
              <div className="item" key={t.id} style={{ flexWrap: 'wrap' }}>
                <div className="grow" style={{ minWidth: 160 }}>
                  <div className="t">{s(t.title)}</div>
                  <div className={`s ${t.due_on && day(t.due_on) < now ? 'red' : ''}`}>
                    {taskTypeLabel(s(t.type))} · {relDay(day(t.due_on), now)}{t.due_time ? ` ${s(t.due_time).slice(0, 5)}` : ''} · {s(t.owner) || 'Unassigned'}
                  </div>
                </div>
                <button className="btn sm" onClick={() => setStatus(t.id, { status: 'done' }, 'Task done')}><Icon name="check" /> Done</button>
                <ConfirmButton
                  className="btn sm ghost" confirmText="Click again to cancel"
                  onConfirm={() => setStatus(t.id, { status: 'cancelled', reason: 'Cancelled by hand' }, 'Task cancelled')}
                >Cancel</ConfirmButton>
              </div>
            ))}
          </div>
        )}
      </div>
      {tl.tasks.done.length > 0 && (
        <div className="card flush">
          <div className="chead"><h3>Recently done</h3></div>
          <div className="list">
            {tl.tasks.done.map((t) => (
              <div className="item" key={t.id}>
                <div className="grow">
                  <div className="t muted">{s(t.title)}</div>
                  <div className="s">
                    {t.cancelled_reason
                      ? `Cancelled · ${s(t.cancelled_reason)}`
                      : `Done ${fmtDate(s(t.done_at))}${t.done_by ? ` by ${s(t.done_by)}` : ''}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Deal ────────────────────────────────────────────────────────────────────────────────

const DEAL_FIELDS = [
  'priority', 'deal_value', 'currency', 'package', 'expected_close', 'next_step',
  'mockup_status', 'mockup_url', 'mockup_due',
  'proposal_status', 'proposal_url', 'proposal_amount', 'proposal_sent_on', 'proposal_version',
  'deposit_status', 'project_owner', 'deadline', 'handoff_notes',
] as const
const DEAL_DATES = ['expected_close', 'mockup_due', 'proposal_sent_on', 'deadline']
const DEAL_MONEY = ['deal_value', 'proposal_amount']

function initialDeal(lead: Lead): Record<string, string> {
  const o: Record<string, string> = {}
  for (const k of DEAL_FIELDS) o[k] = DEAL_DATES.includes(k) ? day(lead[k]) : s(lead[k])
  if (!o.priority) o.priority = 'normal'
  if (!o.currency) o.currency = 'USD'
  return o
}

function sameValue(k: string, a: string, b: string): boolean {
  if (DEAL_MONEY.includes(k) && a.trim() && b.trim()) return Number(a.replace(/,/g, '')) === Number(b.replace(/,/g, ''))
  return a.trim() === b.trim()
}

function Deal({ lead, packages, onSave }: { lead: Lead; packages: Package[]; onSave: (b: Record<string, string>) => Promise<boolean> }) {
  const initial = initialDeal(lead)
  const [d, setD] = useState(initial)
  const [busy, setBusy] = useState(false)
  const won = s(lead.stage) === 'won'
  const set = (k: string, v: string) => setD((x) => ({ ...x, [k]: v }))
  const changed = DEAL_FIELDS.filter((k) => !sameValue(k, d[k], initial[k]))
  const ref = packages.find((p) => p.key === d.package)

  async function save() {
    if (!changed.length) return
    setBusy(true)
    const body: Record<string, string> = {}
    for (const k of changed) body[k] = d[k]
    await onSave(body)
    setBusy(false)
  }

  const text = (k: string, label: string, opts: { type?: string; wide?: boolean; hint?: ReactNode } = {}) => (
    <div className={`f${opts.wide ? ' wide' : ''}`}>
      <label htmlFor={`d-${k}`}>{label}</label>
      <input id={`d-${k}`} type={opts.type ?? 'text'} value={d[k]} onChange={(e) => set(k, e.target.value)} />
      {opts.hint && <div className="hint">{opts.hint}</div>}
    </div>
  )
  const select = (k: string, label: string, options: readonly string[], fmt: (o: string) => string = (o) => o || '— none —') => {
    const opts = d[k] && !options.includes(d[k]) ? [...options, d[k]] : options
    return (
      <div className="f">
        <label htmlFor={`d-${k}`}>{label}</label>
        <select id={`d-${k}`} value={d[k]} onChange={(e) => set(k, e.target.value)}>
          {opts.map((o) => <option key={o} value={o}>{fmt(o)}</option>)}
        </select>
      </div>
    )
  }
  const human = (o: string) => (o ? o.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '— none —')

  return (
    <div className="card">
      <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Won means agreed. Deposit status records money actually received.
      </p>
      <div className="ld-form">
        <div className="fsec">Value</div>
        {select('priority', 'Priority', PRIORITIES, human)}
        {text('expected_close', 'Expected close', { type: 'date' })}
        {text('deal_value', 'Deal value', { type: 'text' })}
        {select('currency', 'Currency', CURRENCIES)}
        <div className="f">
          <label htmlFor="d-package">Package</label>
          <select id="d-package" value={d.package} onChange={(e) => set('package', e.target.value)}>
            {PACKAGES.map((p) => <option key={p} value={p}>{p ? packages.find((x) => x.key === p)?.label ?? human(p) : '— none —'}</option>)}
          </select>
          {ref && <div className="hint">{ref.label} · {ref.currency} {Number(ref.amount).toLocaleString()} reference</div>}
        </div>
        {text('next_step', 'Next step', { wide: true })}

        <div className="fsec">Mockup</div>
        {select('mockup_status', 'Mockup status', MOCKUP_STATUSES, human)}
        {text('mockup_due', 'Mockup due', { type: 'date' })}
        {text('mockup_url', 'Mockup link', { wide: true, type: 'url' })}

        <div className="fsec">Proposal</div>
        {select('proposal_status', 'Proposal status', PROPOSAL_STATUSES, human)}
        {text('proposal_sent_on', 'Sent on', { type: 'date' })}
        {text('proposal_amount', 'Proposal amount')}
        {text('proposal_version', 'Version')}
        {text('proposal_url', 'Proposal link', { wide: true, type: 'url' })}

        {won && (
          <>
            <div className="fsec">Delivery</div>
            {select('deposit_status', 'Deposit status', DEPOSIT_STATUSES, human)}
            {text('deadline', 'Deadline', { type: 'date' })}
            <div className="f">
              <label htmlFor="d-project_owner">Project owner</label>
              <select id="d-project_owner" value={d.project_owner} onChange={(e) => set('project_owner', e.target.value)}>
                {[...['', ...TEAM.map((t) => t.name)], ...(d.project_owner && !TEAM.some((t) => t.name === d.project_owner) ? [d.project_owner] : [])].map((o) => (
                  <option key={o} value={o}>{o ? `${o}${FORMER_NAMES.includes(o) ? ' (left)' : ''}` : '— none —'}</option>
                ))}
              </select>
            </div>
            <div className="f wide">
              <label htmlFor="d-handoff_notes">Handoff notes (agreed scope)</label>
              <textarea id="d-handoff_notes" rows={4} value={d.handoff_notes} onChange={(e) => set('handoff_notes', e.target.value)} />
            </div>
          </>
        )}
      </div>
      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn p" onClick={save} disabled={busy || !changed.length}>{busy ? 'Saving…' : 'Save deal'}</button>
        {changed.length > 0 && <button className="btn ghost" onClick={() => setD(initial)}>Discard changes</button>}
      </div>
    </div>
  )
}

// ── Dialogs ─────────────────────────────────────────────────────────────────────────────

function TaskDialog({ lead, me, onClose, onDone }: { lead: Lead; me: string; onClose: () => void; onDone: () => void }) {
  const owners = TEAM.map((t) => t.name) as string[]
  const [title, setTitle] = useState('')
  const [type, setType] = useState('follow_up')
  const [due, setDue] = useState(today())
  const [time, setTime] = useState('')
  const [owner, setOwner] = useState(owners.includes(s(lead.owner)) ? s(lead.owner) : owners.includes(me) ? me : owners[0])
  const [priority, setPriority] = useState('normal')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!title.trim()) { setError('Give the task a title'); return }
    setBusy(true); setError('')
    try {
      await api('/api/tasks', { body: { lead_id: lead.id, title: title.trim(), type, owner, due_on: due, due_time: time, priority } })
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={`Add task · ${s(lead.company)}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" onClick={save} disabled={busy}>{busy ? 'Adding…' : 'Add task'}</button></>}
    >
      {error && <div className="err" role="alert">{error}</div>}
      <div className="ld-form">
        <div className="f wide"><label htmlFor="t-title">Title</label><input id="t-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></div>
        <div className="f"><label htmlFor="t-type">Type</label>
          <select id="t-type" value={type} onChange={(e) => setType(e.target.value)}>{TASK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
        <div className="f"><label htmlFor="t-owner">Owner</label>
          <select id="t-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>{owners.map((o) => <option key={o}>{o}</option>)}</select></div>
        <div className="f"><label htmlFor="t-due">Due date</label><input id="t-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <div className="f"><label htmlFor="t-time">Time (optional)</label><input id="t-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
        <div className="f"><label htmlFor="t-pri">Priority</label>
          <select id="t-pri" value={priority} onChange={(e) => setPriority(e.target.value)}>{PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</select></div>
      </div>
    </Dialog>
  )
}

function WonDialog({ lead, packages, onClose, onSave }: {
  lead: Lead; packages: Package[]; onClose: () => void
  onSave: (b: { deal_value: string; currency: string; package: string }) => Promise<void>
}) {
  const [amount, setAmount] = useState(s(lead.deal_value))
  const [currency, setCurrency] = useState(s(lead.currency) || 'USD')
  const [pkg, setPkg] = useState(s(lead.package))
  const [busy, setBusy] = useState(false)
  const ref = packages.find((p) => p.key === pkg)
  return (
    <Dialog
      title={`Mark ${s(lead.company)} as won`} onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn p" disabled={busy} onClick={async () => { setBusy(true); await onSave({ deal_value: amount, currency, package: pkg }); setBusy(false) }}>Mark as won</button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Won means agreed, not paid. Record the deposit later on the Deal tab.</p>
      <div className="ld-form">
        <div className="f"><label htmlFor="w-amt">Agreed amount</label><input id="w-amt" type="text" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
        <div className="f"><label htmlFor="w-cur">Currency</label>
          <select id="w-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="f wide"><label htmlFor="w-pkg">Package</label>
          <select id="w-pkg" value={pkg} onChange={(e) => setPkg(e.target.value)}>
            {PACKAGES.map((p) => <option key={p} value={p}>{p ? packages.find((x) => x.key === p)?.label ?? p : '— none —'}</option>)}
          </select>
          {ref && <div className="hint">{ref.label} · {ref.currency} {Number(ref.amount).toLocaleString()} reference</div>}
        </div>
      </div>
    </Dialog>
  )
}

function LostDialog({ onClose, onSave }: { onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const reasons = LOST_REASONS.filter((r) => r.key !== 'dead')
  const [reason, setReason] = useState('no_response')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      title="Close this lead" onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn p" disabled={busy} onClick={async () => { setBusy(true); await onSave(reason); setBusy(false) }}>Close lead</button>
        </>
      }
    >
      <div className="f">
        <label htmlFor="l-reason">Reason</label>
        <select id="l-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          {reasons.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <div className="hint">{reasons.find((r) => r.key === reason)?.hint}</div>
      </div>
    </Dialog>
  )
}
