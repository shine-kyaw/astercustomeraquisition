'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  TEAM, STATUSES, GEOS, VERIFICATION, CONFIDENCE, CHANNELS, TEMPLATES,
} from '@/lib/constants'

type Field = {
  k: string
  label: string
  type?: 'text' | 'area' | 'select'
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
      { k: 'note', label: 'Contact note / caveat' },
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
      { k: 'why', label: 'Why Aster should contact them', type: 'area', rows: 3, wide: true },
      { k: 'good', label: 'Positive observation', type: 'area', rows: 3, wide: true },
      { k: 'prob', label: 'Website opportunity — the observable problem', type: 'area', rows: 4, wide: true },
      { k: 'recent', label: 'Recent context', type: 'area', rows: 2, wide: true },
      { k: 'angle', label: 'Personalized angle', type: 'area', rows: 3, wide: true },
    ],
  },
  {
    title: 'Outreach',
    fields: [
      { k: 'owner', label: 'Owner', type: 'select', opts: ['', ...TEAM.map((t) => t.name)] },
      { k: 'sender', label: 'Send from', type: 'select', opts: ['', ...TEAM.map((t) => t.mail)] },
      { k: 'tmpl', label: 'Template', type: 'select', opts: ['', ...TEMPLATES] },
      { k: 'status', label: 'Status', type: 'select', opts: STATUSES },
      { k: 'date_sent', label: 'Date contacted (YYYY-MM-DD)' },
      { k: 'subj', label: 'Subject line', wide: true, hint: 'Aim under ~35 characters' },
      { k: 'mail', label: 'Email body', type: 'area', rows: 12, wide: true },
      { k: 'script', label: 'Phone script', type: 'area', rows: 6, wide: true },
    ],
  },
]

const BLANK: Record<string, string> = {
  company: '', batch: 'Batch 002', seq: '', loc: '', geo: 'us', site: '', biz: '',
  who: '', role: '', email: '', estat: 'UNKNOWN', phone: '', pstat: 'UNKNOWN', channel: 'email',
  opp: '3', buy: '0', conf: 'MEDIUM', why: '', good: '', prob: '', signals: '', recent: '', angle: '',
  owner: '', sender: '', tmpl: '', status: 'Not sent', date_sent: '', subj: '', mail: '', script: '', note: '',
}

export default function Editor({ id, me }: { id: string; me: string }) {
  const router = useRouter()
  const isNew = id === 'new'
  const [form, setForm] = useState<Record<string, string>>(BLANK)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (isNew) return
    ;(async () => {
      const res = await fetch(`/api/leads/${id}`)
      if (res.status === 401) { router.push('/login'); return }
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not load that lead'); setLoading(false); return }
      const next: Record<string, string> = { ...BLANK }
      for (const k of Object.keys(BLANK)) {
        const v = data.lead[k]
        next[k] = v === null || v === undefined ? '' : String(v)
      }
      // Postgres hands back a full timestamp for a date column; the input wants YYYY-MM-DD.
      if (next.date_sent) next.date_sent = next.date_sent.slice(0, 10)
      setForm(next)
      setLoading(false)
    })()
  }, [id, isNew, router])

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
    setSaved('')
  }

  async function save() {
    if (!form.company.trim()) { setError('A lead needs a company name'); return }
    setSaving(true); setError('')
    const res = await fetch(isNew ? '/api/leads' : `/api/leads/${id}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      setError(data.errors ? `${data.error}: ${data.errors.join('; ')}` : data.error ?? 'Could not save')
      return
    }
    if (isNew) { router.push(`/leads/${data.lead.id}`); router.refresh() }
    else setSaved(`Saved at ${new Date().toLocaleTimeString()}`)
  }

  async function remove() {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return }
    const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' })
    if (res.ok) { router.push('/'); router.refresh() }
    else setError('Could not delete that lead')
  }

  if (loading) return <div className="wrap"><div className="empty">Loading…</div></div>

  return (
    <div className="wrap">
      <div className="topline">
        <div>
          <div className="brand">
            <div className="mark">Aster<span>.</span></div>
            <div className="tag">{isNew ? 'New lead' : 'Edit lead'}</div>
          </div>
          <p className="sub">{isNew ? 'Add a prospect to the shared list.' : form.company}</p>
        </div>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, color: 'var(--violet)', fontWeight: 600 }}>{me}</span>
          <Link className="btn sm" href="/">Back to list</Link>
        </div>
      </div>

      {error && <div className="err" style={{ marginTop: 18 }}>{error}</div>}
      {saved && <div className="note" style={{ borderLeftColor: 'var(--green)' }}>{saved}</div>}

      <div className="card" style={{ marginTop: 18 }}>
        <div className="fgrid">
          {SECTIONS.map((section) => (
            <div key={section.title} style={{ display: 'contents' }}>
              <div className="fsec">{section.title}</div>
              {section.fields.map((f) => (
                <div className={`f${f.wide ? ' wide' : ''}`} key={f.k}>
                  <label htmlFor={f.k}>{f.label}</label>
                  {f.type === 'select' ? (
                    <select id={f.k} value={form[f.k] ?? ''} onChange={(e) => set(f.k, e.target.value)}>
                      {f.opts!.map((o) => (
                        <option key={o} value={o}>{o || '— none —'}</option>
                      ))}
                    </select>
                  ) : f.type === 'area' ? (
                    <textarea id={f.k} rows={f.rows ?? 3} value={form[f.k] ?? ''} onChange={(e) => set(f.k, e.target.value)} />
                  ) : (
                    <input id={f.k} type="text" value={form[f.k] ?? ''} onChange={(e) => set(f.k, e.target.value)} />
                  )}
                  {f.hint && <div className="hint">{f.hint}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 9, marginTop: 24, flexWrap: 'wrap' }}>
          <button className="btn p" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Create lead' : 'Save changes'}
          </button>
          <Link className="btn" href="/">Cancel</Link>
          {!isNew && (
            <button className="btn d" onClick={remove} style={{ marginLeft: 'auto' }}>
              {armed ? 'Click again to confirm' : 'Delete lead'}
            </button>
          )}
        </div>
      </div>

      {!isNew && (form.mail || form.script) && (
        <div className="card">
          <h4>Ready to send</h4>
          {form.mail && (
            <div className="mail">
              <div className="subj">Subject: {form.subj}</div>
              <pre>{form.mail}</pre>
            </div>
          )}
          {form.script && (
            <>
              <h4 style={{ marginTop: 18 }}>Phone script</h4>
              <div className="script">{form.script}</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
