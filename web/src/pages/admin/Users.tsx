import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderLock, KeyRound, Pencil, Trash2, UserPlus } from 'lucide-react'
import { useAuth } from '../../auth'
import { api, errMsg } from '../../lib/api'
import { fmtDate, fmtRelative } from '../../lib/format'
import type { CreateUserResult, Group, InviteLink, Role, User, UserAccess } from '../../lib/types'
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  CopyButton,
  Drawer,
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
  useToast,
} from '../../ui'
import { browserLink } from '../MyAccess'
import { useGroups, useUsers } from './hooks'

export function userStatus(u: User) {
  if (u.disabled) return <Badge tone="red">disabled</Badge>
  if (u.pending) return <Badge tone="amber">pending</Badge>
  return <Badge tone="green">active</Badge>
}

export default function Users() {
  const qc = useQueryClient()
  const toast = useToast()
  const { me } = useAuth()
  const users = useUsers()
  const groups = useGroups()
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [deleting, setDeleting] = useState<User | null>(null)
  const [accessOf, setAccessOf] = useState<User | null>(null)
  const [link, setLink] = useState<{ title: string; user: User; invite: InviteLink } | null>(null)

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin'] })

  const reset = useMutation({
    mutationFn: (u: User) => api.post<InviteLink>(`/api/admin/users/${encodeURIComponent(u.id)}/reset`),
    onSuccess: (invite, u) => {
      setLink({ title: 'Password reset link', user: u, invite })
      invalidate()
    },
    onError: (e) => toast.error(errMsg(e)),
  })

  const remove = useMutation({
    mutationFn: (u: User) => api.del(`/api/admin/users/${encodeURIComponent(u.id)}`),
    onSuccess: () => {
      setDeleting(null)
      toast.ok('User deleted')
      invalidate()
    },
  })

  const rows = users.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        subtitle="Invite people, manage roles and group memberships. Users set their own password via an invite link."
        actions={
          <Button onClick={() => setInviting(true)}>
            <UserPlus size={16} /> Invite user
          </Button>
        }
      />
      {users.isLoading && <Loading />}
      {users.isError && <ErrorBox>{errMsg(users.error)}</ErrorBox>}
      {users.data && rows.length === 0 && <EmptyState>No users.</EmptyState>}
      {rows.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Role</Th>
              <Th>Groups</Th>
              <Th>Status</Th>
              <Th>Last login</Th>
              <Th className="w-44" />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="hover:bg-slate-800/30">
                <Td>
                  <div className="font-medium text-slate-100">
                    {u.displayName || u.username}
                    {u.id === me?.id && <span className="ml-2 text-[10px] text-slate-500">(you)</span>}
                  </div>
                  <div className="font-mono text-xs text-slate-500">{u.username}</div>
                </Td>
                <Td>{u.role === 'admin' ? <Badge tone="violet">admin</Badge> : <Badge tone="slate">user</Badge>}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {u.groups.length === 0 && <span className="text-xs text-slate-600">—</span>}
                    {u.groups.map((g) => (
                      <Badge key={g.id} tone="indigo" className="normal-case">
                        {g.name}
                      </Badge>
                    ))}
                  </div>
                </Td>
                <Td>{userStatus(u)}</Td>
                <Td className="text-xs text-slate-400">
                  <span title={fmtDate(u.lastLoginAt)}>{fmtRelative(u.lastLoginAt)}</span>
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" title="Effective access" onClick={() => setAccessOf(u)}>
                      <FolderLock size={14} />
                    </Button>
                    <Button size="sm" variant="ghost" title="Edit" onClick={() => setEditing(u)}>
                      <Pencil size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={u.pending ? 'New invite link' : 'Reset password'}
                      disabled={reset.isPending}
                      onClick={() => {
                        if (
                          confirm(
                            u.pending
                              ? `Create a new invite link for "${u.username}"? The previous link stops working.`
                              : `Reset the password of "${u.username}"? They will be signed out and need the new link to log in.`,
                          )
                        )
                          reset.mutate(u)
                      }}
                    >
                      <KeyRound size={14} />
                    </Button>
                    <Button size="sm" variant="ghost" className="hover:text-rose-400" title="Delete" onClick={() => setDeleting(u)} disabled={u.id === me?.id}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {inviting && (
        <UserModal
          groups={groups.data ?? []}
          onClose={() => setInviting(false)}
          onCreated={(r) => {
            setInviting(false)
            setLink({ title: 'Invite link', user: r.user, invite: r.invite })
            invalidate()
          }}
          onSaved={() => undefined}
        />
      )}
      {editing && (
        <UserModal
          user={editing}
          groups={groups.data ?? []}
          onClose={() => setEditing(null)}
          onCreated={() => undefined}
          onSaved={() => {
            setEditing(null)
            toast.ok('User updated')
            invalidate()
          }}
        />
      )}
      {link && <LinkModal {...link} onClose={() => setLink(null)} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete user"
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
            Delete <b>{deleting?.username}</b>? Their sessions and direct grants are removed. Audit entries are kept.
          </>
        }
      />
      <AccessDrawer user={accessOf} onClose={() => setAccessOf(null)} />
    </div>
  )
}

function GroupPicker({ groups, value, onChange }: { groups: Group[]; value: string[]; onChange: (v: string[]) => void }) {
  if (groups.length === 0) return <div className="text-xs text-slate-500">No groups yet.</div>
  return (
    <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
      {groups.map((g) => (
        <Checkbox
          key={g.id}
          checked={value.includes(g.id)}
          onChange={(on) => onChange(on ? [...value, g.id] : value.filter((x) => x !== g.id))}
          label={<span className="truncate">{g.name}</span>}
        />
      ))}
    </div>
  )
}

function UserModal({
  user,
  groups,
  onClose,
  onCreated,
  onSaved,
}: {
  user?: User
  groups: Group[]
  onClose: () => void
  onCreated: (r: CreateUserResult) => void
  onSaved: () => void
}) {
  const [username, setUsername] = useState(user?.username ?? '')
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [role, setRole] = useState<Role>(user?.role ?? 'user')
  const [disabled, setDisabled] = useState(user?.disabled ?? false)
  const [groupIds, setGroupIds] = useState<string[]>(user?.groups.map((g) => g.id) ?? [])
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      if (user) {
        await api.put<User>(`/api/admin/users/${encodeURIComponent(user.id)}`, { displayName, role, disabled, groupIds })
        onSaved()
      } else {
        onCreated(await api.post<CreateUserResult>('/api/admin/users', { username: username.trim().toLowerCase(), displayName, role, groupIds }))
      }
    },
    onError: (e) => setError(errMsg(e)),
  })

  return (
    <Modal open onClose={onClose} title={user ? `Edit ${user.username}` : 'Invite user'} subtitle={user ? undefined : 'An invite link is generated; send it to the user yourself.'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          setError('')
          if (!user && !/^[a-z0-9._-]{3,64}$/i.test(username.trim()))
            return setError('Username must be 3–64 characters of a–z, 0–9, ".", "_" or "-".')
          save.mutate()
        }}
      >
        {!user && (
          <Field label="Username">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus placeholder="jane.doe" className="font-mono" required />
          </Field>
        )}
        <Field label="Display name">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Doe" autoFocus={!!user} />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="user">User — access via grants only</option>
            <option value="admin">Admin — full access to everything</option>
          </Select>
        </Field>
        <div className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">Groups</span>
          <GroupPicker groups={groups} value={groupIds} onChange={setGroupIds} />
        </div>
        {user && <Checkbox checked={disabled} onChange={setDisabled} label="Disabled (cannot log in; sessions are ended)" />}
        <ErrorBox>{error}</ErrorBox>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? <Spinner className="border-white/30 border-t-white" /> : user ? 'Save' : 'Create & get link'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function LinkModal({ title, user, invite, onClose }: { title: string; user: User; invite: InviteLink; onClose: () => void }) {
  const url = window.location.origin + invite.invitePath
  return (
    <Modal open onClose={onClose} title={title} subtitle={`for ${user.username}`}>
      <div className="space-y-4">
        <p className="text-sm text-slate-300">Send this one-time link to the user. It lets them set their own password.</p>
        <div className="flex items-center gap-2">
          <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <CopyButton text={url} />
        </div>
        <p className="text-xs text-slate-500">
          Expires {fmtDate(invite.expiresAt)} ({fmtRelative(invite.expiresAt)}). It won't be shown again — generate a new one with the key button if lost.
        </p>
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  )
}

function AccessDrawer({ user, onClose }: { user: User | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['admin', 'user-access', user?.id],
    queryFn: () => api.get<UserAccess>(`/api/admin/users/${encodeURIComponent(user!.id)}/access`),
    enabled: !!user,
  })
  if (!user) return null
  return (
    <Drawer open onClose={onClose} title={`Access: ${user.displayName || user.username}`} subtitle={user.role === 'admin' ? 'Admins have full access to every bucket.' : 'Grants applying to this user, directly or via groups.'}>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBox>{errMsg(q.error)}</ErrorBox>}
      {q.data && (
        <div className="space-y-6">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Grants</h3>
            {q.data.grants.length === 0 && <div className="text-sm text-slate-500">No grants.</div>}
            <ul className="space-y-2">
              {q.data.grants.map((g) => (
                <li key={g.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-slate-200">
                      {g.bucketName}/{g.prefix}
                    </span>
                    {g.via === 'group' ? <Badge tone="indigo" className="normal-case">via group {g.subjectName}</Badge> : <Badge tone="slate">direct</Badge>}
                  </div>
                  <PermBadges perms={g.perms} className="mt-2" />
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Entry points</h3>
            {q.data.access.length === 0 && <div className="text-sm text-slate-500">None.</div>}
            <ul className="space-y-2">
              {q.data.access.map((a) => (
                <li key={`${a.bucketId}:${a.prefix}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <a href={browserLink(a.bucketId, a.prefix)} className="truncate font-mono text-xs text-indigo-300 hover:underline">
                    {a.displayName || a.bucketName}/{a.prefix}
                  </a>
                  <PermBadges perms={a.perms} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Drawer>
  )
}
