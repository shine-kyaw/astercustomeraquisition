'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/app/components/api'
import { Dialog, Empty, SkeletonRows, fmtDate, useToast } from '@/app/components/ui'
import { useMe } from '@/app/components/shell'

type Exclusion = {
  id: number; company: string; domain: string; reason: string; category: string; source: string
  reviewed_on: string; reviewed_by: string; reconsider_if: string
  revoked_at: string | null; revoked_by: string; revoked_reason: string
}
type Category = { key: string; label: string }
type Result = { added: unknown[]; skipped: { company: string; reason: string }[]; rejected?: (string | { company?: string; reason?: string; error?: string })[] }

const looksLikeDomain = (s: string) => /^(https?:\/\/)?[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(s.trim())

/**
 * One company per line: "Company — domain — reason". Tabs or commas also work. Commas only
 * split when the line has no dash or tab, because reasons are prose and often contain them.
 */
function parseList(text: string) {
  const rows: { company: string; domain: string; reason: string }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const sep = /\s[—–-]\s|—|–/.test(line) ? /\s*(?:\s[—–-]\s|—|–)\s*/ : line.includes('\t') ? /\t/ : /\s*,\s*/
    const parts = line.split(sep).map((p) => p.trim()).filter((p, i) => i === 0 || p !== '')
    const company = parts[0] ?? ''
    let domain = ''
    let rest = parts.slice(1)
    if (rest.length && looksLikeDomain(rest[0])) { domain = rest[0]; rest = rest.slice(1) }
    rows.push({ company, domain, reason: rest.join(' — ') })
  }
  return rows
}

export default function RuledOut() {
  const { role } = useMe()
  const admin = role === 'owner' || role === 'admin'
  const toast = useToast()
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [all, setAll] = useState(false)
  const [rows, setRows] = useState<Exclusion[] | null>(null)
  const [cats, setCats] = useState<Category[]>([])
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'add' | 'paste' | null>(null)
  const [reconsider, setReconsider] = useState<Exclusion | null>(null)

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t) }, [q])

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const d = await api<{ exclusions: Exclusion[]; categories: Category[] }>(
        `/api/exclusions?q=${encodeURIComponent(dq)}${all ? '&all=1' : ''}`, { signal })
      setRows(d.exclusions); setCats(d.categories); setError(null)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    }
  }, [dq, all])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const catLabel = (k: string) => cats.find((c) => c.key === k)?.label ?? k

  return (
    <div className="page">
      <div className="phead">
        <div>
          <h1>Ruled out</h1>
          <p>Companies researched and rejected. They stay on the exclusion list and are skipped at import.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setDialog('paste')}>Paste a list</button>
          <button className="btn p" onClick={() => setDialog('add')}>Add company</button>
        </div>
      </div>

      <div className="row wrap" style={{ marginBottom: 14 }}>
        <input type="search" aria-label="Search ruled-out companies" placeholder="Search company, domain or reason" value={q}
          onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360, flex: '1 1 220px' }} />
        <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show reconsidered</label>
      </div>

      {error && <div className="err">{error}</div>}
      {!rows && !error && <div className="card flush"><SkeletonRows n={6} /></div>}
      {rows && rows.length === 0 && (
        <div className="card">
          <Empty title={dq ? 'Nothing matches that search' : 'Nothing ruled out yet'}>
            {!dq && <span>Put companies here once you have researched them and decided not to pursue them: site already good, too big, inactive, no decision-maker. Nobody researches them twice, and imports skip them.</span>}
          </Empty>
        </div>
      )}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Company</th><th>Reason</th><th>Category</th><th>Reviewed</th><th>Reconsider if</th>{admin && <th aria-label="Actions" />}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} style={r.revoked_at ? { opacity: 0.6 } : undefined}>
                <td><b>{r.company}</b>{r.domain && <div className="sub">{r.domain}</div>}</td>
                <td style={{ minWidth: 220 }}>
                  {r.reason || <span className="dim">No reason recorded</span>}
                  {r.revoked_at && <div className="sub">Reconsidered by {r.revoked_by}{r.revoked_reason ? `: ${r.revoked_reason}` : ''} · {fmtDate(r.revoked_at)}</div>}
                </td>
                <td>{catLabel(r.category)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.reviewed_on)}{r.reviewed_by && <span className="dim"> · {r.reviewed_by}</span>}{r.source && <div className="sub">{r.source}</div>}</td>
                <td style={{ minWidth: 160 }}>{r.reconsider_if || <span className="dim">—</span>}</td>
                {admin && <td className="r">{!r.revoked_at && <button className="btn xs" onClick={() => setReconsider(r)}>Reconsider</button>}</td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {dialog === 'add' && <AddDialog cats={cats} onClose={() => setDialog(null)} onDone={() => { load() }} />}
      {dialog === 'paste' && <PasteDialog cats={cats} onClose={() => setDialog(null)} onDone={() => { load() }} />}
      {reconsider && (
        <ReconsiderDialog row={reconsider} onClose={() => setReconsider(null)}
          onDone={() => { setReconsider(null); toast('Back in play'); load() }} />
      )}
    </div>
  )
}

function CategorySelect({ id, cats, value, onChange }: { id: string; cats: Category[]; value: string; onChange: (v: string) => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
    </select>
  )
}

function AddDialog({ cats, onClose, onDone }: { cats: Category[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ company: '', domain: '', reason: '', category: 'other', source: '', reconsider_if: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const ok = f.company.trim() && f.reason.trim()

  async function save() {
    setBusy(true); setError(null)
    try {
      const r = await api<Result>('/api/exclusions', { body: f })
      if (r.skipped?.length) setError(`${r.skipped[0].company}: ${r.skipped[0].reason}. Nothing was added.`)
      else { toast('Added to ruled out'); onDone(); onClose() }
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Dialog title="Add company" onClose={onClose} footer={
      <><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn p" disabled={!ok || busy} onClick={save}>{busy ? 'Adding…' : 'Add company'}</button></>
    }>
      {error && <div className="err">{error}</div>}
      <div className="fgrid">
        <div className="f"><label htmlFor="x-co">Company</label><input id="x-co" type="text" value={f.company} onChange={set('company')} /></div>
        <div className="f"><label htmlFor="x-dom">Website or domain</label><input id="x-dom" type="text" value={f.domain} onChange={set('domain')} placeholder="example.com" /></div>
        <div className="f wide"><label htmlFor="x-why">Reason</label><textarea id="x-why" rows={3} value={f.reason} onChange={set('reason')} placeholder="Why it was rejected, specific enough that nobody re-researches it" /></div>
        <div className="f"><label htmlFor="x-cat">Category</label><CategorySelect id="x-cat" cats={cats} value={f.category} onChange={(v) => setF({ ...f, category: v })} /></div>
        <div className="f"><label htmlFor="x-src">Source</label><input id="x-src" type="text" value={f.source} onChange={set('source')} placeholder="Batch 006 research" /></div>
        <div className="f wide"><label htmlFor="x-rec">Reconsider if</label><input id="x-rec" type="text" value={f.reconsider_if} onChange={set('reconsider_if')} placeholder="Optional, e.g. redesign goes stale" /></div>
      </div>
    </Dialog>
  )
}

function PasteDialog({ cats, onClose, onDone }: { cats: Category[]; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [category, setCategory] = useState('other')
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const parsed = useMemo(() => parseList(text), [text])
  const valid = parsed.filter((p) => p.company)

  async function save() {
    setBusy(true); setError(null)
    try {
      const r = await api<Result>('/api/exclusions', { body: { rows: valid.map((p) => ({ ...p, category, source })) } })
      setResult(r); onDone()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  if (result) {
    const rej = (result.rejected ?? []).map((x) => (typeof x === 'string' ? x : x.company ?? x.reason ?? x.error ?? 'Unnamed row'))
    return (
      <Dialog title="List added" onClose={onClose} footer={<button className="btn p" onClick={onClose}>Done</button>}>
        <dl className="kv">
          <dt>Added</dt><dd>{result.added.length}</dd>
          <dt>Skipped</dt><dd>{result.skipped.length}{result.skipped.length > 0 && <div className="sub muted">Already on the list: {result.skipped.map((s) => s.company).join(', ')}</div>}</dd>
          <dt>Rejected</dt><dd>{rej.length}{rej.length > 0 && <div className="sub muted">{rej.join(', ')}</div>}</dd>
        </dl>
      </Dialog>
    )
  }

  return (
    <Dialog wide title="Paste a list" onClose={onClose} footer={
      <><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn p" disabled={!valid.length || busy} onClick={save}>{busy ? 'Adding…' : `Add ${valid.length} ${valid.length === 1 ? 'company' : 'companies'}`}</button></>
    }>
      {error && <div className="err">{error}</div>}
      <div className="fgrid">
        <div className="f wide">
          <label htmlFor="p-text">One company per line</label>
          <textarea id="p-text" rows={7} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'Acme Dental — acmedental.com — Site rebuilt in 2025\nNorth Pier Cafe — northpier.co.uk — Inactive since 2024'} />
          <span className="hint">Format: Company — domain — reason. Domain and reason are optional. Tabs or commas also work.</span>
        </div>
        <div className="f"><label htmlFor="p-cat">Default category</label><CategorySelect id="p-cat" cats={cats} value={category} onChange={setCategory} /></div>
        <div className="f"><label htmlFor="p-src">Source</label><input id="p-src" type="text" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Lead Engine ruled-out doc" /></div>
      </div>
      {parsed.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 14, maxHeight: 260, overflowY: 'auto' }}>
          <table className="t">
            <thead><tr><th>Company</th><th>Domain</th><th>Reason</th></tr></thead>
            <tbody>{parsed.map((p, i) => (
              <tr key={i}><td>{p.company || <span className="red">Missing company</span>}</td>
                <td>{p.domain || <span className="dim">—</span>}</td><td>{p.reason || <span className="dim">—</span>}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Dialog>
  )
}

function ReconsiderDialog({ row, onClose, onDone }: { row: Exclusion; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function go() {
    setBusy(true); setError(null)
    try { await api(`/api/exclusions/${row.id}`, { method: 'PATCH', body: { revoke: true, reason: reason.trim() } }); onDone() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Dialog title={`Reconsider ${row.company}`} onClose={onClose} footer={
      <><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn p" disabled={!reason.trim() || busy} onClick={go}>{busy ? 'Saving…' : 'Reconsider'}</button></>
    }>
      {error && <div className="err">{error}</div>}
      <p className="muted" style={{ fontSize: 13 }}>It comes off the exclusion list and can be imported again. The original reason stays on record.</p>
      <div className="f"><label htmlFor="rc-why">Why reconsider?</label>
        <textarea id="rc-why" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
    </Dialog>
  )
}
