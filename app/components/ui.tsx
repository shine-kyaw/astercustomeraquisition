'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { stageLabel, lostReasonLabel } from '@/lib/crm'
import { FORMER_NAMES } from '@/lib/constants'
import { Icon } from './icons'

// ── Toasts ──────────────────────────────────────────────────────────────────────────────

type Toast = { id: number; text: string; kind: 'ok' | 'err' }
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'err') => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'err' ? ' err' : ''}`}>
            <Icon name={t.kind === 'err' ? 'alert' : 'check'} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/** `toast('Saved')` or `toast(error.message, 'err')`. */
export function useToast() {
  return useContext(ToastCtx)
}

// ── Dialog ──────────────────────────────────────────────────────────────────────────────

/**
 * Modal dialog: Escape and a click on the backdrop close it, focus moves into it on open
 * and returns to whatever had it on close.
 */
export function Dialog({
  title, onClose, children, footer, wide = false,
}: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not(.iconbtn)')
    first?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [onClose])
  return (
    <div className="veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="mhead">
          <h3>{title}</h3>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="mbody">{children}</div>
        {footer && <div className="mfoot">{footer}</div>}
      </div>
    </div>
  )
}

/** A button that needs a second click within 4 seconds. For destructive actions. */
export function ConfirmButton({ onConfirm, children, confirmText = 'Click again to confirm', className = 'btn d sm' }: {
  onConfirm: () => void; children: ReactNode; confirmText?: string; className?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button className={className} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? confirmText : children}
    </button>
  )
}

// ── Small display pieces ────────────────────────────────────────────────────────────────

export function StageBadge({ stage, lostReason }: { stage: string; lostReason?: string }) {
  const label = stage === 'lost' && lostReason ? `Closed · ${lostReasonLabel(lostReason)}` : stageLabel(stage)
  return <span className={`badge stage-${stage}`}><span className="dot" />{label}</span>
}

export function OwnerLabel({ name }: { name?: string | null }) {
  if (!name) return <span className="dim">Unassigned</span>
  const left = FORMER_NAMES.includes(name)
  return (
    <span className="row" style={{ gap: 7, display: 'inline-flex' }}>
      <span className="avatar" aria-hidden="true">{initials(name)}</span>
      <span>{name}{left && <span className="dim"> (left)</span>}</span>
    </span>
  )
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'
}

/** Money in its own currency. Never converted, never summed across currencies. */
export function Money({ amount, currency, estimate = false }: { amount: number | string | null | undefined; currency?: string; estimate?: boolean }) {
  if (amount === null || amount === undefined || amount === '') return <span className="dim">—</span>
  const n = Number(amount)
  if (!Number.isFinite(n)) return <span className="dim">—</span>
  const cur = currency || 'USD'
  let text: string
  try {
    text = new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n)
  } catch {
    text = `${cur} ${n.toLocaleString()}`
  }
  return <span className="num" title={estimate ? 'Estimate from package reference price' : undefined}>{estimate ? '≈ ' : ''}{text}</span>
}

export function moneyList(rows: { currency: string; amount: number }[]) {
  if (!rows.length) return <span className="dim">—</span>
  return (
    <span className="stack" style={{ gap: 2 }}>
      {rows.map((r) => <Money key={r.currency} amount={r.amount} currency={r.currency} />)}
    </span>
  )
}

const DAY = 864e5
/** "today", "tomorrow", "3 days ago", "in 5 days", or a date. Days are the user's local days. */
export function relDay(ymd: string | null | undefined, todayYmd: string): string {
  if (!ymd) return 'No date'
  const d = Math.round((Date.parse(`${String(ymd).slice(0, 10)}T00:00:00Z`) - Date.parse(`${todayYmd}T00:00:00Z`)) / DAY)
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  if (d === -1) return 'Yesterday'
  if (d < 0 && d > -14) return `${-d} days overdue`
  if (d > 0 && d < 14) return `In ${d} days`
  return fmtDate(ymd)
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const s = String(v)
  const d = s.length === 10 ? new Date(`${s}T12:00:00`) : new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** "2h ago", "3d ago". */
export function ago(v: string | null | undefined): string {
  if (!v) return '—'
  const ms = Date.now() - new Date(v).getTime()
  if (!Number.isFinite(ms)) return '—'
  const m = Math.round(ms / 6e4)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 45) return `${d}d ago`
  return fmtDate(v)
}

/** A small circled "i" whose title explains a number. */
export function Info({ text }: { text: string }) {
  return <span className="info" title={text} aria-label={text} tabIndex={0}>i</span>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children}</div>
}

export function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <div className="list" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <div className="item" key={i}><div className="grow stack" style={{ gap: 6 }}><div className="skel" style={{ width: `${45 + ((i * 17) % 40)}%` }} /><div className="skel" style={{ width: '30%', height: 10 }} /></div></div>
      ))}
    </div>
  )
}

export function PriorityBadge({ p }: { p?: string }) {
  if (p === 'high') return <span className="badge red">High</span>
  if (p === 'low') return <span className="badge">Low</span>
  return null
}
