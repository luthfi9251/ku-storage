import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Cable, CheckCircle2, Database, KeyRound, Pencil, Plus, Search, Trash2, XCircle } from 'lucide-react'
import { api, errMsg } from '../../lib/api'
import type { Bucket, BucketTestResult, Connection, ConnectionInput, ConnectionKind } from '../../lib/types'
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  Spinner,
  useToast,
} from '../../ui'
import { browserLink } from '../MyAccess'
import { useConnections } from './hooks'

export default function Connections() {
  const qc = useQueryClient()
  const toast = useToast()
  const conns = useConnections()
  const [editing, setEditing] = useState<Connection | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Connection | null>(null)
  const [discover, setDiscover] = useState<Connection | null>(null)
  const [addBucket, setAddBucket] = useState<{ conn: Connection; name: string } | null>(null)
  const [editBucket, setEditBucket] = useState<Bucket | null>(null)
  const [testBucket, setTestBucket] = useState<Bucket | null>(null)
  const [deleteBucket, setDeleteBucket] = useState<Bucket | null>(null)

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin'] })
    void qc.invalidateQueries({ queryKey: ['me'] })
  }

  const removeConn = useMutation({
    mutationFn: (c: Connection) => api.del(`/api/admin/connections/${encodeURIComponent(c.id)}`),
    onSuccess: () => {
      setDeleting(null)
      toast.ok('Connection deleted')
      invalidate()
    },
  })

  const removeBucket = useMutation({
    mutationFn: (b: Bucket) => api.del(`/api/admin/buckets/${encodeURIComponent(b.id)}`, { confirmName: b.name }),
    onSuccess: () => {
      setDeleteBucket(null)
      toast.ok('Bucket unregistered')
      invalidate()
    },
  })

  const rows = conns.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connections"
        subtitle="R2 / S3 credentials and the buckets registered under them. Secrets are encrypted and never shown again."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus size={16} /> New connection
          </Button>
        }
      />
      {conns.isLoading && <Loading />}
      {conns.isError && <ErrorBox>{errMsg(conns.error)}</ErrorBox>}
      {conns.data && rows.length === 0 && <EmptyState>No connections yet. Add your Cloudflare R2 API token to get started.</EmptyState>}

      <div className="space-y-4">
        {rows.map((c) => (
          <div key={c.id} className="rounded-2xl border border-slate-800 bg-slate-900/80 shadow-xl">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 p-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
                  <Cable size={20} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-slate-100">{c.name}</span>
                    <Badge tone={c.kind === 'r2' ? 'amber' : 'blue'}>{c.kind}</Badge>
                    {c.hasSecret && (
                      <Badge tone="green">
                        <KeyRound size={11} /> secret set
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-xs text-slate-400">
                    {c.kind === 'r2' ? `account ${c.accountId}` : `${c.endpoint} · ${c.region || 'no region'}${c.pathStyle ? ' · path-style' : ''}`}
                    {' · key '}
                    {c.accessKey}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                <Button size="sm" variant="outline" onClick={() => setDiscover(c)}>
                  <Search size={14} /> Discover buckets
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAddBucket({ conn: c, name: '' })}>
                  <Plus size={14} /> Add bucket
                </Button>
                <Button size="sm" variant="ghost" title="Edit" onClick={() => setEditing(c)}>
                  <Pencil size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="hover:text-rose-400"
                  title={c.buckets.length > 0 ? 'Remove its buckets first' : 'Delete'}
                  disabled={c.buckets.length > 0}
                  onClick={() => setDeleting(c)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
            {c.buckets.length === 0 ? (
              <div className="p-5 text-xs text-slate-500">No buckets registered on this connection.</div>
            ) : (
              <ul className="divide-y divide-slate-800/70">
                {c.buckets.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Database size={16} className="shrink-0 text-indigo-400" />
                      <div className="min-w-0">
                        <a href={browserLink(b.id, '')} className="truncate font-medium text-slate-100 hover:text-indigo-300">
                          {b.displayName || b.name}
                        </a>
                        <div className="font-mono text-xs text-slate-500">
                          {b.name} · {b.grantCount} grant{b.grantCount === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setTestBucket(b)}>
                        <CheckCircle2 size={14} /> Test
                      </Button>
                      <Button size="sm" variant="ghost" title="Edit display name" onClick={() => setEditBucket(b)}>
                        <Pencil size={14} />
                      </Button>
                      <Button size="sm" variant="ghost" className="hover:text-rose-400" title="Unregister" onClick={() => setDeleteBucket(b)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <ConnectionModal
          conn={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            toast.ok('Connection saved')
            invalidate()
          }}
        />
      )}
      {discover && (
        <DiscoverModal
          conn={discover}
          onClose={() => setDiscover(null)}
          onPick={(name) => {
            setAddBucket({ conn: discover, name })
            setDiscover(null)
          }}
        />
      )}
      {addBucket && (
        <BucketModal
          conn={addBucket.conn}
          initialName={addBucket.name}
          onClose={() => setAddBucket(null)}
          onSaved={() => {
            setAddBucket(null)
            toast.ok('Bucket registered')
            invalidate()
          }}
        />
      )}
      {editBucket && (
        <BucketModal
          bucket={editBucket}
          onClose={() => setEditBucket(null)}
          onSaved={() => {
            setEditBucket(null)
            invalidate()
          }}
        />
      )}
      {testBucket && <TestModal bucket={testBucket} onClose={() => setTestBucket(null)} />}

      <ConfirmDialog
        open={!!deleting}
        title="Delete connection"
        confirmLabel="Delete"
        busy={removeConn.isPending}
        error={removeConn.error ? errMsg(removeConn.error) : undefined}
        onClose={() => {
          setDeleting(null)
          removeConn.reset()
        }}
        onConfirm={() => deleting && removeConn.mutate(deleting)}
        message={
          <>
            Delete connection <b>{deleting?.name}</b> and its stored credentials?
          </>
        }
      />
      <ConfirmDialog
        open={!!deleteBucket}
        title="Unregister bucket"
        confirmLabel="Unregister"
        typeToConfirm={deleteBucket?.name}
        busy={removeBucket.isPending}
        error={removeBucket.error ? errMsg(removeBucket.error) : undefined}
        onClose={() => {
          setDeleteBucket(null)
          removeBucket.reset()
        }}
        onConfirm={() => deleteBucket && removeBucket.mutate(deleteBucket)}
        message={
          <>
            Unregister <b>{deleteBucket?.displayName || deleteBucket?.name}</b>? Its {deleteBucket?.grantCount ?? 0} grant(s) are deleted. The data in
            the bucket itself is not touched.
          </>
        }
      />
    </div>
  )
}

function ConnectionModal({ conn, onClose, onSaved }: { conn?: Connection; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<ConnectionInput>({
    name: conn?.name ?? '',
    kind: conn?.kind ?? 'r2',
    accountId: conn?.accountId ?? '',
    endpoint: conn?.endpoint ?? '',
    region: conn?.region ?? '',
    pathStyle: conn?.pathStyle ?? false,
    accessKey: conn?.accessKey ?? '',
    secretKey: '',
  })
  const [error, setError] = useState('')
  const set = <K extends keyof ConnectionInput>(k: K, v: ConnectionInput[K]) => setF((x) => ({ ...x, [k]: v }))

  const save = useMutation({
    mutationFn: () =>
      conn ? api.put<Connection>(`/api/admin/connections/${encodeURIComponent(conn.id)}`, f) : api.post<Connection>('/api/admin/connections', f),
    onSuccess: onSaved,
    onError: (e) => setError(errMsg(e)),
  })

  return (
    <Modal open onClose={onClose} title={conn ? `Edit ${conn.name}` : 'New connection'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          setError('')
          if (f.kind === 's3' && !/^https?:\/\//.test(f.endpoint)) return setError('Endpoint must start with https:// or http://')
          if (!conn && !f.secretKey) return setError('Secret key is required.')
          save.mutate()
        }}
      >
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <Field label="Name">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="production-r2" autoFocus required />
          </Field>
          <Field label="Kind">
            <Select value={f.kind} onChange={(e) => set('kind', e.target.value as ConnectionKind)}>
              <option value="r2">R2</option>
              <option value="s3">S3</option>
            </Select>
          </Field>
        </div>
        {f.kind === 'r2' ? (
          <Field label="Account ID" hint="Cloudflare dashboard → R2">
            <Input value={f.accountId} onChange={(e) => set('accountId', e.target.value)} className="font-mono" required />
          </Field>
        ) : (
          <>
            <Field label="Endpoint">
              <Input value={f.endpoint} onChange={(e) => set('endpoint', e.target.value)} placeholder="https://s3.example.com" className="font-mono" required />
            </Field>
            <div className="grid grid-cols-2 items-end gap-3">
              <Field label="Region">
                <Input value={f.region} onChange={(e) => set('region', e.target.value)} placeholder="us-east-1" className="font-mono" />
              </Field>
              <Checkbox className="pb-2" checked={f.pathStyle} onChange={(v) => set('pathStyle', v)} label="Path-style addressing" />
            </div>
          </>
        )}
        <Field label="Access key ID">
          <Input value={f.accessKey} onChange={(e) => set('accessKey', e.target.value)} className="font-mono" autoComplete="off" required />
        </Field>
        <Field label="Secret access key" hint={conn ? 'leave empty to keep' : undefined}>
          <Input
            type="password"
            value={f.secretKey}
            onChange={(e) => set('secretKey', e.target.value)}
            placeholder={conn?.hasSecret ? 'unchanged' : ''}
            className="font-mono"
            autoComplete="new-password"
          />
        </Field>
        <ErrorBox>{error}</ErrorBox>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? <Spinner className="border-white/30 border-t-white" /> : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function DiscoverModal({ conn, onClose, onPick }: { conn: Connection; onClose: () => void; onPick: (name: string) => void }) {
  const run = useMutation({
    mutationFn: () => api.post<{ buckets: string[] }>(`/api/admin/connections/${encodeURIComponent(conn.id)}/discover`),
  })
  const registered = new Set(conn.buckets.map((b) => b.name))
  // Run once when opened (user-initiated action, not polling). Ref guards StrictMode double effects.
  const started = useRef(false)
  const { mutate } = run
  useEffect(() => {
    if (started.current) return
    started.current = true
    mutate()
  }, [mutate])
  return (
    <Modal open onClose={onClose} title="Discover buckets" subtitle={`ListBuckets on ${conn.name}`}>
      <div className="space-y-3">
        {run.isPending && (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        )}
        {run.isError && (
          <ErrorBox>
            {errMsg(run.error)}
            <div className="mt-1 text-rose-400/80">Bucket-scoped R2 tokens usually can't list buckets — use “Add bucket” with the name instead.</div>
          </ErrorBox>
        )}
        {run.data && run.data.buckets.length === 0 && <div className="text-sm text-slate-500">No buckets visible to this token.</div>}
        {run.data && run.data.buckets.length > 0 && (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
            {run.data.buckets.map((name) => (
              <li key={name} className="flex items-center justify-between px-3 py-2">
                <span className="font-mono text-sm text-slate-200">{name}</span>
                {registered.has(name) ? (
                  <Badge tone="green">registered</Badge>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => onPick(name)}>
                    <Plus size={12} /> Register
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

function BucketModal({
  conn,
  bucket,
  initialName = '',
  onClose,
  onSaved,
}: {
  conn?: Connection
  bucket?: Bucket
  initialName?: string
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(bucket?.name ?? initialName)
  const [displayName, setDisplayName] = useState(bucket?.displayName ?? '')
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: () =>
      bucket
        ? api.put<Bucket>(`/api/admin/buckets/${encodeURIComponent(bucket.id)}`, { displayName })
        : api.post<Bucket>('/api/admin/buckets', { connectionId: conn!.id, name: name.trim(), displayName }),
    onSuccess: onSaved,
    onError: (e) => setError(errMsg(e)),
  })
  return (
    <Modal open onClose={onClose} title={bucket ? `Edit ${bucket.name}` : 'Register bucket'} subtitle={conn ? `on ${conn.name}` : undefined}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          setError('')
          save.mutate()
        }}
      >
        <Field label="Bucket name" hint="exact name in R2">
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!!bucket} className="font-mono" autoFocus={!bucket && !initialName} required />
        </Field>
        <Field label="Display name" hint="optional">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={name} autoFocus={!!bucket || !!initialName} />
        </Field>
        <ErrorBox>{error}</ErrorBox>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? <Spinner className="border-white/30 border-t-white" /> : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function TestModal({ bucket, onClose }: { bucket: Bucket; onClose: () => void }) {
  const [write, setWrite] = useState(false)
  const run = useMutation({
    mutationFn: () => api.post<BucketTestResult>(`/api/admin/buckets/${encodeURIComponent(bucket.id)}/test`, { write }),
  })
  return (
    <Modal open onClose={onClose} title={`Test ${bucket.displayName || bucket.name}`}>
      <div className="space-y-4">
        <Checkbox checked={write} onChange={setWrite} label="Include write probe (PUT + DELETE a temporary object)" />
        <Button onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? <Spinner className="border-white/30 border-t-white" /> : 'Run test'}
        </Button>
        {run.isError && <ErrorBox>{errMsg(run.error)}</ErrorBox>}
        {run.data && (
          <div className="space-y-2">
            <div className={run.data.ok ? 'text-sm font-semibold text-emerald-400' : 'text-sm font-semibold text-rose-400'}>
              {run.data.ok ? 'All checks passed' : 'Some checks failed'}
            </div>
            <ul className="space-y-1.5">
              {run.data.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 text-xs">
                  {s.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" /> : <XCircle size={14} className="mt-0.5 shrink-0 text-rose-400" />}
                  <div className="min-w-0">
                    <div className="font-medium text-slate-200">{s.name}</div>
                    {s.message && <div className="break-words text-slate-400">{s.message}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
