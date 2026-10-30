'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TEAM, cleanName, signInNameError } from '@/lib/constants'

// Not a possible typed name (it fails the "<>" check), so it can't collide with one.
const OTHER = '<other>'

export default function LoginPage() {
  const router = useRouter()
  const [choice, setChoice] = useState<string>(TEAM[0].name)
  const [otherName, setOtherName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const name = choice === OTHER ? cleanName(otherName) : choice
    // Same check the server makes, run here first so a typo doesn't cost a round trip.
    const nameError = signInNameError(name)
    if (nameError) { setError(nameError); return }
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
        <p className="sub">CRM. Pick your name so your work is attributed to you.</p>

        {error && <div className="err">{error}</div>}

        <div className="f">
          <label htmlFor="name">You are</label>
          <select id="name" value={choice} onChange={(e) => { setChoice(e.target.value); setError('') }}>
            {TEAM.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
            <option value={OTHER}>Other</option>
          </select>
        </div>

        {choice === OTHER && (
          <div className="f">
            <label htmlFor="other-name">Your name</label>
            <input
              id="other-name"
              type="text"
              value={otherName}
              onChange={(e) => { setOtherName(e.target.value); setError('') }}
              autoComplete="name"
              maxLength={60}
              autoFocus
              required
            />
            <span className="hint">Not on the list? Type your name so your edits are attributed to you.</span>
          </div>
        )}

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
