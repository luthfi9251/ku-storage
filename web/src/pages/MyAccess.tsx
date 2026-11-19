import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Database, FolderOpen } from 'lucide-react'
import { useAuth } from '../auth'
import { api, errMsg } from '../lib/api'
import type { MeResponse } from '../lib/types'
import { EmptyState, ErrorBox, Loading, PageHeader, PermBadges } from '../ui'

export function browserLink(bucketId: string, prefix: string): string {
  return `/b/${encodeURIComponent(bucketId)}${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''}`
}

export default function MyAccess() {
  const { isAdmin } = useAuth()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<MeResponse>('/api/me') })
  const access = me.data?.access ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Access"
        subtitle={isAdmin ? 'As an administrator you can browse every registered bucket.' : 'Buckets and folders you have been granted access to.'}
      />
      {me.isLoading && <Loading />}
      {me.isError && <ErrorBox>{errMsg(me.error)}</ErrorBox>}
      {me.data && access.length === 0 && (
        <EmptyState>
          {isAdmin ? 'No buckets registered yet. Add a connection and bucket under Admin → Connections.' : "You don't have access to any bucket yet. Ask an administrator for access."}
        </EmptyState>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {access.map((ep) => (
          <Link
            key={`${ep.bucketId}:${ep.prefix}`}
            to={browserLink(ep.bucketId, ep.prefix)}
            className="glass-card glass-card-hover block rounded-2xl p-5"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
                {ep.prefix ? <FolderOpen size={20} /> : <Database size={20} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-slate-100">{ep.displayName || ep.bucketName}</div>
                <div className="truncate text-[11px] text-slate-500">
                  {ep.connectionName} · {ep.bucketName}
                </div>
              </div>
            </div>
            <div className="mt-3 truncate rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 font-mono text-xs text-slate-300" title={ep.prefix || '/'}>
              /{ep.prefix}
            </div>
            <PermBadges perms={ep.perms} className="mt-3" />
          </Link>
        ))}
      </div>
    </div>
  )
}
