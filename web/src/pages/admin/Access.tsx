import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Database, Folder, FolderSearch, Pencil, Plus, Trash2, User as UserIcon, UsersRound } from 'lucide-react'
import { api, errMsg, qs } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { NO_PERMS, PRESETS, crumbs, presetName, samePerms } from '../../lib/keys'
import type { Bucket, Grant, Group, Perms, SubjectType, User } from '../../lib/types'
import { useBrowse } from '../../browser/useBrowse'
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
  PermBadges,
  Select,
  Spinner,
  Table,
  Td,
  Th,
  cn,
  useToast,
} from '../../ui'
import { useBuckets, useGroups, useUsers } from './hooks'

export default function Access() {
  const qc = useQueryClient()
  const toast = useToast()
  const users = useUsers()
  const groups = useGroups()
  const buckets = useBuckets()
  const [bucket, setBucket] = useState('')
  const [subject, setSubject] = useState('') // "user:<id>" | "group:<id>" | ''
  const [editing, setEditing] = useState<Grant | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Grant | null>(null)

  const [subjectType, subjectId] = subject ? (subject.split(/:(.*)/s) as [SubjectType, string]) : ['', '']
  const grants = useQuery({
    queryKey: ['admin', 'grants', bucket, subject],
    queryFn: () => api.get<Grant[]>(`/api/admin/grants${qs({ bucket, subjectType, subjectId })}`),
  })

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin'] })

  const remove = useMutation({
    mutationFn: (g: Grant) => api.del(`/api/admin/grants/${encodeURIComponent(g.id)}`),
    onSuccess: () => {
      setDeleting(null)
      toast.ok('Grant removed')
      invalidate()
    },
  })

  const rows = grants.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Access"
        subtitle="Grants give a user or group permissions on a bucket prefix. Effective permissions are the union of all matching grants."
        actions={
          <Button onClick={() => setEditing('new')} disabled={(buckets.data ?? []).length === 0}>
            <Plus size={16} /> New grant
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3">
        <Select value={bucket} onChange={(e) => setBucket(e.target.value)} className="w-full sm:w-auto sm:min-w-[12rem]">
          <option value="">All buckets</option>
          {(buckets.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.displayName || b.name} ({b.connectionName})
            </option>
          ))}
        </Select>
        <Select value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full sm:w-auto sm:min-w-[12rem]">
          <option value="">All users & groups</option>
          <optgroup label="Groups">
            {(groups.data ?? []).map((g) => (
              <option key={g.id} value={`group:${g.id}`}>
                {g.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Users">
            {(users.data ?? []).map((u) => (
              <option key={u.id} value={`user:${u.id}`}>
                {u.displayName ? `${u.displayName} (${u.username})` : u.username}
              </option>
            ))}
          </optgroup>
        </Select>
      </div>

      {grants.isLoading && <Loading />}
      {grants.isError && <ErrorBox>{errMsg(grants.error)}</ErrorBox>}
      {grants.data && rows.length === 0 && <EmptyState>No grants match.</EmptyState>}
      {rows.length > 0 && (
        <Table className="[&_td]:whitespace-nowrap">
          <thead>
            <tr>
              <Th>Subject</Th>
              <Th>Bucket / prefix</Th>
              <Th>Permissions</Th>
              <Th>Created</Th>
              <Th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} className="hover:bg-gray-100 dark:hover:bg-zinc-800/30">
                <Td>
                  <div className="flex items-center gap-2">
                    {g.subjectType === 'group' ? <UsersRound size={14} className="text-teal-600 dark:text-teal-400" /> : <UserIcon size={14} className="text-gray-500 dark:text-zinc-400" />}
                    <span className="text-gray-900 dark:text-zinc-100">{g.subjectName}</span>
                    {g.subjectType === 'group' && <Badge tone="indigo">group</Badge>}
                  </div>
                </Td>
                <Td className="whitespace-nowrap font-mono text-xs">
                  <span className="text-gray-800 dark:text-zinc-200">{g.bucketName}</span>
                  <span className="text-gray-500 dark:text-zinc-400">/{g.prefix}</span>
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="w-20 text-xs text-gray-500 dark:text-zinc-400">{presetName(g.perms)}</span>
                    <PermBadges perms={g.perms} className="flex-nowrap" />
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-xs text-gray-500 dark:text-zinc-400">{fmtDate(g.createdAt)}</Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" title="Edit" aria-label="Edit" onClick={() => setEditing(g)}>
                      <Pencil size={14} />
                    </Button>
                    <Button size="sm" variant="ghost" className="hover:text-rose-600 dark:hover:text-rose-400" title="Delete" aria-label="Delete" onClick={() => setDeleting(g)}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {editing && (
        <GrantModal
          grant={editing === 'new' ? undefined : editing}
          users={users.data ?? []}
          groups={groups.data ?? []}
          buckets={buckets.data ?? []}
          defaultBucket={bucket}
          defaultSubject={subject}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            toast.ok('Grant saved')
            invalidate()
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Remove grant"
        confirmLabel="Remove"
        busy={remove.isPending}
        error={remove.error ? errMsg(remove.error) : undefined}
        onClose={() => {
          setDeleting(null)
          remove.reset()
        }}
        onConfirm={() => deleting && remove.mutate(deleting)}
        message={
          <>
            Remove access of <b>{deleting?.subjectName}</b> to{' '}
            <span className="font-mono">
              {deleting?.bucketName}/{deleting?.prefix}
            </span>
            ? Takes effect immediately.
          </>
        }
      />
    </div>
  )
}

function PermsEditor({ value, onChange }: { value: Perms; onChange: (p: Perms) => void }) {
  function set(k: keyof Perms, on: boolean) {
    if (k === 'read' && !on) return onChange({ ...NO_PERMS })
    const next = { ...value, [k]: on }
    if (on) next.read = true
    onChange(next)
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange({ ...p.perms })}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              samePerms(p.perms, value)
                ? 'border-teal-400 dark:border-teal-500/50 bg-teal-50 dark:bg-teal-600/20 text-teal-800 dark:text-teal-200'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950/50 p-3">
        <Checkbox checked={value.read} onChange={(v) => set('read', v)} label="Read — list, preview, download" />
        <Checkbox checked={value.create} onChange={(v) => set('create', v)} label="Create — upload new, new folder" />
        <Checkbox checked={value.update} onChange={(v) => set('update', v)} label="Update — overwrite existing" />
        <Checkbox checked={value.delete} onChange={(v) => set('delete', v)} label="Delete — files & folders" />
      </div>
    </div>
  )
}

function GrantModal({
  grant,
  users,
  groups,
  buckets,
  defaultBucket,
  defaultSubject,
  onClose,
  onSaved,
}: {
  grant?: Grant
  users: User[]
  groups: Group[]
  buckets: Bucket[]
  defaultBucket: string
  defaultSubject: string
  onClose: () => void
  onSaved: () => void
}) {
  const [defType, defId] = defaultSubject ? (defaultSubject.split(/:(.*)/s) as [SubjectType, string]) : ['user' as SubjectType, '']
  const [subjectType, setSubjectType] = useState<SubjectType>(grant?.subjectType ?? defType)
  const [subjectId, setSubjectId] = useState(grant?.subjectId ?? defId)
  const [bucketId, setBucketId] = useState(grant?.bucketId ?? (defaultBucket || buckets[0]?.id || ''))
  const [prefix, setPrefix] = useState(grant?.prefix ?? '')
  const [perms, setPerms] = useState<Perms>(grant?.perms ?? { ...PRESETS[0].perms })
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: () =>
      grant
        ? api.put<Grant>(`/api/admin/grants/${encodeURIComponent(grant.id)}`, { prefix: prefix.trim(), perms })
        : api.post<Grant>('/api/admin/grants', { subjectType, subjectId, bucketId, prefix: prefix.trim(), perms }),
    onSuccess: onSaved,
    onError: (e) => setError(errMsg(e)),
  })

  const subjects = subjectType === 'user'
    ? users.map((u) => ({ id: u.id, label: u.displayName ? `${u.displayName} (${u.username})` : u.username }))
    : groups.map((g) => ({ id: g.id, label: g.name }))

  return (
    <Modal open onClose={onClose} title={grant ? 'Edit grant' : 'New grant'} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          setError('')
          if (!grant && !subjectId) return setError('Choose a user or group.')
          if (!grant && !bucketId) return setError('Choose a bucket.')
          if (!perms.read) return setError('Select at least the read permission.')
          save.mutate()
        }}
      >
        {grant ? (
          <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950/50 p-3 text-sm">
            <span className="text-gray-500 dark:text-zinc-400">{grant.subjectType === 'group' ? 'Group' : 'User'}:</span>{' '}
            <span className="text-gray-900 dark:text-zinc-100">{grant.subjectName}</span>
            <span className="mx-2 text-gray-400 dark:text-zinc-600">·</span>
            <span className="text-gray-500 dark:text-zinc-400">Bucket:</span> <span className="font-mono text-gray-900 dark:text-zinc-100">{grant.bucketName}</span>
          </div>
        ) : (
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <Field label="Subject">
              <Select
                value={subjectType}
                onChange={(e) => {
                  setSubjectType(e.target.value as SubjectType)
                  setSubjectId('')
                }}
              >
                <option value="user">User</option>
                <option value="group">Group</option>
              </Select>
            </Field>
            <Field label={subjectType === 'user' ? 'User' : 'Group'}>
              <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                <option value="">— choose —</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        {!grant && (
          <Field label="Bucket">
            <Select
              value={bucketId}
              onChange={(e) => {
                setBucketId(e.target.value)
                setPrefix('')
                setPicking(false)
              }}
            >
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.displayName || b.name} ({b.connectionName} · {b.name})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Prefix" hint="empty = whole bucket">
          <div className="flex gap-2">
            <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="clients/acme/" className="font-mono" />
            <Button type="button" variant="outline" onClick={() => setPicking((p) => !p)} disabled={!bucketId}>
              <FolderSearch size={16} /> Browse
            </Button>
          </div>
        </Field>
        {picking && bucketId && (
          <FolderPicker
            bucketId={bucketId}
            initial={prefix.endsWith('/') ? prefix : ''}
            onPick={(p) => {
              setPrefix(p)
              setPicking(false)
            }}
          />
        )}
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-gray-700 dark:text-zinc-300">Permissions</span>
          <PermsEditor value={perms} onChange={setPerms} />
        </div>
        {!grant && (
          <p className="text-xs text-gray-500 dark:text-zinc-500">Saving a grant for the same subject, bucket and prefix updates the existing one.</p>
        )}
        <ErrorBox>{error}</ErrorBox>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? <Spinner className="border-white/30 border-t-white" /> : 'Save grant'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Browses a bucket's folders (admins have full access) and returns a prefix. */
export function FolderPicker({ bucketId, initial, onPick }: { bucketId: string; initial: string; onPick: (prefix: string) => void }) {
  const [prefix, setPrefix] = useState(initial)
  const b = useBrowse(bucketId, prefix)
  const data = b.merged
  return (
    <div className="space-y-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950/60 p-3">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <button type="button" className="flex items-center gap-1 rounded px-1.5 py-0.5 text-gray-800 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800" onClick={() => setPrefix('')}>
          <Database size={12} className="text-teal-600 dark:text-teal-400" /> {data?.bucket.name ?? 'bucket'}
        </button>
        {crumbs(prefix).map((c) => (
          <span key={c.prefix} className="flex items-center gap-1">
            <ChevronRight size={12} className="text-gray-400 dark:text-zinc-600" />
            <button type="button" className="rounded px-1.5 py-0.5 text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800" onClick={() => setPrefix(c.prefix)}>
              {c.label}
            </button>
          </span>
        ))}
      </div>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {b.isLoading && (
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        )}
        {b.isError && <ErrorBox className="m-2">{errMsg(b.error)}</ErrorBox>}
        {data && data.folders.length === 0 && <div className="p-3 text-xs text-gray-500 dark:text-zinc-500">No subfolders.</div>}
        {data?.folders.map((f) => (
          <button
            key={f.prefix}
            type="button"
            className="flex w-full items-center gap-2 border-b border-gray-200 dark:border-zinc-800/60 px-3 py-1.5 text-left text-sm text-gray-800 dark:text-zinc-200 last:border-0 hover:bg-gray-100 dark:hover:bg-zinc-800/60"
            onClick={() => setPrefix(f.prefix)}
          >
            <Folder size={14} className="text-teal-600 dark:text-teal-400" /> {f.name}
          </button>
        ))}
        {b.hasNextPage && (
          <button type="button" className="w-full px-3 py-1.5 text-xs text-teal-700 dark:text-teal-300 hover:bg-gray-100 dark:hover:bg-zinc-800/60" onClick={() => void b.fetchNextPage()} disabled={b.isFetchingNextPage}>
            {b.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-xs text-gray-500 dark:text-zinc-400">/{prefix}</span>
        <Button type="button" size="sm" onClick={() => onPick(prefix)}>
          Use this folder
        </Button>
      </div>
    </div>
  )
}
