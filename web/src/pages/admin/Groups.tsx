import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Search, Trash2, UsersRound } from 'lucide-react'
import { api, errMsg } from '../../lib/api'
import type { Group, User } from '../../lib/types'
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
  Spinner,
  useToast,
} from '../../ui'
import { useGroups, useUsers } from './hooks'

export default function Groups() {
  const qc = useQueryClient()
  const toast = useToast()
  const groups = useGroups()
  const users = useUsers()
  const [editing, setEditing] = useState<Group | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Group | null>(null)

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin'] })

  const remove = useMutation({
    mutationFn: (g: Group) => api.del(`/api/admin/groups/${encodeURIComponent(g.id)}`),
    onSuccess: () => {
      setDeleting(null)
      toast.ok('Group deleted')
      invalidate()
    },
  })

  const rows = groups.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Groups"
        subtitle="Grant access to many users at once by granting it to a group."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus size={16} /> New group
          </Button>
        }
      />
      {groups.isLoading && <Loading />}
      {groups.isError && <ErrorBox>{errMsg(groups.error)}</ErrorBox>}
      {groups.data && rows.length === 0 && <EmptyState>No groups yet.</EmptyState>}
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((g) => (
          <div key={g.id} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
                  <UsersRound size={20} />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-slate-100">{g.name}</div>
                  <div className="text-xs text-slate-500">
                    {g.members.length} member{g.members.length === 1 ? '' : 's'}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" title="Edit" onClick={() => setEditing(g)}>
                  <Pencil size={14} />
                </Button>
                <Button size="sm" variant="ghost" className="hover:text-rose-400" title="Delete" onClick={() => setDeleting(g)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
            {g.members.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {g.members.map((m) => (
                  <Badge key={m.id} tone="slate" className="normal-case">
                    {m.displayName || m.username}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <GroupModal
          group={editing === 'new' ? undefined : editing}
          users={users.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            invalidate()
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete group"
        confirmLabel="Delete"
        busy={remove.isPending}
        error={remove.error ? errMsg(remove.error) : undefined}
        onClose={() => {
          setDeleting(null)
          remove.reset()
        }}
        onConfirm={() => deleting && remove.mutate(deleting)}
        message={
          <>
            Delete group <b>{deleting?.name}</b>? All grants given to this group are deleted too; members lose that access immediately.
          </>
        }
      />
    </div>
  )
}

function GroupModal({ group, users, onClose, onSaved }: { group?: Group; users: User[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(group?.name ?? '')
  const [memberIds, setMemberIds] = useState<string[]>(group?.members.map((m) => m.id) ?? [])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: () =>
      group
        ? api.put<Group>(`/api/admin/groups/${encodeURIComponent(group.id)}`, { name: name.trim(), memberIds })
        : api.post<Group>('/api/admin/groups', { name: name.trim(), memberIds }),
    onSuccess: onSaved,
    onError: (e) => setError(errMsg(e)),
  })

  const f = filter.toLowerCase()
  const shown = users.filter((u) => u.username.toLowerCase().includes(f) || u.displayName.toLowerCase().includes(f))

  return (
    <Modal open onClose={onClose} title={group ? `Edit group ${group.name}` : 'New group'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          setError('')
          save.mutate()
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required placeholder="finance" />
        </Field>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">Members</span>
            <span className="text-xs text-slate-500">{memberIds.length} selected</span>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter users" className="pl-8" />
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
            {shown.length === 0 && <div className="text-xs text-slate-500">No users.</div>}
            {shown.map((u) => (
              <Checkbox
                key={u.id}
                className="flex"
                checked={memberIds.includes(u.id)}
                onChange={(on) => setMemberIds(on ? [...memberIds, u.id] : memberIds.filter((x) => x !== u.id))}
                label={
                  <span className="truncate">
                    {u.displayName || u.username} <span className="font-mono text-xs text-slate-500">{u.username}</span>
                  </span>
                }
              />
            ))}
          </div>
        </div>
        <ErrorBox>{error}</ErrorBox>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || !name.trim()}>
            {save.isPending ? <Spinner className="border-white/30 border-t-white" /> : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
