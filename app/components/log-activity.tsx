'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  EVENT_TYPES, REPLY_KINDS, LOST_REASONS, CURRENCIES, CONTACT_EVENTS, DEPOSIT_STATUSES, type Package,
} from '@/lib/crm'
import { api, today } from './api'
import { Dialog, useToast } from './ui'

export type LeadLite = {
  id: string
  company: string
  who?: string
  owner?: string
  stage?: string
  phone?: string
  email?: string
  do_not_contact?: boolean
  currency?: string
  deal_value?: number | string | null
  package?: string
}

const GROUPS: { key: string; label: string }[] = [
  { key: 'outreach', label: 'Outreach' },
  { key: 'response', label: 'Their response' },
  { key: 'deal', label: 'Deal' },
  { key: 'internal', label: 'Internal' },
]

// What each type means in practice — shown under the picker so nobody guesses.
const HELP: Record<string, string> = {
  email_drafted: 'A draft is not a send. The lead stays "Not sent" and nothing counts as contact until you log the email as sent.',
  email_sent: 'Only once it has actually gone out. Schedules a call for tomorrow (if there’s a number) and the one follow-up for day 3.',
  followup_sent: 'The one follow-up. After this the sequence stops; a reminder to close it out comes 4 days later.',
  call_attempted: 'You called and nobody picked up.',
  voicemail: 'You left a voicemail (two at most per lead).',
  call_connected: 'You spoke to someone.',
  message_sent: 'WhatsApp, Viber or SMS actually sent.',
  reply_received: 'Stops the cold follow-ups and gives the owner a reply task for today.',
  bounced: 'Don’t guess another address. Look for a published one, or call.',
  opted_out: 'Marks the lead do-not-contact. Outreach can’t be logged against it again.',
  meeting_booked: 'Ends cold outreach and puts the meeting on the owner’s day.',
  mockup_started: 'Approved to prepare the free homepage mockup.',
  proposal_sent: 'Records the amount and date and schedules a follow-up in 3 days.',
  won: 'Agreed, not paid. Starts the delivery handoff and ends every sales reminder.',
  lost: 'Closes the deal with a reason. "Not now" and "No response" schedule a retry in 3 months.',
  note: 'Internal only.',
}

export function LogActivityDialog({
  lead, initialType = 'email_sent', onClose, onDone,
}: {
  lead: LeadLite
  initialType?: string
  onClose: () => void
  onDone?: (lead: Record<string, unknown>) => void
}) {
  const toast = useToast()
  const dnc = Boolean(lead.do_not_contact)
  const [type, setType] = useState(dnc && CONTACT_EVENTS.includes(initialType) ? 'note' : initialType)
  const [date, setDate] = useState(today())
  const [time, setTime] = useState('')
  const [summary, setSummary] = useState('')
  const [extRef, setExtRef] = useState('')
  const [kind, setKind] = useState('interested')
  const [reason, setReason] = useState('no_response')
  const [meetDate, setMeetDate] = useState('')
  const [meetTime, setMeetTime] = useState('')
  const [withWhom, setWithWhom] = useState(lead.who ?? '')
  const [link, setLink] = useState('')
  const [amount, setAmount] = useState(lead.deal_value ? String(lead.deal_value) : '')
  const [currency, setCurrency] = useState(lead.currency || 'USD')
  const [pkg, setPkg] = useState(lead.package ?? '')
  const [url, setUrl] = useState('')
  const [due, setDue] = useState('')
  const [deposit, setDeposit] = useState('pending')
  const [packages, setPackages] = useState<Package[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!['proposal_sent', 'won'].includes(type) || packages.length) return
    api<{ settings: { packages: Package[] } }>('/api/settings').then((d) => setPackages(d.settings.packages)).catch(() => {})
  }, [type, packages.length])

  const options = useMemo(() => EVENT_TYPES.filter((e) => e.group !== 'system' && e.key !== 'reopened'), [])

  function pickPackage(key: string) {
    setPkg(key)
    const p = packages.find((x) => x.key === key)
    // Quick-fill only when nothing is typed: a reference price never overwrites a real quote.
    if (p && !amount) { setAmount(String(p.amount)); setCurrency(p.currency) }
  }

  async function submit() {
    setError('')
    const meta: Record<string, unknown> = {}
    if (type === 'reply_received') meta.kind = kind
    if (type === 'lost') meta.reason = reason
    if (type === 'meeting_booked') {
      if (meetDate) meta.at = meetTime ? `${meetDate}T${meetTime}` : meetDate
      meta.tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (withWhom) meta.with = withWhom
      if (link) meta.link = link
    }
    if (type === 'mockup_started' && due) meta.due = due
    if (type === 'mockup_ready' && url) meta.url = url
    if (type === 'proposal_sent' || type === 'won') {
      if (amount) meta.amount = amount
      meta.currency = currency
      if (pkg) meta.package = pkg
      if (type === 'proposal_sent' && url) meta.url = url
      if (type === 'won') meta.deposit = deposit
    }
    if ((type === 'proposal_sent' || type === 'won') && amount && !Number.isFinite(Number(amount.replace(/[,\s]/g, '')))) {
      setError('Amount must be a number'); return
    }
    if (type === 'note' && !summary.trim()) { setError('Write the note first'); return }

    setBusy(true)
    try {
      const at = time ? new Date(`${date}T${time}`).toISOString() : undefined
      const res = await api<{ lead: Record<string, unknown> }>(`/api/leads/${lead.id}/events`, {
        body: { type, date, at, summary: summary.trim(), extRef: extRef.trim(), meta },
      })
      toast(`${EVENT_TYPES.find((e) => e.key === type)?.label ?? 'Activity'} logged for ${lead.company}`)
      onDone?.(res.lead)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const isEmail = ['email_sent', 'followup_sent', 'email_drafted', 'reply_received', 'bounced'].includes(type)
  const isCall = ['call_attempted', 'call_connected', 'voicemail'].includes(type)

  return (
    <Dialog
      title={`Log activity · ${lead.company}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn p" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Log it'}</button>
        </>
      }
    >
      {dnc && <div className="note"><b>{lead.company} asked not to be contacted.</b> Outreach can’t be logged; notes and deal updates still can.</div>}
      {error && <div className="err">{error}</div>}

      <div className="fgrid">
        <div className="f wide">
          <label htmlFor="la-type">What happened</label>
          <select id="la-type" value={type} onChange={(e) => setType(e.target.value)}>
            {GROUPS.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {options.filter((o) => o.group === g.key).map((o) => (
                  <option key={o.key} value={o.key} disabled={dnc && o.contact}>{o.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {HELP[type] && <div className="hint">{HELP[type]}</div>}
        </div>

        <div className="f">
          <label htmlFor="la-date">When</label>
          <input id="la-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </div>
        {(isCall || type === 'message_sent') && (
          <div className="f">
            <label htmlFor="la-time">Time (optional)</label>
            <input id="la-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        )}

        {type === 'reply_received' && (
          <div className="f wide">
            <label>How did they reply?</label>
            <div className="chips" role="radiogroup">
              {REPLY_KINDS.map((k) => (
                <button key={k.key} type="button" role="radio" aria-checked={kind === k.key} className={`chip${kind === k.key ? ' on' : ''}`} onClick={() => setKind(k.key)}>
                  {k.label}
                </button>
              ))}
            </div>
            {kind === 'no' && <div className="hint">This marks {lead.company} do-not-contact and closes the lead.</div>}
            {kind === 'not_now' && <div className="hint">Closes the lead and sets a reminder to retry in three months.</div>}
          </div>
        )}

        {type === 'lost' && (
          <div className="f wide">
            <label htmlFor="la-reason">Reason</label>
            <select id="la-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {LOST_REASONS.filter((r) => r.key !== 'dead').map((r) => <option key={r.key} value={r.key}>{r.label}: {r.hint}</option>)}
            </select>
          </div>
        )}

        {type === 'meeting_booked' && (
          <>
            <div className="f">
              <label htmlFor="la-md">Meeting date</label>
              <input id="la-md" type="date" value={meetDate} onChange={(e) => setMeetDate(e.target.value)} />
            </div>
            <div className="f">
              <label htmlFor="la-mt">Meeting time</label>
              <input id="la-mt" type="time" value={meetTime} onChange={(e) => setMeetTime(e.target.value)} />
            </div>
            <div className="f">
              <label htmlFor="la-with">With</label>
              <input id="la-with" type="text" value={withWhom} onChange={(e) => setWithWhom(e.target.value)} />
            </div>
            <div className="f">
              <label htmlFor="la-link">Call link or place</label>
              <input id="la-link" type="text" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Google Meet link, WhatsApp, address…" />
            </div>
            <div className="f wide"><div className="hint">Times are in your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</div></div>
          </>
        )}

        {type === 'mockup_started' && (
          <div className="f">
            <label htmlFor="la-due">Mockup due</label>
            <input id="la-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
        )}
        {(type === 'mockup_ready' || type === 'proposal_sent') && (
          <div className="f wide">
            <label htmlFor="la-url">{type === 'mockup_ready' ? 'Mockup link' : 'Proposal link'}</label>
            <input id="la-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </div>
        )}

        {(type === 'proposal_sent' || type === 'won') && (
          <>
            <div className="f">
              <label htmlFor="la-pkg">Package</label>
              <select id="la-pkg" value={pkg} onChange={(e) => pickPackage(e.target.value)}>
                <option value="">—</option>
                {packages.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                <option value="custom">Custom</option>
              </select>
            </div>
            <div className="f">
              <label htmlFor="la-amt">Amount</label>
              <div className="row" style={{ gap: 6 }}>
                <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ width: 96 }}>
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <input id="la-amt" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Agreed amount" />
              </div>
            </div>
            {type === 'won' && (
              <div className="f">
                <label htmlFor="la-dep">Deposit</label>
                <select id="la-dep" value={deposit} onChange={(e) => setDeposit(e.target.value)}>
                  {DEPOSIT_STATUSES.filter(Boolean).map((d) => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}
                </select>
                <div className="hint">Won means agreed. Mark the deposit paid only when the money is in.</div>
              </div>
            )}
          </>
        )}

        {isEmail && (
          <div className="f wide">
            <label htmlFor="la-ref">Gmail link (optional)</label>
            <input id="la-ref" type="text" value={extRef} onChange={(e) => setExtRef(e.target.value)} placeholder="Paste the thread or draft link so anyone can open it" />
          </div>
        )}

        <div className="f wide">
          <label htmlFor="la-sum">{type === 'reply_received' ? 'What they said (one line)' : type === 'note' ? 'Note' : 'Notes (optional)'}</label>
          <textarea id="la-sum" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </div>
      </div>
    </Dialog>
  )
}
