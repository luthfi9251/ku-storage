import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BadgeCheck, KeyRound, ShieldAlert, User } from 'lucide-react'
import { useAuth } from '../auth'
import { errMsg } from '../lib/api'
import { Button, ErrorBox, Field, Input, Spinner } from '../ui'
import AuthShell from './AuthShell'

export default function Login() {
  const { me, needsSetup, login, setup } = useAuth()
  const navigate = useNavigate()
  const loc = useLocation()
  const from = (loc.state as { from?: string } | null)?.from || '/'
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (me) navigate(from, { replace: true })
  }, [me, navigate, from])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (needsSetup) {
      if (password.length < 10) return setError('Password must be at least 10 characters.')
      if (password !== confirm) return setError('Passwords do not match.')
    }
    setBusy(true)
    try {
      if (needsSetup) await setup(username.trim(), password, displayName.trim())
      else await login(username.trim(), password)
    } catch (err) {
      setError(errMsg(err, 'Authentication failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell subtitle="Cloudflare R2 access broker" onSubmit={onSubmit}>
      {needsSetup && (
        <div className="flex items-start gap-2 rounded-xl border border-sky-800/60 bg-sky-950/40 p-3 text-xs text-sky-300">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <div>
            <span className="block font-semibold">First Run Setup</span>
            Create the initial administrator account (username 3–64 chars of a–z 0–9 . _ -, password ≥ 10 chars).
          </div>
        </div>
      )}

      <div className="space-y-4">
        <Field label="Username">
          <div className="relative">
            <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoFocus
              autoComplete="username"
              className="pl-9"
              required
            />
          </div>
        </Field>

        {needsSetup && (
          <Field label="Display name" hint="optional">
            <div className="relative">
              <BadgeCheck size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Administrator" className="pl-9" />
            </div>
          </Field>
        )}

        <Field label="Password">
          <div className="relative">
            <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••"
              autoComplete={needsSetup ? 'new-password' : 'current-password'}
              className="pl-9"
              required
            />
          </div>
        </Field>

        {needsSetup && (
          <Field label="Confirm password">
            <div className="relative">
              <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••••"
                autoComplete="new-password"
                className="pl-9"
                required
              />
            </div>
          </Field>
        )}
      </div>

      <ErrorBox>{error}</ErrorBox>

      <Button type="submit" disabled={busy} className="w-full justify-center py-2.5 shadow-lg shadow-indigo-600/25">
        {busy ? <Spinner className="border-white/30 border-t-white" /> : needsSetup ? 'Create Admin Account & Log In' : 'Log In'}
      </Button>
    </AuthShell>
  )
}
