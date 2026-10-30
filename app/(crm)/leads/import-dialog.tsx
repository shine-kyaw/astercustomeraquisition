'use client'

import { useState } from 'react'
import { api } from '../../components/api'
import { Dialog } from '../../components/ui'

type Duplicate = { index: number; company: string; existing?: string; batch?: string; status?: string; kind?: string }
type Rejected = { index: number; company?: string; reason: string }
type WouldCreate = { index: number; company: string; status?: string; owner?: string }
type ImportResult = {
  created: number
  duplicates?: Duplicate[]
  rejected?: Rejected[]
  wouldCreate?: WouldCreate[]
  dryRun?: boolean
}

function dupReason(d: Duplicate) {
  const parts: string[] = []
  if (d.existing) parts.push(d.existing)
  if (d.batch) parts.push(`in ${d.batch}`)
  if (d.status) parts.push(`status "${d.status}"`)
  return parts.join(' · ')
}

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'check' | 'import' | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  function reset() {
    setResult(null)
    setError('')
  }

  // A dropped or chosen file only fills the box, so both routes share one parse and you
  // can still read and edit exactly what is about to be sent.
  function readFile(file: File | undefined | null) {
    if (!file) return
    if (file.size > 2_000_000) {
      setError('That file is larger than 2 MB. It is probably not a lead batch.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => { setText(String(reader.result ?? '')); reset() }
    reader.onerror = () => setError('Could not read that file.')
    reader.readAsText(file)
  }

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'check' : 'import')
    setError('')
    setResult(null)
    try {
      const data = await api<ImportResult>('/api/leads/import', { body: dryRun ? { text, dryRun: true } : { text } })
      setResult({ ...data, dryRun })
      if (!dryRun) {
        setText('')
        onImported()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const done = !!result && !result.dryRun
  const dups = result?.duplicates ?? []
  const rejected = result?.rejected ?? []
  const would = result?.wouldCreate ?? []

  return (
    <Dialog
      title="Import a batch"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>{done ? 'Done' : 'Cancel'}</button>
          {!done && (
            <>
              <button className="btn" onClick={() => run(true)} disabled={!!busy || !text.trim()}>
                {busy === 'check' ? 'Checking…' : 'Check first'}
              </button>
              <button className="btn p" onClick={() => run(false)} disabled={!!busy || !text.trim()}>
                {busy === 'import' ? 'Importing…' : 'Import'}
              </button>
            </>
          )}
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
        Paste the JSON block from the end of a lead batch, or drop a .json file on the box. Duplicates and
        ruled-out companies are skipped automatically and nothing already in the system is overwritten. A
        lead&rsquo;s status must be true at import time: a draft is not an email, so only mark a lead Emailed once it has gone out.
      </p>

      <div className="row wrap" style={{ gap: 9, marginBottom: 10 }}>
        <label className="btn sm" style={{ cursor: 'pointer' }}>
          Choose a file
          <input
            type="file"
            accept=".json,.txt,application/json,text/plain"
            style={{ display: 'none' }}
            onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = '' }}
          />
        </label>
        {text && <button className="btn sm" onClick={() => { setText(''); reset() }}>Clear</button>}
        <span className="dim" style={{ fontSize: 12 }}>
          {text ? `${text.length.toLocaleString()} characters ready` : 'Nothing pasted yet'}
        </span>
      </div>

      <textarea
        id="import-text"
        aria-label="Batch JSON"
        className="imp-drop"
        rows={10}
        value={text}
        style={dragging ? { borderColor: 'var(--gold)' } : undefined}
        placeholder={'Paste here, or drop a .json file.\n\n{\n  "batch": "Batch 002",\n  "leads": [ ... ]\n}'}
        onChange={(e) => { setText(e.target.value); reset() }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files?.[0]) }}
      />

      {error && <div className="err" style={{ marginTop: 12 }}>{error}</div>}

      {result && (
        <div className="imp-sec" aria-live="polite">
          <div className={`imp-big ${done ? 'grn' : ''}`}>
            {done ? `${result.created} added` : `Would add ${result.wouldCreate?.length ?? result.created}`}
          </div>
          {!done && <p className="dim" style={{ fontSize: 12, marginTop: 2 }}>Nothing has been saved yet.</p>}

          {!done && would.length > 0 && (
            <ul className="imp-list">
              {would.map((w) => (
                <li key={w.index}>
                  <b>{w.company}</b>
                  <span className="dim">{[w.status, w.owner || 'Unassigned'].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          )}

          {dups.length > 0 && (
            <div className="imp-sec">
              <h4>Already in the system or ruled out ({dups.length})</h4>
              <ul className="imp-list">
                {dups.map((d, i) => (
                  <li key={i}>
                    <span>{d.company}</span>
                    {d.kind === 'ruled_out' && <span className="badge red">Ruled out</span>}
                    <span className="dim">{dupReason(d)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rejected.length > 0 && (
            <div className="imp-sec">
              <h4>Rejected ({rejected.length})</h4>
              <ul className="imp-list">
                {rejected.map((r, i) => (
                  <li key={i}>
                    <span>{r.company ? r.company : `Position ${r.index + 1}`}</span>
                    <span className="red">{r.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
