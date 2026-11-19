import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { useAuth } from '../auth'
import { api, errMsg } from '../lib/api'
import type { InviteInfo, UserResponse } from '../lib/types'
import { Button, ErrorBox, Field, Input, Loading, Spinner } from '../ui'
import AuthShell from './AuthShell'

export default function Invite() {
  const { token = '' } = useParams()
  const { adopt } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Once the token is consumed it must not be fetched again (adopt clears the
  // query cache, which would otherwise refetch it and show a 404).
  const [done, setDone] = useState(false)

  const info = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<InviteInfo>(`/api/invites/${encodeURIComponent(token)}`),
    retry: false,
    enabled: !done,
    staleTime: Infinity,
  })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 10) return setError('Password must be at least 10 characters.')
    if (password !== confirm) return setError('Passwords do not match.')
    setBusy(true)
    try {
      const res = await api.post<UserResponse>(`/api/invites/${encodeURIComponent(token)}`, { password })
      setDone(true)
      adopt(res.user)
      navigate('/', { replace: true })
    } catch (err) {
      setError(errMsg(err, 'Could not set password'))
    } finally {
      setBusy(false)
    }
  }

  const reset = info.data?.purpose === 'reset'

  return (
    <AuthShell subtitle={reset ? 'Reset your password' : 'Welcome! Set a password to activate your account'} onSubmit={onSubmit}>
      {info.isLoading && <Loading />}
      {info.isError && (
        <div className="space-y-4">
          <ErrorBox>{errMsg(info.error, 'This link is invalid or has expired.')}</ErrorBox>
          <p className="text-center text-xs text-slate-400">
            Ask your administrator for a new link, or <Link to="/login" className="text-indigo-400 hover:underline">go to login</Link>.
          </p>
        </div>
      )}
      {info.data && (
        <>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Account</div>
            <div className="font-semibold text-slate-100">{info.data.displayName || info.data.username}</div>
            <div className="font-mono text-xs text-slate-400">{info.data.username}</div>
          </div>
          <div className="space-y-4">
            <Field label="New password" hint="min. 10 characters">
              <div className="relative">
                <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus className="pl-9" required />
              </div>
            </Field>
            <Field label="Confirm password">
              <div className="relative">
                <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className="pl-9" required />
              </div>
            </Field>
          </div>
          <ErrorBox>{error}</ErrorBox>
          <Button type="submit" disabled={busy} className="w-full justify-center py-2.5">
            {busy ? <Spinner className="border-white/30 border-t-white" /> : reset ? 'Set New Password & Log In' : 'Activate Account & Log In'}
          </Button>
        </>
      )}
    </AuthShell>
  )
}
