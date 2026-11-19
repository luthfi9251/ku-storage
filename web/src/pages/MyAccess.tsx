import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Database, FolderOpen, Users } from 'lucide-react'
import { useAuth } from '../auth'
import { api, errMsg } from '../lib/api'
import type { MeResponse } from '../lib/types'
import { EmptyState, ErrorBox, Loading, PermBadges, cn, focusRing } from '../ui'

export function browserLink(bucketId: string, prefix: string): string {
  return `/b/${encodeURIComponent(bucketId)}${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''}`
}

export default function MyAccess() {
  const { me: user, isAdmin } = useAuth()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<MeResponse>('/api/me') })
  const access = me.data?.access ?? []
  const first = (user?.displayName || user?.username || '').split(' ')[0]

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-medium text-teal-700 dark:text-teal-400">Files</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl dark:text-zinc-50">Hi, {first}</h1>
        <p className="mt-1.5 text-sm text-gray-500 dark:text-zinc-400">
          {isAdmin ? 'As an administrator you can browse every registered bucket.' : 'Pick a location below to browse, preview and upload files.'}
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{isAdmin ? 'All buckets' : 'Shared with you'}</h2>
          {access.length > 0 && (
            <span className="rounded-full bg-gray-200/70 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-zinc-800 dark:text-zinc-400">{access.length}</span>
          )}
        </div>

        {me.isLoading && <Loading />}
        {me.isError && <ErrorBox>{errMsg(me.error)}</ErrorBox>}
        {me.data && access.length === 0 && (
          <EmptyState icon={Users} title={isAdmin ? 'No buckets yet' : 'Nothing shared with you yet'}>
            {isAdmin
              ? 'Add a connection and register a bucket under Admin → Connections.'
              : "You don't have access to any bucket yet. Ask an administrator to share a folder with you."}
          </EmptyState>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {access.map((ep) => (
            <Link
              key={`${ep.bucketId}:${ep.prefix}`}
              to={browserLink(ep.bucketId, ep.prefix)}
              className={cn(
                'group flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-card transition hover:border-teal-300 hover:shadow-pop dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-teal-500/50',
                focusRing,
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                    ep.prefix
                      ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
                      : 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300',
                  )}
                >
                  {ep.prefix ? <FolderOpen size={20} /> : <Database size={20} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-gray-900 dark:text-zinc-50">{ep.displayName || ep.bucketName}</div>
                  <div className="truncate text-xs text-gray-500 dark:text-zinc-400">
                    {ep.connectionName} · {ep.bucketName}
                  </div>
                </div>
                <ChevronRight size={18} className="mt-2.5 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-teal-600 dark:text-zinc-600 dark:group-hover:text-teal-400" />
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-zinc-800">
                <span className="truncate font-mono text-xs text-gray-600 dark:text-zinc-400" title={ep.prefix || '/'}>
                  /{ep.prefix}
                </span>
                <PermBadges perms={ep.perms} className="shrink-0 justify-end" />
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
