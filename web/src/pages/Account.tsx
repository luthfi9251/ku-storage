import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, LogOut, Monitor } from 'lucide-react'
import { useAuth } from '../auth'
import { api, errMsg } from '../lib/api'
import { fmtDate, fmtRelative } from '../lib/format'
import type { Session } from '../lib/types'
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Spinner, Table, Td, Th, useToast } from '../ui'

export default function Account() {
  const { me, logout } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()

  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwErr, setPwErr] = useState('')

  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<Session[]>('/api/me/sessions') })
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['sessions'] })

  const changePw = useMutation({
    mutationFn: () => api.put<void>('/api/me/password', { currentPassword: cur, newPassword: next }),
    onSuccess: () => {
      setCur('')
      setNext('')
      setConfirm('')
      setPwErr('')
      toast.ok('Password changed. Other sessions were signed out.')
      invalidate()
    },
    onError: (e) => setPwErr(errMsg(e)),
  })

  const revoke = useMutation({
    mutationFn: (s: Session) => api.del(`/api/me/sessions/${encodeURIComponent(s.id)}`),
    onSuccess: async (_, s) => {
      if (s.current) {
        await logout()
        navigate('/login')
      } else {
        toast.ok('Session revoked')
        invalidate()
      }
    },
    onError: (e) => toast.error(errMsg(e)),
  })

  const revokeOthers = useMutation({
    mutationFn: () => api.post<void>('/api/me/sessions/revoke-others'),
    onSuccess: () => {
      toast.ok('Other sessions signed out')
      invalidate()
    },
    onError: (e) => toast.error(errMsg(e)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setPwErr('')
    if (next.length < 10) return setPwErr('New password must be at least 10 characters.')
    if (next !== confirm) return setPwErr('Passwords do not match.')
    changePw.mutate()
  }

  const rows = sessions.data ?? []
  const others = rows.filter((s) => !s.current).length

  return (
    <div className="space-y-8">
      <PageHeader
        title="Account"
        subtitle={
          <>
            Signed in as <span className="font-mono text-gray-700 dark:text-zinc-300">{me?.username}</span>
            {me?.displayName ? ` (${me.displayName})` : ''}
          </>
        }
      />

      <Card className="max-w-xl p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-zinc-100">
          <KeyRound size={16} className="text-teal-600 dark:text-teal-400" /> Change password
        </h2>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Current password">
            <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required />
          </Field>
          <Field label="New password" hint="min. 10 characters">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </Field>
          <ErrorBox>{pwErr}</ErrorBox>
          <div className="flex justify-end">
            <Button type="submit" disabled={changePw.isPending}>
              {changePw.isPending ? <Spinner className="border-white/30 border-t-white" /> : 'Change password'}
            </Button>
          </div>
        </form>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-zinc-100">
            <Monitor size={16} className="text-teal-600 dark:text-teal-400" /> Active sessions
          </h2>
          {others > 0 && (
            <Button size="sm" variant="outline" onClick={() => revokeOthers.mutate()} disabled={revokeOthers.isPending}>
              <LogOut size={14} /> Log out other sessions
            </Button>
          )}
        </div>
        {sessions.isLoading && <Loading />}
        {sessions.isError && <ErrorBox>{errMsg(sessions.error)}</ErrorBox>}
        {rows.length > 0 && (
          <Table className="[&_td]:whitespace-nowrap">
            <thead>
              <tr>
                <Th>Device</Th>
                <Th>IP</Th>
                <Th>Signed in</Th>
                <Th>Last seen</Th>
                <Th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-gray-100 dark:hover:bg-zinc-800/30">
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="max-w-md truncate text-xs text-gray-700 dark:text-zinc-300" title={s.userAgent}>
                        {s.userAgent || 'unknown'}
                      </span>
                      {s.current && <Badge tone="green">this device</Badge>}
                    </div>
                  </Td>
                  <Td className="font-mono text-xs text-gray-500 dark:text-zinc-400">{s.ip}</Td>
                  <Td className="whitespace-nowrap text-xs text-gray-500 dark:text-zinc-400">{fmtDate(s.createdAt)}</Td>
                  <Td className="whitespace-nowrap text-xs text-gray-500 dark:text-zinc-400">
                    <span title={fmtDate(s.lastSeenAt)}>{fmtRelative(s.lastSeenAt)}</span>
                  </Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" className="hover:text-rose-600 dark:hover:text-rose-400" onClick={() => revoke.mutate(s)} disabled={revoke.isPending}>
                      {s.current ? 'Log out' : 'Revoke'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  )
}
