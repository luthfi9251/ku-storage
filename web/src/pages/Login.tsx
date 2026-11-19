import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BadgeCheck, KeyRound, User } from 'lucide-react'
import { useAuth } from '../auth'
import { errMsg } from '../lib/api'
import { Button, ErrorBox, Field, InfoBox, Input, Spinner } from '../ui'
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
    <AuthShell
      title={needsSetup ? 'Set up ku-storage' : 'Welcome back'}
      subtitle={needsSetup ? 'Create the first administrator account.' : 'Log in to see the files shared with you.'}
      onSubmit={onSubmit}
    >
      {needsSetup && (
        <InfoBox>
          <span className="block font-semibold">First run setup</span>
          Create the initial administrator account (username 3–64 chars of a–z 0–9 . _ -, password ≥ 10 chars).
        </InfoBox>
      )}

      <div className="space-y-4">
        <Field label="Username">
          <div className="relative">
            <User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500" />
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoFocus
              autoComplete="username"
              className="h-10 pl-9"
              required
            />
          </div>
        </Field>

        {needsSetup && (
          <Field label="Display name" hint="optional">
            <div className="relative">
              <BadgeCheck size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500" />
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Administrator" className="h-10 pl-9" />
            </div>
          </Field>
        )}

        <Field label="Password">
          <div className="relative">
            <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500" />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••"
              autoComplete={needsSetup ? 'new-password' : 'current-password'}
              className="h-10 pl-9"
              required
            />
          </div>
        </Field>

        {needsSetup && (
          <Field label="Confirm password">
            <div className="relative">
              <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500" />
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••••"
                autoComplete="new-password"
                className="h-10 pl-9"
                required
              />
            </div>
          </Field>
        )}
      </div>

      <ErrorBox>{error}</ErrorBox>

      <Button type="submit" disabled={busy} size="lg" className="w-full">
        {busy ? <Spinner className="border-white/30 border-t-white" /> : needsSetup ? 'Create admin account & log in' : 'Log in'}
      </Button>
    </AuthShell>
  )
}
