'use client'

import { useEffect, useState } from 'react'
import { api } from '@/app/components/api'
import { useToast } from '@/app/components/ui'
import { useMe } from '@/app/components/shell'
import { CURRENCIES } from '@/lib/crm'
import { TEAM, FORMER_NAMES } from '@/lib/constants'

type Pkg = { key: string; label: string; amount: number | string; currency: string; isNew?: boolean }
type S = { packages: Pkg[]; monthly_capacity: number | string; stale_after_days: number | string; research_max_age_days: number | string }

export default function Settings() {
  const { role } = useMe()
  const admin = role === 'owner' || role === 'admin'
  const toast = useToast()
  const [s, setS] = useState<S | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ settings: S }>('/api/settings').then((d) => setS(d.settings)).catch((e) => setError(e.message))
  }, [])

  function pkg(i: number, patch: Partial<Pkg>) {
    if (!s) return
    setS({ ...s, packages: s.packages.map((p, j) => (j === i ? { ...p, ...patch } : p)) })
  }

  async function save() {
    if (!s) return
    setBusy(true); setError(null)
    try {
      const body = {
        packages: s.packages.map((p) => ({ key: p.key, label: p.label || p.key, amount: Number(p.amount), currency: p.currency })),
        monthly_capacity: Number(s.monthly_capacity),
        stale_after_days: Number(s.stale_after_days),
        research_max_age_days: Number(s.research_max_age_days),
      }
      const d = await api<{ settings: S }>('/api/settings', { method: 'PUT', body })
      setS(d.settings)
      toast('Settings saved')
    } catch (e) { setError((e as Error).message); toast((e as Error).message, 'err') } finally { setBusy(false) }
  }

  const num = (id: string, label: string, k: 'monthly_capacity' | 'stale_after_days' | 'research_max_age_days', hint: string) => (
    <div className="f">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" min={1} max={365} step={1} disabled={!admin} value={s![k]} onChange={(e) => setS({ ...s!, [k]: e.target.value })} />
      <span className="hint">{hint}</span>
    </div>
  )

  return (
    <div className="page">
      <div className="phead"><div><h1>Settings</h1><p>Reference prices and the thresholds the CRM flags against.</p></div></div>

      {error && <div className="err">{error}</div>}
      {!admin && s && <div className="note" style={{ marginTop: 0 }}>Only Shine can change settings.</div>}

      {!s && !error && (
        <div className="stack" aria-busy="true">
          <div className="skel" style={{ height: 180 }} /><div className="skel" style={{ height: 120 }} />
        </div>
      )}

      {s && (
        <>
          <section className="card">
            <h4>Packages</h4>
            <p className="muted" style={{ fontSize: 13 }}>Reference prices for estimates and quick-fill. They never change a deal&apos;s own value.</p>
            <div className="stack" style={{ gap: 10 }}>
              {s.packages.map((p, i) => (
                <div className="fgrid" key={i} style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', alignItems: 'end', paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                  <div className="f"><label htmlFor={`pk-l-${i}`}>Label</label>
                    <input id={`pk-l-${i}`} type="text" disabled={!admin} value={p.label} onChange={(e) => pkg(i, { label: e.target.value })} /></div>
                  <div className="f"><label htmlFor={`pk-k-${i}`}>Key</label>
                    <input id={`pk-k-${i}`} type="text" disabled={!admin || !p.isNew} value={p.key}
                      onChange={(e) => pkg(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /></div>
                  <div className="f"><label htmlFor={`pk-a-${i}`}>Amount</label>
                    <input id={`pk-a-${i}`} type="number" min={0} disabled={!admin} value={p.amount} onChange={(e) => pkg(i, { amount: e.target.value })} /></div>
                  <div className="f"><label htmlFor={`pk-c-${i}`}>Currency</label>
                    <select id={`pk-c-${i}`} disabled={!admin} value={p.currency} onChange={(e) => pkg(i, { currency: e.target.value })}>
                      {CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
                  {admin && <div><button className="btn sm" onClick={() => setS({ ...s, packages: s.packages.filter((_, j) => j !== i) })} aria-label={`Remove ${p.label || p.key}`}>Remove</button></div>}
                </div>
              ))}
              {s.packages.length === 0 && <p className="muted">No packages.</p>}
            </div>
            {admin && s.packages.length < 10 && (
              <button className="btn sm" style={{ marginTop: 12 }}
                onClick={() => setS({ ...s, packages: [...s.packages, { key: '', label: '', amount: 0, currency: 'USD', isNew: true }] })}>Add package</button>
            )}
          </section>

          <section className="card">
            <h4>Thresholds</h4>
            <div className="fgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
              {num('th-cap', 'Monthly delivery capacity', 'monthly_capacity', 'How many new projects the studio can take on in a month.')}
              {num('th-stale', 'Stalled after (days)', 'stale_after_days', 'An active deal with no activity for this long counts as stalled.')}
              {num('th-res', 'Research expires after (days)', 'research_max_age_days', 'Research older than this must be re-verified before sending. The sales skill’s rule is 14.')}
            </div>
            {admin && <div style={{ marginTop: 16 }}><button className="btn p" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</button></div>}
          </section>
        </>
      )}

      <section className="card">
        <h4>Team</h4>
        <div className="list">
          {TEAM.map((t) => (
            <div className="item" key={t.name}>
              <div className="grow"><div className="t">{t.name}</div><div className="s">{t.mail}</div></div>
              {t.live && <span className="badge green">live</span>}
            </div>
          ))}
          {FORMER_NAMES.map((n) => (
            <div className="item" key={n}><div className="grow"><div className="t">{n}</div></div><span className="badge">Left</span></div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>The roster is set in code (lib/constants.ts). Ask Claude to change it.</p>
      </section>

      <section className="card">
        <h4>Security</h4>
        <p style={{ marginBottom: 0 }}>Sign-in is a shared team password. Rotate it whenever someone leaves (Vercel → Settings → Environment Variables → TEAM_PASSWORD, then redeploy). Individual Google sign-in is planned.</p>
      </section>
    </div>
  )
}
