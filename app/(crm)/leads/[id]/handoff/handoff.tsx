'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { eventLabel } from '@/lib/crm'
import { api, ApiError } from '@/app/components/api'
import { Money, Empty, fmtDate, fmtDateTime, fmtWhen } from '@/app/components/ui'
import { Icon } from '@/app/components/icons'
import '../lead.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const day = (v: unknown) => s(v).slice(0, 10)
const isUrl = (v: unknown) => /^https?:\/\//i.test(s(v).trim())

function Block({ title, children, edit }: { title: string; children: ReactNode; edit?: string }) {
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <h4 style={{ margin: 0 }}>{title}</h4>
        <span className="spacer" />
        {edit && <Link className="btn xs ghost no-print" href={edit}>Edit</Link>}
      </div>
      {children}
    </div>
  )
}

const empty = <span className="dim">Not recorded</span>

export default function Handoff({ id }: { id: string }) {
  const [lead, setLead] = useState<Row | null>(null)
  const [events, setEvents] = useState<Row[]>([])
  const [error, setError] = useState<{ status: number; message: string } | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([api<{ lead: Row }>(`/api/leads/${id}`), api<{ events: Row[] }>(`/api/leads/${id}/events`)])
      .then(([l, e]) => { if (live) { setLead(l.lead); setEvents(e.events) } })
      .catch((e: ApiError) => { if (live) setError({ status: e.status ?? 0, message: e.message }) })
    return () => { live = false }
  }, [id])

  if (error) {
    return (
      <div className="page">
        {error.status === 503 ? <div className="note"><b>The database needs updating.</b> {error.message}</div> : <div className="err" role="alert">{error.message}</div>}
        <Link className="btn" href="/leads"><Icon name="back" /> Back to leads</Link>
      </div>
    )
  }
  if (!lead) {
    return (
      <div className="page" aria-busy="true">
        <div className="skel" style={{ width: 280, height: 28, marginBottom: 18 }} />
        <div className="card stack"><div className="skel" /><div className="skel" style={{ width: '60%' }} /></div>
      </div>
    )
  }

  const back = `/leads/${id}`
  const dealTab = `/leads/${id}`
  if (lead.stage !== 'won') {
    return (
      <div className="page">
        <Empty title="This lead isn’t won yet">
          <p>The handoff summary is for delivery, once a deal is agreed.</p>
          <div style={{ marginTop: 12 }}><Link className="btn" href={back}><Icon name="back" /> Back to {s(lead.company)}</Link></div>
        </Empty>
      </div>
    )
  }

  const recent = events.filter((e) => !e.voided_at).slice(0, 10)

  return (
    <div className="page ho">
      <div className="phead">
        <div>
          <Link className="muted no-print" href={back} style={{ fontSize: 12.5, display: 'inline-flex', gap: 5, alignItems: 'center', marginBottom: 6 }}>
            <Icon name="back" /> Back to lead
          </Link>
          <h1>Handoff · {s(lead.company)}</h1>
          <p>
            {lead.site ? <a href={isUrl(lead.site) ? s(lead.site) : `https://${s(lead.site)}`} target="_blank" rel="noopener noreferrer">{s(lead.site)}</a> : 'No website recorded'}
          </p>
        </div>
        <div className="actions no-print">
          <button className="btn p" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div className="grid g2">
        <Block title="Deal" edit={dealTab}>
          <dl className="kv">
            <dt>Package</dt><dd>{s(lead.package) ? s(lead.package)[0].toUpperCase() + s(lead.package).slice(1) : empty}</dd>
            <dt>Agreed price</dt><dd>{lead.deal_value ? <Money amount={lead.deal_value} currency={s(lead.currency)} /> : empty}</dd>
            <dt>Deposit</dt><dd>{s(lead.deposit_status) || empty}</dd>
            <dt>Deadline</dt><dd>{lead.deadline ? fmtDate(day(lead.deadline)) : empty}</dd>
            <dt>Project owner</dt><dd>{s(lead.project_owner) || empty}</dd>
          </dl>
          <p className="dim" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>Won means agreed. Deposit status is money actually received.</p>
        </Block>

        <Block title="Contact">
          <dl className="kv">
            <dt>Who</dt><dd>{s(lead.who) || empty}</dd>
            <dt>Role</dt><dd>{s(lead.role) || empty}</dd>
            <dt>Email</dt><dd>{lead.email ? <a href={`mailto:${s(lead.email)}`}>{s(lead.email)}</a> : empty}</dd>
            <dt>Phone</dt><dd>{lead.phone ? <a href={`tel:${s(lead.phone).replace(/[^\d+]/g, '')}`}>{s(lead.phone)}</a> : empty}</dd>
            <dt>Location</dt><dd>{s(lead.loc) || empty}</dd>
          </dl>
        </Block>
      </div>

      <Block title="Agreed scope" edit={dealTab}>
        {s(lead.handoff_notes).trim() ? <div className="prose">{s(lead.handoff_notes)}</div> : empty}
      </Block>

      <Block title="What the client needs">
        <dl className="kv" style={{ gridTemplateColumns: '1fr' }}>
          {([['The business', lead.biz], ['Why they were approached', lead.why], ['What needs fixing on the site', lead.prob]] as [string, unknown][]).map(([k, v]) => (
            <div key={k} style={{ marginBottom: 10 }}>
              <dt style={{ fontSize: 11.5, marginBottom: 3 }}>{k}</dt>
              <dd>{s(v).trim() ? <div className="prose">{s(v)}</div> : empty}</dd>
            </div>
          ))}
        </dl>
      </Block>

      <div className="grid g2">
        <Block title="Mockup" edit={dealTab}>
          {lead.mockup_url ? <a href={s(lead.mockup_url)} target="_blank" rel="noopener noreferrer">{s(lead.mockup_url)}</a> : empty}
          {lead.mockup_status && <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Status: {s(lead.mockup_status).replace(/_/g, ' ')}</div>}
        </Block>
        <Block title="Proposal" edit={dealTab}>
          {lead.proposal_url ? <a href={s(lead.proposal_url)} target="_blank" rel="noopener noreferrer">{s(lead.proposal_url)}</a> : empty}
          {lead.proposal_amount && <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Amount: <Money amount={lead.proposal_amount} currency={s(lead.currency)} /></div>}
        </Block>
      </div>

      <Block title="Important notes">
        {s(lead.note).trim() ? <div className="prose">{s(lead.note)}</div> : empty}
      </Block>

      <Block title="Recent timeline">
        {recent.length === 0 ? empty : (
          <div className="list">
            {recent.map((e) => (
              <div key={e.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <b>{eventLabel(s(e.type))}</b>
                <span className="dim"> · {fmtWhen(s(e.occurred_at), e.meta)}{e.who ? ` · ${s(e.who)}` : ''}</span>
                {e.summary && <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{s(e.summary)}</div>}
              </div>
            ))}
          </div>
        )}
      </Block>
    </div>
  )
}
