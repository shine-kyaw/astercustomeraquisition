'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Icon, type IconName } from './icons'
import { ToastProvider, StageBadge, initials } from './ui'
import { api, today } from './api'

type Me = { name: string; role: string }
const MeCtx = createContext<Me & { refreshCounts: () => void }>({ name: '', role: 'member', refreshCounts: () => {} })
/** The signed-in person, and a way to refresh the sidebar counts after completing a task. */
export function useMe() {
  return useContext(MeCtx)
}

const NAV: { href: string; label: string; icon: IconName; key: string }[] = [
  { href: '/', label: 'Today', icon: 'today', key: 'd' },
  { href: '/leads', label: 'Leads', icon: 'leads', key: 'l' },
  { href: '/pipeline', label: 'Pipeline', icon: 'pipeline', key: 'p' },
  { href: '/tasks', label: 'Tasks', icon: 'tasks', key: 't' },
  { href: '/activity', label: 'Activity', icon: 'activity', key: 'a' },
  { href: '/reports', label: 'Reports', icon: 'reports', key: 'r' },
]
const NAV2: { href: string; label: string; icon: IconName; key: string }[] = [
  { href: '/ruled-out', label: 'Ruled out', icon: 'ruled', key: 'x' },
  { href: '/settings', label: 'Settings', icon: 'settings', key: 's' },
]

function isOn(path: string, href: string) {
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`)
}

export default function Shell({ me, role, children }: { me: string; role: string; children: ReactNode }) {
  const path = usePathname()
  const router = useRouter()
  const [counts, setCounts] = useState<{ overdue: number; due_today: number } | null>(null)
  const [palette, setPalette] = useState(false)

  const refreshCounts = useCallback(() => {
    api<{ counts: { overdue: number; due_today: number } }>(`/api/me?today=${today()}`)
      .then((d) => setCounts(d.counts))
      .catch(() => {})
  }, [])
  useEffect(() => { refreshCounts() }, [refreshCounts, path])

  // ⌘K / Ctrl+K opens the palette anywhere. "g" then a letter jumps to a page, unless
  // you're typing in a field.
  useEffect(() => {
    let g = false
    let gTimer: ReturnType<typeof setTimeout> | undefined
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((v) => !v); return }
      const el = e.target as HTMLElement
      if (el.closest('input,textarea,select,[contenteditable=true]') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') { e.preventDefault(); setPalette(true); return }
      if (g) {
        const hit = [...NAV, ...NAV2].find((n) => n.key === e.key.toLowerCase())
        g = false
        if (hit) { e.preventDefault(); router.push(hit.href) }
        return
      }
      if (e.key === 'g') { g = true; clearTimeout(gTimer); gTimer = setTimeout(() => { g = false }, 1200) }
      if (e.key === 'n' && !e.shiftKey) { e.preventDefault(); router.push('/leads/new') }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(gTimer) }
  }, [router])

  async function signOut() {
    await fetch('/api/session', { method: 'DELETE' })
    router.push('/login')
    router.refresh()
  }

  const badge = (href: string) => {
    if (href !== '/' && href !== '/tasks') return null
    if (!counts) return null
    if (href === '/' && counts.overdue) return <span className="count hot" title="Overdue">{counts.overdue}</span>
    if (href === '/tasks' && counts.due_today) return <span className="count" title="Due today">{counts.due_today}</span>
    return null
  }

  return (
    <MeCtx.Provider value={{ name: me, role, refreshCounts }}>
      <ToastProvider>
        <div className="shell">
          <aside className="side" aria-label="Main">
            <Link href="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="mark">Aster<span>.</span></span>
              <span className="tag">CRM</span>
            </Link>
            <nav className="nav">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className={isOn(path, n.href) ? 'on' : ''} title={`g then ${n.key}`}>
                  <Icon name={n.icon} />{n.label}{badge(n.href)}
                </Link>
              ))}
            </nav>
            <div className="section">Research</div>
            <nav className="nav">
              {NAV2.map((n) => (
                <Link key={n.href} href={n.href} className={isOn(path, n.href) ? 'on' : ''} title={`g then ${n.key}`}>
                  <Icon name={n.icon} />{n.label}
                </Link>
              ))}
            </nav>
            <div className="foot">
              <div className="me">
                <span className="avatar">{initials(me)}</span>
                <span style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me}</div>
                  <div className="dim" style={{ fontSize: 11.5, textTransform: 'capitalize' }}>{role}</div>
                </span>
              </div>
              <button className="btn ghost sm" onClick={signOut} style={{ justifyContent: 'flex-start' }}><Icon name="logout" />Sign out</button>
            </div>
          </aside>

          <div className="main">
            <header className="topbar no-print">
              <button className="search" onClick={() => setPalette(true)} aria-label="Search leads and pages">
                <Icon name="search" />
                <span>Search companies, people, pages…</span>
                <span className="spacer" />
                <kbd>Ctrl K</kbd>
              </button>
              <span className="spacer" />
              <Link href="/leads/new" className="btn sm"><Icon name="plus" />Add lead</Link>
            </header>
            {children}
          </div>
        </div>

        <nav className="mobile-nav" aria-label="Main">
          {NAV.slice(0, 5).map((n) => (
            <Link key={n.href} href={n.href} className={isOn(path, n.href) ? 'on' : ''}><Icon name={n.icon} />{n.label}</Link>
          ))}
        </nav>

        {palette && <Palette onClose={() => setPalette(false)} />}
      </ToastProvider>
    </MeCtx.Provider>
  )
}

type Hit = { kind: 'lead'; id: string; company: string; who?: string; stage: string; lost_reason?: string } | { kind: 'page'; href: string; label: string; icon: IconName }

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [leads, setLeads] = useState<Hit[]>([])
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const t = text.trim()
    if (!t) { setLeads([]); return }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      api<{ leads: { id: string; company: string; who: string; stage: string; lost_reason: string }[] }>(`/api/leads?q=${encodeURIComponent(t)}&limit=8&sort=recent`, { signal: ctrl.signal })
        .then((d) => setLeads(d.leads.map((l) => ({ kind: 'lead' as const, ...l }))))
        .catch(() => {})
    }, 140)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [text])

  const pages: Hit[] = [
    ...NAV.map((n) => ({ kind: 'page' as const, href: n.href, label: `Go to ${n.label}`, icon: n.icon })),
    ...NAV2.map((n) => ({ kind: 'page' as const, href: n.href, label: `Go to ${n.label}`, icon: n.icon })),
    { kind: 'page', href: '/leads/new', label: 'Add a lead', icon: 'plus' },
    { kind: 'page', href: '/leads?import=1', label: 'Import a researched batch', icon: 'upload' },
    { kind: 'page', href: '/leads?view=no_next_step', label: 'Leads with no next step', icon: 'alert' },
  ]
  const t = text.trim().toLowerCase()
  const hits: Hit[] = [...leads, ...pages.filter((p) => p.kind === 'page' && (!t || p.label.toLowerCase().includes(t)))]
  useEffect(() => { setSel(0) }, [text, leads.length])

  function go(h: Hit) {
    onClose()
    router.push(h.kind === 'lead' ? `/leads/${h.id}` : h.href)
  }

  return (
    <div className="veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label="Search">
        <input
          ref={input}
          type="search"
          value={text}
          placeholder="Search companies, people, or jump to a page…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
            if (e.key === 'Enter' && hits[sel]) { e.preventDefault(); go(hits[sel]) }
          }}
          aria-label="Search"
        />
        <div className="res" role="listbox">
          {hits.length === 0 && <div className="empty">No matches for “{text}”.</div>}
          {hits.map((h, i) => (
            <div
              key={h.kind === 'lead' ? h.id : h.href}
              className={`opt${i === sel ? ' on' : ''}`}
              role="option"
              aria-selected={i === sel}
              onMouseEnter={() => setSel(i)}
              onClick={() => go(h)}
            >
              {h.kind === 'lead' ? (
                <>
                  <span className="avatar" style={{ background: 'var(--surface-3)', color: 'var(--muted)' }}>{initials(h.company)}</span>
                  <span>{h.company}{h.who ? <span className="dim"> · {h.who}</span> : null}</span>
                  <span className="s"><StageBadge stage={h.stage} lostReason={h.lost_reason} /></span>
                </>
              ) : (
                <>
                  <Icon name={h.icon} />
                  <span>{h.label}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
