'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TEAM } from '@/lib/constants'

export default function LoginPage() {
  const router = useRouter()
  const [name, setName] = useState<string>(TEAM[0].name)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not sign in')
        setBusy(false)
        return
      }
      router.push('/')
      router.refresh()
    } catch {
      setError('Network error — try again')
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <form className="loginbox" onSubmit={submit}>
        <div className="mark">
          Aster<span>.</span>
        </div>
        <p className="sub">Lead Engine. Pick your name so edits are attributed to you.</p>

        {error && <div className="err">{error}</div>}

        <div className="f">
          <label htmlFor="name">You are</label>
          <select id="name" value={name} onChange={(e) => setName(e.target.value)}>
            {TEAM.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="f">
          <label htmlFor="password">Team password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </div>

        <button className="btn p" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
