import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Download, RefreshCw } from 'lucide-react'
import { api, errMsg, qs } from '../../lib/api'
import { fmtDate, fmtSize } from '../../lib/format'
import type { AuditPage, AuditResult } from '../../lib/types'
import { Badge, Button, EmptyState, ErrorBox, Input, Loading, PageHeader, Select, Spinner, Table, Td, Th, cn } from '../../ui'
import { useBuckets, useUsers } from './hooks'

const PAGE = 100

type Filters = { user: string; bucket: string; action: string; result: '' | AuditResult; from: string; to: string }

function resultBadge(r: AuditResult) {
  if (r === 'ok') return <Badge tone="green">ok</Badge>
  if (r === 'denied') return <Badge tone="amber">denied</Badge>
  return <Badge tone="red">error</Badge>
}

export default function Audit() {
  const users = useUsers()
  const buckets = useBuckets()
  const [f, setF] = useState<Filters>({ user: '', bucket: '', action: '', result: '', from: '', to: '' })
  const [action, setAction] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  // Debounce the free-text action filter.
  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.action === action.trim() ? x : { ...x, action: action.trim() })), 400)
    return () => clearTimeout(t)
  }, [action])

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }))

  const q = useInfiniteQuery({
    queryKey: ['admin', 'audit', f],
    queryFn: ({ pageParam }) => api.get<AuditPage>(`/api/admin/audit${qs({ ...f, before: pageParam, limit: PAGE })}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  })

  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data])
  const csv = `/api/admin/audit.csv${qs(f)}`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        subtitle="Every change and every object access, including denied attempts. Successful listings are not logged."
        actions={
          <>
            <Button variant="ghost" onClick={() => void q.refetch()} disabled={q.isFetching} title="Refresh">
              <RefreshCw size={16} className={cn(q.isFetching && 'animate-spin')} />
            </Button>
            <a
              href={csv}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3.5 py-1.5 text-sm font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800 hover:text-white"
            >
              <Download size={16} /> Export CSV
            </a>
          </>
        }
      />

      <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Select value={f.user} onChange={(e) => set('user', e.target.value)}>
          <option value="">All users</option>
          {(users.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}
            </option>
          ))}
        </Select>
        <Select value={f.bucket} onChange={(e) => set('bucket', e.target.value)}>
          <option value="">All buckets</option>
          {(buckets.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.displayName || b.name}
            </option>
          ))}
        </Select>
        <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Action, e.g. object.delete" />
        <Select value={f.result} onChange={(e) => set('result', e.target.value as Filters['result'])}>
          <option value="">Any result</option>
          <option value="ok">ok</option>
          <option value="denied">denied</option>
          <option value="error">error</option>
        </Select>
        <Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} title="From (inclusive)" />
        <Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} title="To (inclusive)" />
      </div>

      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox>{errMsg(q.error)}</ErrorBox>}
      {q.data && items.length === 0 && <EmptyState>No audit entries match.</EmptyState>}
      {items.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th className="w-44">Time</Th>
              <Th>User</Th>
              <Th>Action</Th>
              <Th>Target</Th>
              <Th className="text-right">Size</Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr
                key={a.id}
                className={cn('cursor-pointer align-top hover:bg-slate-800/30', expanded === a.id && 'bg-slate-800/20')}
                onClick={() => setExpanded((x) => (x === a.id ? null : a.id))}
              >
                <Td className="whitespace-nowrap text-xs text-slate-400">{fmtDate(a.ts)}</Td>
                <Td>
                  <div className="text-xs text-slate-200">{a.username || '—'}</div>
                  <div className="font-mono text-[11px] text-slate-500">{a.ip}</div>
                </Td>
                <Td className="font-mono text-xs text-slate-300">{a.action}</Td>
                <Td className="max-w-md">
                  {(a.bucketName || a.key) && (
                    <div className={cn('font-mono text-xs text-slate-300', expanded === a.id ? 'break-all' : 'truncate')} title={`${a.bucketName}/${a.key}`}>
                      {a.bucketName}
                      {a.key && `/${a.key}`}
                    </div>
                  )}
                  {a.detail && (
                    <div className={cn('text-[11px] text-slate-500', expanded === a.id ? 'whitespace-pre-wrap break-all' : 'truncate')}>{a.detail}</div>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-right text-xs text-slate-400">{a.size > 0 ? fmtSize(a.size) : ''}</Td>
                <Td>{resultBadge(a.result)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage ? <Spinner /> : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}
