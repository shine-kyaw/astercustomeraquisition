'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  TEAM, GEOS, VERIFICATION, CONFIDENCE, CHANNELS, TEMPLATES, FORMER_NAMES, FORMER_MAILS,
} from '@/lib/constants'
import { PRIORITIES, CURRENCIES, PACKAGES } from '@/lib/crm'
import { api, ApiError } from '@/app/components/api'
import { useToast } from '@/app/components/ui'
import { useMe } from '@/app/components/shell'
import { Icon } from '@/app/components/icons'

type Field = {
  k: string
  label: string
  type?: 'text' | 'area' | 'select' | 'date'
  opts?: readonly string[]
  rows?: number
  wide?: boolean
  hint?: string
}

const SECTIONS: { title: string; fields: Field[] }[] = [
  {
    title: 'Identity',
    fields: [
      { k: 'company', label: 'Company name', wide: true },
      { k: 'batch', label: 'Batch' },
      { k: 'seq', label: 'Number in batch' },
      { k: 'loc', label: 'Location' },
      { k: 'site', label: 'Website URL' },
      { k: 'geo', label: 'Geography', type: 'select', opts: GEOS.map((g) => g.k) },
      { k: 'source', label: 'Source' },
      { k: 'biz', label: 'What the business does', type: 'area', rows: 3, wide: true },
    ],
  },
  {
    title: 'Decision maker & contact',
    fields: [
      { k: 'who', label: 'Decision maker' },
      { k: 'role', label: 'Role / title' },
      { k: 'email', label: 'Email address' },
      { k: 'estat', label: 'Email status', type: 'select', opts: VERIFICATION, hint: 'Never mark an inferred address VERIFIED' },
      { k: 'phone', label: 'Phone' },
      { k: 'pstat', label: 'Phone status', type: 'select', opts: VERIFICATION },
      { k: 'channel', label: 'First channel', type: 'select', opts: CHANNELS },
      { k: 'note', label: 'Notes / caveats', type: 'area', rows: 2, wide: true },
    ],
  },
  {
    title: 'Deal',
    fields: [
      { k: 'priority', label: 'Priority', type: 'select', opts: PRIORITIES },
      { k: 'deal_value', label: 'Deal value' },
      { k: 'currency', label: 'Currency', type: 'select', opts: CURRENCIES },
      { k: 'package', label: 'Package', type: 'select', opts: PACKAGES },
      { k: 'expected_close', label: 'Expected close', type: 'date' },
      { k: 'next_step', label: 'Next step', wide: true },
    ],
  },
  {
    title: 'Scoring',
    fields: [
      { k: 'opp', label: 'Website opportunity (1–5)', type: 'select', opts: ['1', '2', '3', '4', '5'] },
      { k: 'buy', label: 'Buying signal score' },
      { k: 'conf', label: 'Confidence', type: 'select', opts: CONFIDENCE },
      { k: 'signals', label: 'Buying signals — one per line, e.g. "Recent funding — 3"', type: 'area', rows: 5, wide: true },
    ],
  },
  {
    title: 'Research',
    fields: [
      { k: 'researched_on', label: 'Researched on', type: 'date' },
      { k: 'verified_on', label: 'Last verified on', type: 'date' },
      { k: 'why', label: 'Why Aster should contact them', type: 'area', rows: 3, wide: true },
      { k: 'good', label: 'Positive observation', type: 'area', rows: 3, wide: true },
      { k: 'prob', label: 'Website opportunity — the observable problem', type: 'area', rows: 4, wide: true },
      { k: 'recent', label: 'Recent context', type: 'area', rows: 2, wide: true },
      { k: 'angle', label: 'Personalised angle', type: 'area', rows: 3, wide: true },
    ],
  },
  {
    title: 'Outreach',
    fields: [
      { k: 'owner', label: 'Owner', type: 'select', opts: ['', ...TEAM.map((t) => t.name)] },
      { k: 'sender', label: 'Send from', type: 'select', opts: ['', ...TEAM.filter((t) => t.live).map((t) => t.mail)] },
      { k: 'tmpl', label: 'Template', type: 'select', opts: ['', ...TEMPLATES] },
      { k: 'subj', label: 'Subject line', wide: true, hint: 'Aim under ~35 characters' },
      { k: 'mail', label: 'Email body', type: 'area', rows: 12, wide: true },
      { k: 'script', label: 'Phone script', type: 'area', rows: 6, wide: true },
    ],
  },
]

/**
 * A lead can carry a value that's no longer offered — an owner or mailbox belonging to
 * someone who has left. Keep it in the list so the select shows the truth and saving
 * doesn't quietly swap it for the first option.
 */
function withCurrent(opts: readonly string[], current: string | undefined): readonly string[] {
  return current && !opts.includes(current) ? [...opts, current] : opts
}

function optionLabel(o: string): string {
  if (!o) return '— none —'
  return FORMER_NAMES.includes(o) || FORMER_MAILS.includes(o) ? `${o} (left)` : o
}

const DATES = ['expected_close', 'researched_on', 'verified_on']

const BLANK: Record<string, string> = {
  company: '', batch: 'Batch 002', seq: '', loc: '', geo: 'us', site: '', source: '', biz: '',
  who: '', role: '', email: '', estat: 'UNKNOWN', phone: '', pstat: 'UNKNOWN', channel: 'email',
  priority: 'normal', deal_value: '', currency: 'USD', package: '', expected_close: '', next_step: '',
  opp: '3', buy: '0', conf: 'MEDIUM', why: '', good: '', prob: '', signals: '', recent: '', angle: '',
  researched_on: '', verified_on: '',
  owner: '', sender: '', tmpl: '', subj: '', mail: '', script: '', note: '',
}

export default function Editor({ id, me }: { id: string; me: string }) {
  const router = useRouter()
  const toast = useToast()
  const { role } = useMe()
  const isNew = id === 'new'
  const [form, setForm] = useState<Record<string, string>>(
    isNew && TEAM.some((t) => t.name === me) ? { ...BLANK, owner: me } : BLANK
  )
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isNew) return
    let live = true
    ;(async () => {
      try {
        const data = await api<{ lead: Record<string, unknown> }>(`/api/leads/${id}`)
        if (!live) return
        const next: Record<string, string> = { ...BLANK }
        for (const k of Object.keys(BLANK)) {
          const v = data.lead[k]
          next[k] = v === null || v === undefined ? '' : String(v)
          // Postgres hands back a full timestamp for a date column; the input wants YYYY-MM-DD.
          if (DATES.includes(k)) next[k] = next[k].slice(0, 10)
        }
        setForm(next)
      } catch (e) {
        if (live) setError((e as Error).message)
      }
      if (live) setLoading(false)
    })()
    return () => { live = false }
  }, [id, isNew])

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function save() {
    if (!form.company.trim()) { setError('A lead needs a company name'); return }
    setSaving(true); setError('')
    try {
      // A new lead starts as "Not sent", which the API defaults to; saying so keeps it explicit.
      const body = isNew ? { ...form, status: 'Not sent' } : form
      const data = await api<{ lead: { id: string } }>(isNew ? '/api/leads' : `/api/leads/${id}`, {
        method: isNew ? 'POST' : 'PATCH', body,
      })
      toast(isNew ? 'Lead created' : 'Saved')
      router.push(`/leads/${isNew ? data.lead.id : id}`)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  async function remove() {
    try {
      await api(`/api/leads/${id}`, { method: 'DELETE' })
      toast('Lead deleted. An admin can restore it.')
      router.push('/leads')
      router.refresh()
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? 'Only an owner or admin can delete leads.' : (e as Error).message)
    }
  }

  const back = isNew ? '/leads' : `/leads/${id}`
  const canDelete = role === 'owner' || role === 'admin'

  if (loading) {
    return (
      <div className="page">
        <div className="phead"><div><div className="skel" style={{ width: 260, height: 26 }} /></div></div>
        <div className="card stack"><div className="skel" /><div className="skel" style={{ width: '70%' }} /><div className="skel" style={{ width: '50%' }} /></div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="phead">
        <div>
          <Link className="muted" href={back} style={{ fontSize: 12.5, display: 'inline-flex', gap: 5, alignItems: 'center', marginBottom: 6 }}>
            <Icon name="back" /> {isNew ? 'Back to leads' : 'Back to lead'}
          </Link>
          <h1>{isNew ? 'New lead' : `Edit all fields${form.company ? ` · ${form.company}` : ''}`}</h1>
          <p>{isNew ? 'Add a prospect to the shared list.' : 'Stage and outreach history change through logged activity, not here.'}</p>
        </div>
      </div>

      {error && <div className="err" role="alert">{error}</div>}

      <div className="card">
        <div className="fgrid">
          {SECTIONS.map((section) => (
            <div key={section.title} style={{ display: 'contents' }}>
              <div className="fsec">{section.title}</div>
              {section.fields.map((f) => (
                <div className={`f${f.wide ? ' wide' : ''}`} key={f.k}>
                  <label htmlFor={f.k}>{f.label}</label>
                  {f.type === 'select' ? (
                    <select id={f.k} value={form[f.k] ?? ''} onChange={(e) => set(f.k, e.target.value)}>
                      {withCurrent(f.opts!, form[f.k]).map((o) => (
                        <option key={o} value={o}>{optionLabel(o)}</option>
                      ))}
                    </select>
                  ) : f.type === 'area' ? (
                    <textarea id={f.k} rows={f.rows ?? 3} value={form[f.k] ?? ''} onChange={(e) => set(f.k, e.target.value)} />
                  ) : f.type === 'date' ? (
                    <input id={f.k} type="date" value={form[f.k] ?? ''} onChange={(e) => set(f.k, e.target.value)} />
                  ) : (
                    <input id={f.k} type="text" value={form[f.k] ?? ''} onChange={(e) => set(f.k, e.target.value)} />
                  )}
                  {f.hint && <div className="hint">{f.hint}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="row wrap" style={{ marginTop: 24 }}>
          <button className="btn p" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Create lead' : 'Save changes'}
          </button>
          <Link className="btn" href={back}>Cancel</Link>
          {!isNew && canDelete && (
            <span style={{ marginLeft: 'auto' }}>
              <ConfirmDelete onConfirm={remove} />
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function ConfirmDelete({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button className="btn d" onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? 'Click again to confirm' : 'Delete lead'}
    </button>
  )
}
