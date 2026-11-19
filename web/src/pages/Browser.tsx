import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Database,
  Download,
  Eye,
  File as FileIcon,
  Folder,
  FolderPlus,
  FolderUp,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { ApiError, api, downloadUrl, errMsg } from '../lib/api'
import { fmtDate, fmtSize } from '../lib/format'
import { crumbs, previewKind, validateKey, validateName } from '../lib/keys'
import type { BrowseObject, CreateFolderResult, DeleteResult } from '../lib/types'
import { useBrowse } from '../browser/useBrowse'
import { useUploads } from '../browser/uploads'
import { filesFromDataTransfer, filesFromInput } from '../browser/collect'
import type { PickedFile } from '../browser/collect'
import Preview from '../browser/Preview'
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
  PermBadges,
  Spinner,
  cn,
  useToast,
} from '../ui'
import { browserLink } from './MyAccess'

type SortKey = 'name' | 'size' | 'lastModified'

export default function Browser() {
  const { bucketId = '' } = useParams()
  const [params] = useSearchParams()
  const prefix = params.get('prefix') ?? ''
  const qc = useQueryClient()
  const toast = useToast()
  const uploads = useUploads()

  const browse = useBrowse(bucketId, prefix)
  const data = browse.merged

  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<BrowseObject | null>(null)
  const [newFolder, setNewFolder] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const dirInput = useRef<HTMLInputElement>(null)

  // Reset view state when navigating to another folder.
  useEffect(() => {
    setSelected(new Set())
    setFilter('')
    setPreview(null)
  }, [bucketId, prefix])

  // Stop the browser from opening dropped files when they miss the drop zone (or upload isn't allowed).
  useEffect(() => {
    const block = (e: globalThis.DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  useEffect(() => {
    dirInput.current?.setAttribute('webkitdirectory', '')
    dirInput.current?.setAttribute('directory', '')
  })

  const perms = data?.perms
  const isVirtual = !!data?.virtual
  const canRead = !!perms?.read && !isVirtual
  const canUpload = !!perms?.create && !isVirtual
  const canDeleteObjects = !!perms?.delete && !isVirtual
  const bucketLabel = data?.bucket.displayName || data?.bucket.name || 'bucket'

  const folders = useMemo(() => {
    const f = (data?.folders ?? []).filter((x) => x.name.toLowerCase().includes(filter.toLowerCase()))
    const dir = sort.key === 'name' && !sort.asc ? -1 : 1
    return [...f].sort((a, b) => dir * a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, [data, filter, sort])

  const objects = useMemo(() => {
    const o = isVirtual ? [] : (data?.objects ?? []).filter((x) => x.name.toLowerCase().includes(filter.toLowerCase()))
    const dir = sort.asc ? 1 : -1
    return [...o].sort((a, b) => {
      let c = 0
      if (sort.key === 'size') c = a.size - b.size
      else if (sort.key === 'lastModified') c = a.lastModified.localeCompare(b.lastModified)
      if (c === 0) c = a.name.localeCompare(b.name, undefined, { numeric: true })
      return dir * c
    })
  }, [data, filter, sort, isVirtual])

  // Selectable = deletable. Folders carry their own perms.
  const selectable = useMemo(() => {
    const keys: string[] = []
    for (const f of folders) if (f.perms.delete && !isVirtual) keys.push(f.prefix)
    if (canDeleteObjects) for (const o of objects) keys.push(o.key)
    return keys
  }, [folders, objects, canDeleteObjects, isVirtual])
  const showSelect = selectable.length > 0
  const selectedKeys = selectable.filter((k) => selected.has(k))
  const selectedFolders = selectedKeys.filter((k) => k.endsWith('/'))

  function toggle(key: string, on: boolean) {
    setSelected((s) => {
      const n = new Set(s)
      if (on) n.add(key)
      else n.delete(key)
      return n
    })
  }

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(selectable) : new Set())
  }

  function setSortKey(key: SortKey) {
    setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: true }))
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ['browse', bucketId] })

  const del = useMutation({
    mutationFn: (keys: string[]) => api.post<DeleteResult>('/api/objects/delete', { bucket: bucketId, keys }),
    onSuccess: (res) => {
      setConfirmDelete(false)
      setSelected(new Set())
      if (res.errors.length === 0) toast.ok(`Deleted ${res.deleted} object${res.deleted === 1 ? '' : 's'}`)
      else
        toast.error(
          `Deleted ${res.deleted}, ${res.errors.length} failed: ` +
            res.errors
              .slice(0, 3)
              .map((e) => `${e.key} (${e.message})`)
              .join('; ') +
            (res.errors.length > 3 ? '…' : ''),
        )
      void invalidate()
    },
  })

  function startUpload(files: PickedFile[]) {
    if (!canUpload || files.length === 0) return
    const invalid = uploads.enqueue({ bucketId, bucketLabel, prefix, canUpdate: !!perms?.update, files })
    if (invalid > 0) toast.error(`${invalid} file${invalid > 1 ? 's have' : ' has'} an invalid name and will be skipped`)
  }

  // ---- drag & drop ----
  function hasFiles(e: DragEvent) {
    return Array.from(e.dataTransfer.types).includes('Files')
  }
  const dropHandlers = canUpload
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          dragDepth.current++
          setDragging(true)
        },
        onDragOver: (e: DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        },
        onDragLeave: (e: DragEvent) => {
          if (!hasFiles(e)) return
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        },
        onDrop: (e: DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          filesFromDataTransfer(e.dataTransfer).then(startUpload, (err) => toast.error(errMsg(err, 'Could not read dropped files')))
        },
      }
    : {}

  // ---- render ----
  const err = browse.error
  const forbidden = err instanceof ApiError && err.status === 403
  const notFound = err instanceof ApiError && err.status === 404

  const totalLoaded = (data?.folders.length ?? 0) + (data?.objects.length ?? 0)
  const allSelected = showSelect && selectedKeys.length === selectable.length

  return (
    <div className="relative min-h-[70vh] space-y-5" {...dropHandlers}>
      {/* Breadcrumb */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <Link to={browserLink(bucketId, '')} className="flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold text-slate-100 hover:bg-slate-800">
            <Database size={16} className="text-indigo-400" />
            {data ? bucketLabel : 'Bucket'}
          </Link>
          {crumbs(prefix).map((c, i, arr) => (
            <span key={c.prefix} className="flex items-center gap-1">
              <ChevronRight size={14} className="text-slate-600" />
              {i === arr.length - 1 ? (
                <span className="rounded-lg px-2 py-1 font-medium text-slate-200">{c.label}</span>
              ) : (
                <Link to={browserLink(bucketId, c.prefix)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
                  {c.label}
                </Link>
              )}
            </span>
          ))}
        </nav>
        {perms && !isVirtual && <PermBadges perms={perms} className="shrink-0" />}
        {isVirtual && <Badge tone="slate">navigation only</Badge>}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter loaded items by name" className="pl-8" />
        </div>
        <Button variant="ghost" size="md" title="Refresh" onClick={() => void browse.refetch()} disabled={browse.isFetching}>
          <RefreshCw size={16} className={cn(browse.isFetching && 'animate-spin')} />
        </Button>
        <div className="flex-1" />
        {selectedKeys.length > 0 && (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} /> Delete ({selectedKeys.length})
          </Button>
        )}
        {canUpload && (
          <>
            <Button variant="outline" onClick={() => setNewFolder(true)}>
              <FolderPlus size={16} /> New folder
            </Button>
            <Button variant="outline" onClick={() => dirInput.current?.click()}>
              <FolderUp size={16} /> Upload folder
            </Button>
            <Button onClick={() => fileInput.current?.click()}>
              <Upload size={16} /> Upload
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                startUpload(filesFromInput(e.target.files))
                e.target.value = ''
              }}
            />
            <input
              ref={dirInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                startUpload(filesFromInput(e.target.files))
                e.target.value = ''
              }}
            />
          </>
        )}
      </div>

      {browse.isLoading && <Loading />}
      {err && (
        <ErrorBox className="text-sm">
          {forbidden
            ? "You don't have access to this folder."
            : notFound
              ? 'Bucket not found.'
              : errMsg(err, 'Failed to list folder')}{' '}
          <Link to="/" className="underline">
            Back to My Access
          </Link>
        </ErrorBox>
      )}

      {data && totalLoaded === 0 && (
        <EmptyState>
          This folder is empty.
          {canUpload && ' Drop files or folders here to upload.'}
        </EmptyState>
      )}

      {data && totalLoaded > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/80 shadow-xl">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {showSelect && (
                  <th className="w-10 px-4 py-2.5">
                    <Checkbox checked={allSelected} indeterminate={selectedKeys.length > 0} onChange={toggleAll} />
                  </th>
                )}
                <SortTh label="Name" k="name" sort={sort} onClick={setSortKey} />
                <SortTh label="Size" k="size" sort={sort} onClick={setSortKey} className="w-28 text-right" />
                <SortTh label="Last modified" k="lastModified" sort={sort} onClick={setSortKey} className="w-48" />
                <th className="w-24 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {folders.map((f) => {
                const sel = f.perms.delete && !isVirtual
                return (
                  <tr key={f.prefix} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                    {showSelect && (
                      <td className="px-4 py-2">
                        {sel && <Checkbox checked={selected.has(f.prefix)} onChange={(v) => toggle(f.prefix, v)} />}
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <Link to={browserLink(bucketId, f.prefix)} className="flex items-center gap-2.5 font-medium text-slate-100 hover:text-indigo-300">
                        <Folder size={18} className="shrink-0 fill-indigo-500/20 text-indigo-400" />
                        <span className="truncate">{f.name}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-slate-500">—</td>
                    <td className="px-4 py-2 text-xs text-slate-500">—</td>
                    <td className="px-4 py-2" />
                  </tr>
                )
              })}
              {objects.map((o) => {
                const pk = previewKind(o.name)
                return (
                  <tr key={o.key} className={cn('border-b border-slate-800/60 hover:bg-slate-800/30', preview?.key === o.key && 'bg-indigo-950/30')}>
                    {showSelect && (
                      <td className="px-4 py-2">
                        {canDeleteObjects && <Checkbox checked={selected.has(o.key)} onChange={(v) => toggle(o.key, v)} />}
                      </td>
                    )}
                    <td className="max-w-0 px-4 py-2">
                      <button
                        className="flex w-full min-w-0 items-center gap-2.5 text-left text-slate-200 hover:text-indigo-300"
                        onClick={() => canRead && setPreview(o)}
                        title={o.key}
                      >
                        <FileIcon size={16} className="shrink-0 text-slate-500" />
                        <span className="truncate">{o.name}</span>
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-xs tabular-nums text-slate-400">{fmtSize(o.size)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-400">{fmtDate(o.lastModified)}</td>
                    <td className="px-4 py-2">
                      {canRead && (
                        <div className="flex justify-end gap-1">
                          {pk && (
                            <button className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200" title="Preview" onClick={() => setPreview(o)}>
                              <Eye size={15} />
                            </button>
                          )}
                          <a className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200" title="Download" href={downloadUrl(bucketId, o.key)}>
                            <Download size={15} />
                          </a>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {folders.length + objects.length === 0 && (
                <tr>
                  <td colSpan={showSelect ? 5 : 4} className="px-4 py-8 text-center text-xs text-slate-500">
                    No loaded items match "{filter}".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {data.folders.length} folder{data.folders.length === 1 ? '' : 's'}
            {!isVirtual && `, ${data.objects.length} file${data.objects.length === 1 ? '' : 's'}`} loaded
            {browse.hasNextPage && ' (more available)'}
            {browse.hasNextPage && sort.key !== 'name' && ' · sorting applies to loaded items only'}
          </span>
          {browse.hasNextPage && (
            <Button variant="outline" size="sm" onClick={() => void browse.fetchNextPage()} disabled={browse.isFetchingNextPage}>
              {browse.isFetchingNextPage ? <Spinner className="h-3 w-3" /> : 'Load more'}
            </Button>
          )}
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-indigo-950/40 pl-64 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-indigo-400 bg-slate-900/90 px-10 py-8 text-center shadow-2xl">
            <Upload size={32} className="mx-auto mb-2 text-indigo-400" />
            <div className="font-semibold text-slate-100">Drop files or folders to upload</div>
            <div className="mt-1 font-mono text-xs text-slate-400">
              {bucketLabel}/{prefix}
            </div>
          </div>
        </div>
      )}

      <Preview bucketId={bucketId} obj={preview} onClose={() => setPreview(null)} />

      {newFolder && (
        <NewFolderModal
          bucketId={bucketId}
          prefix={prefix}
          onClose={() => setNewFolder(false)}
          onCreated={(p) => {
            setNewFolder(false)
            toast.ok(`Folder "${p}" created`)
            void invalidate()
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete items"
        confirmLabel="Delete"
        typeToConfirm={selectedFolders.length > 0 ? 'delete' : undefined}
        busy={del.isPending}
        error={del.error ? errMsg(del.error) : undefined}
        onClose={() => {
          setConfirmDelete(false)
          del.reset()
        }}
        onConfirm={() => del.mutate(selectedKeys)}
        message={
          <div className="space-y-2">
            <p>
              Permanently delete {selectedKeys.length} item{selectedKeys.length === 1 ? '' : 's'}? This cannot be undone.
            </p>
            {selectedFolders.length > 0 && (
              <p className="text-rose-300">
                {selectedFolders.length} folder{selectedFolders.length === 1 ? '' : 's'} and <b>everything inside</b> will be deleted.
              </p>
            )}
            <ul className="max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-2 font-mono text-xs text-slate-400">
              {selectedKeys.map((k) => (
                <li key={k} className="truncate">
                  {k.slice(prefix.length)}
                </li>
              ))}
            </ul>
          </div>
        }
      />
    </div>
  )
}

function SortTh({
  label,
  k,
  sort,
  onClick,
  className,
}: {
  label: string
  k: SortKey
  sort: { key: SortKey; asc: boolean }
  onClick: (k: SortKey) => void
  className?: string
}) {
  const active = sort.key === k
  return (
    <th className={cn('px-4 py-2.5', className)}>
      <button className={cn('inline-flex items-center gap-1 uppercase hover:text-slate-200', active && 'text-slate-200')} onClick={() => onClick(k)}>
        {label}
        {active && (sort.asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  )
}

function NewFolderModal({
  bucketId,
  prefix,
  onClose,
  onCreated,
}: {
  bucketId: string
  prefix: string
  onClose: () => void
  onCreated: (prefix: string) => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const create = useMutation({
    mutationFn: () => api.post<CreateFolderResult>('/api/folders', { bucket: bucketId, prefix, name }),
    onSuccess: (r) => onCreated(r.prefix),
    onError: (e) =>
      setError(e instanceof ApiError && e.code === 'OBJECT_EXISTS' ? 'A folder with this name already exists.' : errMsg(e)),
  })
  return (
    <Modal open onClose={onClose} title="New folder" subtitle={`in /${prefix}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          const v = validateName(name) || validateKey(prefix + name + '/')
          if (v) return setError(v)
          setError('')
          create.mutate()
        }}
      >
        <Field label="Folder name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="reports" />
        </Field>
        <ErrorBox>{error}</ErrorBox>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || !name}>
            {create.isPending ? <Spinner className="border-white/30 border-t-white" /> : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
