'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { api, pref, setPref, today } from '@/app/components/api'
import { Info, Money, moneyList, fmtDate } from '@/app/components/ui'
import { lostReasonLabel } from '@/lib/crm'
import { GEOS } from '@/lib/constants'
import './reports.css'

type Row = { key: string; contacted: number; replied: number; meetings: number; won: number }
type Report = {
  from: string; to: string; tracking_since: string | null
  funnel: Record<'researched' | 'contacted' | 'replied' | 'meetings' | 'proposals' | 'won', number>
  outreach: { emails: number; followups: number; calls: number; calls_connected: number; messages: number; drafts: number; replies: number; interested_replies: number }
  replyRates: { emailed: number; replied: number; replied_before_followup: number; replied_after_followup: number; followed_up: number }
  byTemplate: Row[]; byGeo: Row[]; byOwner: Row[]
  closing: { won: number; lost_pitched: number; avg_cycle_days: number | null; won_with_proposal: number }
  wonRevenue: { currency: string; amount: number | string | null; count: number; without_value: number }[]
  byPackage: { package: string; currency: string; count: number; amount: number | string | null }[]
  lostReasons: { reason: string; count: number }[]
  tasks: { completed: number; on_time: number; overdue_now: number }
  definitions: Record<string, string>
}

type Preset = '7' | '30' | '90' | 'month' | 'custom'
const PRESETS: { k: Preset; label: string }[] = [
  { k: '7', label: 'Last 7 days' }, { k: '30', label: 'Last 30 days' }, { k: '90', label: 'Last 90 days' },
  { k: 'month', label: 'This month' }, { k: 'custom', label: 'Custom' },
]

function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00`)
  d.setDate(d.getDate() + n)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function rangeFor(preset: Preset, custom: { from: string; to: string }) {
  const t = today()
  if (preset === 'custom') return custom
  if (preset === 'month') return { from: `${t.slice(0, 8)}01`, to: t }
  return { from: addDays(t, -(Number(preset) - 1)), to: t }
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—')

export default function Reports() {
  const [preset, setPreset] = useState<Preset>('30')
  const [custom, setCustom] = useState(() => ({ from: addDays(today(), -29), to: today() }))
  const [data, setData] = useState<Report | null>(null)
  const [error, setError] = useState<{ message: string; status: number } | null>(null)
  const [dim, setDim] = useState<'byTemplate' | 'byGeo' | 'byOwner'>('byTemplate')

  useEffect(() => {
    const p = pref<Preset>('reports.range', '30')
    if (PRESETS.some((x) => x.k === p)) setPreset(p)
  }, [])

  const { from, to } = rangeFor(preset, custom)
  useEffect(() => {
    if (!from || !to || from > to) return
    const ac = new AbortController()
    setError(null)
    api<Report>(`/api/reports?from=${from}&to=${to}`, { signal: ac.signal })
      .then(setData)
      .catch((e) => { if (e.name !== 'AbortError') setError({ message: e.message, status: e.status }) })
    return () => ac.abort()
  }, [from, to])

  function pick(p: Preset) { setPreset(p); setPref('reports.range', p) }

  return (
    <div className="page">
      <div className="phead">
        <div><h1>Reports</h1><p>What was recorded as happening in the period, on the day it happened.</p></div>
        <div className="actions">
          <div className="seg" role="group" aria-label="Date range">
            {PRESETS.map((x) => <button key={x.k} className={preset === x.k ? 'on' : ''} onClick={() => pick(x.k)}>{x.label}</button>)}
          </div>
        </div>
      </div>

      {preset === 'custom' && (
        <div className="row wrap" style={{ marginBottom: 14 }}>
          <label className="muted" htmlFor="r-from">From</label>
          <input id="r-from" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} style={{ width: 150 }} />
          <label className="muted" htmlFor="r-to">To</label>
          <input id="r-to" type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} style={{ width: 150 }} />
          {from > to && <span className="red">The start date is after the end date.</span>}
        </div>
      )}

      {error && (error.status === 503
        ? <div className="note"><b>The database needs updating.</b> {error.message}</div>
        : <div className="err">{error.message}</div>)}

      {!data && !error && <Loading />}
      {data && <Body d={data} dim={dim} setDim={setDim} />}
    </div>
  )
}

function Loading() {
  return (
    <div className="stack" aria-busy="true">
      <div className="skel" style={{ height: 44 }} />
      <div className="skel" style={{ height: 200 }} />
      <div className="grid g4">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 80 }} />)}</div>
    </div>
  )
}

function Card({ title, info, children }: { title: string; info?: string; children: ReactNode }) {
  return (
    <section className="card" style={{ marginTop: 14 }}>
      <h4 className="row" style={{ gap: 6 }}>{title}{info && <Info text={info} />}</h4>
      {children}
    </section>
  )
}

function Tile({ label, value, sub, info }: { label: string; value: ReactNode; sub?: ReactNode; info?: string }) {
  return (
    <div className="metric">
      <div className="v">{value}</div>
      <div className="k">{label}{info && <Info text={info} />}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

const FUNNEL = [
  ['researched', 'Researched'], ['contacted', 'Contacted'], ['replied', 'Replied'],
  ['meetings', 'Meetings booked'], ['proposals', 'Proposals sent'], ['won', 'Won'],
] as const

function Body({ d, dim, setDim }: { d: Report; dim: 'byTemplate' | 'byGeo' | 'byOwner'; setDim: (x: 'byTemplate' | 'byGeo' | 'byOwner') => void }) {
  const def = d.definitions ?? {}
  const max = Math.max(1, ...FUNNEL.map(([k]) => d.funnel[k] ?? 0))
  const o = d.outreach
  const rr = d.replyRates
  const c = d.closing
  const rows = d[dim]
  const label = (k: string) => (dim === 'byGeo' ? GEOS.find((g) => g.k === k)?.label ?? k : k)
  const winDen = c.won + c.lost_pitched
  const withoutValue = d.wonRevenue.reduce((s, r) => s + (r.without_value || 0), 0)
  const revenue = d.wonRevenue.filter((r) => r.amount !== null).map((r) => ({ currency: r.currency, amount: Number(r.amount) }))

  return (
    <>
      <div className="note" style={{ marginTop: 0 }}>
        {def.tracking}{d.tracking_since && <> <b>Tracking since {fmtDate(d.tracking_since)}.</b></>}
        {' '}Showing {fmtDate(d.from)} to {fmtDate(d.to)}.
      </div>

      <Card title="Funnel">
        <div className="funnel">
          {FUNNEL.map(([k, name], i) => {
            const n = d.funnel[k] ?? 0
            const prev = i > 0 ? d.funnel[FUNNEL[i - 1][0]] ?? 0 : 0
            return (
              <div className="fstep" key={k}>
                <div className="lab">{name}<Info text={def[k] ?? ''} /></div>
                <div className="bar" aria-hidden="true"><i style={{ width: `${(n / max) * 100}%` }} /></div>
                <div className="cnt"><b>{n}</b><small>{i === 0 ? 'start' : `${pct(n, prev)} of previous`}</small></div>
              </div>
            )
          })}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          Each step counts leads with that event in the period, so a step can exceed the one before it when it came from earlier outreach.
        </p>
      </Card>

      <Card title="Outreach">
        <div className="grid g4">
          <Tile label="Emails sent" value={o.emails + o.followups} sub={`${o.emails} first emails · ${o.followups} follow-ups`} info={def.emails_sent} />
          <Tile label="Calls" value={o.calls} sub={`${o.calls_connected} connected`} info={def.calls} />
          <Tile label="Messages sent" value={o.messages} />
          <Tile label="Replies" value={o.replies} sub={`${o.interested_replies} interested or asked a question`} />
          <Tile label="Drafts (not sent)" value={o.drafts} sub="Created in Gmail, never counted as outreach" />
          <Tile
            label="Reply rate" info={def.reply_rate}
            value={pct(rr.replied, rr.emailed)}
            sub={rr.emailed > 0 ? `${rr.replied} of ${rr.emailed} first emailed in range · ${rr.replied_before_followup} before the follow-up · ${rr.replied_after_followup} after` : 'No first emails in this range'}
          />
        </div>
      </Card>

      <section className="card flush" style={{ marginTop: 14 }}>
        <div className="chead">
          <h3>Breakdown <Info text="Leads first contacted in the period, grouped. Replied, meetings and won are whether the lead ever got there, not only inside the period." /></h3>
          <div className="seg" role="group" aria-label="Group by">
            {([['byTemplate', 'Template'], ['byGeo', 'Market'], ['byOwner', 'Person']] as const).map(([k, l]) =>
              <button key={k} className={dim === k ? 'on' : ''} onClick={() => setDim(k)}>{l}</button>)}
          </div>
        </div>
        {rows.length === 0 ? <p className="muted" style={{ padding: 18, margin: 0 }}>No first contacts in this range.</p> : (
          <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
            <table className="t">
              <thead><tr>
                <th>{dim === 'byTemplate' ? 'Template' : dim === 'byGeo' ? 'Market' : 'Person'}</th>
                <th className="r">Contacted</th><th className="r">Replied</th><th className="r">Reply rate</th><th className="r">Meetings</th><th className="r">Won</th>
              </tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.key}>
                  <td>{label(r.key)}</td>
                  <td className="r num">{r.contacted}</td><td className="r num">{r.replied}</td>
                  <td className="r num">{pct(r.replied, r.contacted)}</td>
                  <td className="r num">{r.meetings}</td><td className="r num">{r.won}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <Card title="Business">
        <p className="muted" style={{ fontSize: 12.5, marginTop: -4 }}>Won means agreed contract value, not cash received.</p>
        <div className="grid g4">
          <Tile label="Won revenue (agreed)" value={moneyList(revenue)} sub={withoutValue > 0 ? `Without a value recorded: ${withoutValue}` : undefined} />
          <Tile label="Won" value={c.won} />
          <Tile label="Win rate" info={def.win_rate} value={pct(c.won, winDen)} sub={winDen > 0 ? `${c.won} won · ${c.lost_pitched} closed after outreach` : 'Nothing closed in this range'} />
          <Tile label="Average cycle" info={def.cycle} value={c.avg_cycle_days === null || c.avg_cycle_days === undefined ? '—' : `${c.avg_cycle_days} days`} />
          <Tile label="Proposal before close" value={pct(c.won_with_proposal, c.won)} sub={c.won > 0 ? `Of ${c.won} wins, ${c.won_with_proposal} had a proposal` : undefined} />
        </div>

        <div className="grid g2" style={{ marginTop: 16 }}>
          <div>
            <h4>Won by package</h4>
            {d.byPackage.length === 0 ? <p className="muted">No wins in this range.</p> : (
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>Package</th><th>Currency</th><th className="r">Won</th><th className="r">Agreed amount</th></tr></thead>
                  <tbody>{d.byPackage.map((r, i) => (
                    <tr key={i}><td>{r.package}</td><td>{r.currency}</td><td className="r num">{r.count}</td>
                      <td className="r"><Money amount={r.amount} currency={r.currency} /></td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <h4>Closed reasons</h4>
            {d.lostReasons.length === 0 ? <p className="muted">Nothing closed in this range.</p> : (
              <div className="list">
                {d.lostReasons.map((r) => (
                  <div className="item" key={r.reason}>
                    <div className="grow">{r.reason === 'unspecified' ? 'No reason recorded' : lostReasonLabel(r.reason)}</div>
                    <b className="num">{r.count}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card title="Follow-up discipline">
        <div className="grid g3">
          <Tile label="Tasks completed" value={d.tasks.completed} sub="Completed in this range" />
          <Tile label="Completed on time" value={pct(d.tasks.on_time, d.tasks.completed)} sub={d.tasks.completed > 0 ? `${d.tasks.on_time} of ${d.tasks.completed} on or before the due date` : undefined} />
          <Tile label="Overdue right now" value={d.tasks.overdue_now} sub="Open tasks past their due date" />
        </div>
      </Card>
    </>
  )
}
