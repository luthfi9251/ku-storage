import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Eye,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderUp,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UploadCloud,
} from 'lucide-react'
import { ApiError, api, downloadUrl, errMsg } from '../lib/api'
import { fmtDate, fmtRelative, fmtSize } from '../lib/format'
import { crumbs, previewKind, validateKey, validateName } from '../lib/keys'
import type { BrowseFolder, BrowseObject, CreateFolderResult, DeleteResult } from '../lib/types'
import { useBrowse } from '../browser/useBrowse'
import { useUploads } from '../browser/uploads'
import { filesFromDataTransfer, filesFromInput } from '../browser/collect'
import type { PickedFile } from '../browser/collect'
import { FileTypeIcon, fileKind, fileStyle } from '../browser/fileTypes'
import Preview from '../browser/Preview'
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorBox,
  Field,
  IconButton,
  InfoBox,
  Input,
  Loading,
  Menu,
  MenuDivider,
  MenuItem,
  Modal,
  PermBadges,
  Spinner,
  buttonClass,
  cn,
  focusRing,
  useToast,
} from '../ui'
import { browserLink } from './MyAccess'

type SortKey = 'name' | 'size' | 'lastModified'
type Sort = { key: SortKey; asc: boolean }
type ViewMode = 'list' | 'grid'

const VIEW_KEY = 'ku-storage:view'
const THUMB_MAX = 5 * 1024 * 1024

function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

function saveView(v: ViewMode) {
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    /* storage unavailable */
  }
}

const SORT_LABEL: Record<SortKey, string> = { name: 'Name', size: 'Size', lastModified: 'Modified' }

/** Row/card actions: hidden until hover on pointer devices, always visible on touch. */
const hoverReveal =
  '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 transition-opacity'

export default function Browser() {
  const { bucketId = '' } = useParams()
  const [params] = useSearchParams()
  const prefix = params.get('prefix') ?? ''
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const uploads = useUploads()

  const browse = useBrowse(bucketId, prefix)
  const data = browse.merged

  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'name', asc: true })
  const [view, setViewState] = useState<ViewMode>(loadView)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<BrowseObject | null>(null)
  const [newFolder, setNewFolder] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const dirInput = useRef<HTMLInputElement>(null)

  function setView(v: ViewMode) {
    setViewState(v)
    saveView(v)
  }

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
  const selectedFile = selectedKeys.length === 1 && selectedFolders.length === 0 ? selectedKeys[0] : null

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
  const noMatch = folders.length + objects.length === 0

  const openFolder = (f: BrowseFolder) => navigate(browserLink(bucketId, f.prefix))
  const openFile = (o: BrowseObject) => canRead && setPreview(o)

  return (
    <div className="relative min-h-[70vh] space-y-5 pb-24" {...dropHandlers}>
      {/* Header: breadcrumb + perms */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <nav className="flex min-w-0 flex-wrap items-center gap-0.5 text-lg" aria-label="Breadcrumb">
          <Link
            to={browserLink(bucketId, '')}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 font-semibold tracking-tight -ml-2',
              prefix ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100' : 'text-gray-900 dark:text-zinc-50',
              focusRing,
            )}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
              <Database size={15} />
            </span>
            <span className="truncate">{data ? bucketLabel : 'Bucket'}</span>
          </Link>
          {crumbs(prefix).map((c, i, arr) => (
            <span key={c.prefix} className="flex min-w-0 items-center gap-0.5">
              <ChevronRight size={18} className="shrink-0 text-gray-300 dark:text-zinc-600" />
              {i === arr.length - 1 ? (
                <span className="truncate rounded-lg px-2 py-1 font-semibold tracking-tight text-gray-900 dark:text-zinc-50">{c.label}</span>
              ) : (
                <Link
                  to={browserLink(bucketId, c.prefix)}
                  className={cn(
                    'truncate rounded-lg px-2 py-1 font-semibold tracking-tight text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
                    focusRing,
                  )}
                >
                  {c.label}
                </Link>
              )}
            </span>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          {perms && !isVirtual && (
            <>
              <span className="text-xs text-gray-400 dark:text-zinc-500">You can</span>
              <PermBadges perms={perms} />
            </>
          )}
          {isVirtual && <Badge tone="slate">navigation only</Badge>}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name" aria-label="Filter loaded items by name" className="pl-9" />
        </div>

        <Menu
          align="left"
          width="w-48"
          ariaLabel="Sort"
          buttonClassName={buttonClass('outline', 'md', 'w-9 px-0 sm:w-auto sm:px-3')}
          button={
            <>
              <ArrowDownUp size={15} />
              <span className="hidden sm:inline">{SORT_LABEL[sort.key]}</span>
              <ChevronDown size={14} className="hidden opacity-60 sm:block" />
            </>
          }
        >
          <div className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-gray-400 dark:text-zinc-500">Sort by</div>
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <MenuItem key={k} onClick={() => setSort((s) => ({ key: k, asc: s.key === k ? s.asc : true }))}>
              <Check size={15} className={cn('shrink-0 text-teal-600 dark:text-teal-400', sort.key !== k && 'invisible')} />
              {SORT_LABEL[k]}
            </MenuItem>
          ))}
          <MenuDivider />
          {[true, false].map((asc) => (
            <MenuItem key={String(asc)} onClick={() => setSort((s) => ({ ...s, asc }))}>
              <Check size={15} className={cn('shrink-0 text-teal-600 dark:text-teal-400', sort.asc !== asc && 'invisible')} />
              {asc ? 'Ascending' : 'Descending'}
            </MenuItem>
          ))}
        </Menu>

        <div className="inline-flex h-9 rounded-lg border border-gray-300 bg-white p-0.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900" role="group" aria-label="View">
          {(['list', 'grid'] as ViewMode[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-label={v === 'list' ? 'List view' : 'Grid view'}
              aria-pressed={view === v}
              title={v === 'list' ? 'List view' : 'Grid view'}
              onClick={() => setView(v)}
              className={cn(
                'inline-flex w-8 items-center justify-center rounded-md transition-colors',
                focusRing,
                view === v
                  ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
                  : 'text-gray-500 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-100',
              )}
            >
              {v === 'list' ? <List size={16} /> : <LayoutGrid size={16} />}
            </button>
          ))}
        </div>

        <IconButton label="Refresh" onClick={() => void browse.refetch()} disabled={browse.isFetching}>
          <RefreshCw size={16} className={cn(browse.isFetching && 'animate-spin')} />
        </IconButton>

        <div className="hidden flex-1 sm:block" />

        {canUpload && (
          <>
            <Button variant="outline" onClick={() => setNewFolder(true)} aria-label="New folder" className="ml-auto w-9 px-0 sm:ml-0 sm:w-auto sm:px-3.5">
              <FolderPlus size={16} /> <span className="hidden sm:inline">New folder</span>
            </Button>
            <Menu
              width="w-48"
              buttonClassName={buttonClass('primary', 'md')}
              button={
                <>
                  <Upload size={16} /> Upload <ChevronDown size={14} className="-mr-0.5 opacity-80" />
                </>
              }
            >
              <MenuItem icon={Upload} onClick={() => fileInput.current?.click()}>
                Upload files
              </MenuItem>
              <MenuItem icon={FolderUp} onClick={() => dirInput.current?.click()}>
                Upload folder
              </MenuItem>
            </Menu>
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

      {isVirtual && <InfoBox>You can browse down to the folders shared with you.</InfoBox>}

      {browse.isLoading && <Loading />}
      {err && (
        <ErrorBox>
          {forbidden
            ? "You don't have access to this folder."
            : notFound
              ? 'Bucket not found.'
              : errMsg(err, 'Failed to list folder')}{' '}
          <Link to="/" className="font-medium underline">
            Back to Files
          </Link>
        </ErrorBox>
      )}

      {data && totalLoaded === 0 && (
        <EmptyState icon={FolderOpen} title="This folder is empty">
          {canUpload ? 'Drag files or folders here, or use the Upload button.' : 'Nothing has been added here yet.'}
        </EmptyState>
      )}

      {data && totalLoaded > 0 && noMatch && (
        <EmptyState icon={Search} title="No matches">
          No loaded items match "{filter}".
        </EmptyState>
      )}

      {data && totalLoaded > 0 && !noMatch && view === 'list' && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-card dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full table-fixed text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-xs font-medium text-gray-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
                {showSelect && (
                  <th className="w-11 py-2.5 pl-4">
                    <Checkbox ariaLabel="Select all" checked={allSelected} indeterminate={selectedKeys.length > 0} onChange={toggleAll} />
                  </th>
                )}
                <SortTh label="Name" k="name" sort={sort} onClick={setSortKey} />
                <SortTh label="Size" k="size" sort={sort} onClick={setSortKey} className="hidden w-28 text-right sm:table-cell" />
                <SortTh label="Modified" k="lastModified" sort={sort} onClick={setSortKey} className="hidden w-48 md:table-cell" />
                <th className="w-[5.5rem] px-3 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/70">
              {folders.map((f) => {
                const sel = f.perms.delete && !isVirtual
                const on = selected.has(f.prefix)
                return (
                  <tr
                    key={f.prefix}
                    onClick={() => openFolder(f)}
                    className={cn(
                      'group cursor-pointer transition-colors',
                      on ? 'bg-teal-50/70 dark:bg-teal-500/10' : 'hover:bg-gray-50 dark:hover:bg-zinc-800/40',
                    )}
                  >
                    {showSelect && (
                      <td className="py-2.5 pl-4">
                        {sel && <Checkbox ariaLabel={`Select ${f.name}`} checked={on} onChange={(v) => toggle(f.prefix, v)} />}
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <Link
                        to={browserLink(bucketId, f.prefix)}
                        onClick={(e) => e.stopPropagation()}
                        className={cn('flex min-w-0 items-center gap-3 rounded font-medium text-gray-900 dark:text-zinc-100', focusRing)}
                      >
                        <FolderGlyph />
                        <span className="truncate">{f.name}</span>
                      </Link>
                    </td>
                    <td className="hidden px-4 py-2.5 text-right text-xs text-gray-400 sm:table-cell dark:text-zinc-500">—</td>
                    <td className="hidden px-4 py-2.5 text-xs text-gray-400 md:table-cell dark:text-zinc-500">—</td>
                    <td className="px-3 py-2.5" />
                  </tr>
                )
              })}
              {objects.map((o) => {
                const pk = previewKind(o.name)
                const on = selected.has(o.key)
                return (
                  <tr
                    key={o.key}
                    onClick={() => openFile(o)}
                    className={cn(
                      'group transition-colors',
                      canRead && 'cursor-pointer',
                      on || preview?.key === o.key ? 'bg-teal-50/70 dark:bg-teal-500/10' : 'hover:bg-gray-50 dark:hover:bg-zinc-800/40',
                    )}
                  >
                    {showSelect && (
                      <td className="py-2.5 pl-4">
                        {canDeleteObjects && <Checkbox ariaLabel={`Select ${o.name}`} checked={on} onChange={(v) => toggle(o.key, v)} />}
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <button
                        className={cn('flex w-full min-w-0 items-center gap-3 rounded text-left text-gray-800 dark:text-zinc-200', focusRing)}
                        onClick={(e) => {
                          e.stopPropagation()
                          openFile(o)
                        }}
                        title={o.key}
                      >
                        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', fileStyle(o.name).bg)}>
                          <FileTypeIcon name={o.name} size={16} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate">{o.name}</span>
                          <span className="block truncate text-xs text-gray-500 sm:hidden dark:text-zinc-400">
                            {fmtSize(o.size)} · {fmtRelative(o.lastModified)}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-2.5 text-right text-xs tabular-nums text-gray-500 sm:table-cell dark:text-zinc-400">
                      {fmtSize(o.size)}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-2.5 text-xs text-gray-500 md:table-cell dark:text-zinc-400">{fmtDate(o.lastModified)}</td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      {canRead && (
                        <div className={cn('flex justify-end gap-0.5', hoverReveal)}>
                          {pk && (
                            <IconButton label="Preview" className="h-8 w-8" onClick={() => setPreview(o)}>
                              <Eye size={16} />
                            </IconButton>
                          )}
                          <a
                            className={cn(
                              'inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
                              focusRing,
                            )}
                            title="Download"
                            aria-label="Download"
                            href={downloadUrl(bucketId, o.key)}
                          >
                            <Download size={16} />
                          </a>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && totalLoaded > 0 && !noMatch && view === 'grid' && (
        <div className="space-y-6">
          {folders.length > 0 && (
            <GridSection
              title="Folders"
              right={
                showSelect && (
                  <Checkbox ariaLabel="Select all" checked={allSelected} indeterminate={selectedKeys.length > 0} onChange={toggleAll} label={<span className="text-xs">Select all</span>} />
                )
              }
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {folders.map((f) => (
                  <FolderTile
                    key={f.prefix}
                    folder={f}
                    to={browserLink(bucketId, f.prefix)}
                    selectable={f.perms.delete && !isVirtual}
                    selected={selected.has(f.prefix)}
                    onSelect={(v) => toggle(f.prefix, v)}
                  />
                ))}
              </div>
            </GridSection>
          )}
          {objects.length > 0 && (
            <GridSection
              title="Files"
              right={
                showSelect &&
                folders.length === 0 && (
                  <Checkbox ariaLabel="Select all" checked={allSelected} indeterminate={selectedKeys.length > 0} onChange={toggleAll} label={<span className="text-xs">Select all</span>} />
                )
              }
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {objects.map((o) => (
                  <FileCard
                    key={o.key}
                    obj={o}
                    bucketId={bucketId}
                    canRead={canRead}
                    selectable={canDeleteObjects}
                    selected={selected.has(o.key)}
                    active={preview?.key === o.key}
                    onSelect={(v) => toggle(o.key, v)}
                    onOpen={() => openFile(o)}
                  />
                ))}
              </div>
            </GridSection>
          )}
        </div>
      )}

      {data && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-zinc-400">
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

      {/* Floating selection bar */}
      {selectedKeys.length > 0 && (
        <div className="animate-slide-up fixed bottom-5 left-1/2 z-30 flex max-w-[calc(100vw-1.5rem)] items-center gap-1 rounded-2xl border border-gray-200 bg-white p-1.5 pl-3 shadow-pop dark:border-zinc-700 dark:bg-zinc-900">
          <span className="whitespace-nowrap px-1.5 text-sm font-medium text-gray-900 dark:text-zinc-100">{selectedKeys.length} selected</span>
          <span className="mx-1 h-6 w-px bg-gray-200 dark:bg-zinc-700" />
          {selectedFile && canRead && (
            <a href={downloadUrl(bucketId, selectedFile)} className={buttonClass('ghost', 'md', 'px-2.5 sm:px-3')} aria-label="Download">
              <Download size={16} /> <span className="hidden sm:inline">Download</span>
            </a>
          )}
          <Button variant="ghost" className="px-2.5 sm:px-3" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} /> Delete ({selectedKeys.length})
          </Button>
        </div>
      )}

      {dragging && (
        <div className="animate-fade pointer-events-none fixed inset-0 z-30 bg-teal-50/70 p-3 backdrop-blur-[2px] sm:p-5 dark:bg-teal-950/50">
          <div className="flex h-full w-full flex-col items-center justify-center rounded-3xl border-[3px] border-dashed border-teal-500 text-center dark:border-teal-400">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-600 text-white shadow-pop">
              <UploadCloud size={30} />
            </div>
            <div className="mt-4 text-lg font-semibold text-teal-900 dark:text-teal-100">Drop to upload to /{prefix}</div>
            <div className="mt-1 text-sm text-teal-700 dark:text-teal-300">{bucketLabel}</div>
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
          <div className="space-y-3">
            <p>
              Permanently delete {selectedKeys.length} item{selectedKeys.length === 1 ? '' : 's'}? This cannot be undone.
            </p>
            {selectedFolders.length > 0 && (
              <p className="font-medium text-rose-600 dark:text-rose-400">
                {selectedFolders.length} folder{selectedFolders.length === 1 ? '' : 's'} and <b>everything inside</b> will be deleted.
              </p>
            )}
            <ul className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2.5 font-mono text-xs text-gray-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400">
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

function FolderGlyph({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-500/10', size === 'md' ? 'h-8 w-8' : 'h-10 w-10')}>
      <Folder size={size === 'md' ? 17 : 20} className="fill-amber-300 text-amber-500 dark:fill-amber-400/30 dark:text-amber-400" />
    </span>
  )
}

function GridSection({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-gray-500 dark:text-zinc-400">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

function FolderTile({
  folder,
  to,
  selectable,
  selected,
  onSelect,
}: {
  folder: BrowseFolder
  to: string
  selectable: boolean
  selected: boolean
  onSelect: (v: boolean) => void
}) {
  return (
    <div
      className={cn(
        'group relative flex items-center rounded-xl border bg-white shadow-card transition dark:bg-zinc-900',
        selected
          ? 'border-teal-400 bg-teal-50/60 ring-1 ring-teal-400 dark:border-teal-500/60 dark:bg-teal-500/10 dark:ring-teal-500/60'
          : 'border-gray-200 hover:border-gray-300 hover:shadow-pop dark:border-zinc-800 dark:hover:border-zinc-700',
      )}
    >
      <Link to={to} className={cn('flex min-w-0 flex-1 items-center gap-3 rounded-xl p-3', focusRing)} title={folder.name}>
        <FolderGlyph />
        <span className="truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{folder.name}</span>
      </Link>
      {selectable && (
        <Checkbox
          ariaLabel={`Select ${folder.name}`}
          checked={selected}
          onChange={onSelect}
          className={cn('shrink-0 pr-3', !selected && hoverReveal)}
        />
      )}
    </div>
  )
}

function FileCard({
  obj,
  bucketId,
  canRead,
  selectable,
  selected,
  active,
  onSelect,
  onOpen,
}: {
  obj: BrowseObject
  bucketId: string
  canRead: boolean
  selectable: boolean
  selected: boolean
  active: boolean
  onSelect: (v: boolean) => void
  onOpen: () => void
}) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const style = fileStyle(obj.name)
  const Icon = style.icon
  const thumb = canRead && !thumbFailed && fileKind(obj.name) === 'image' && obj.size <= THUMB_MAX
  return (
    <div
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border bg-white shadow-card transition dark:bg-zinc-900',
        selected || active
          ? 'border-teal-400 ring-1 ring-teal-400 dark:border-teal-500/60 dark:ring-teal-500/60'
          : 'border-gray-200 hover:border-gray-300 hover:shadow-pop dark:border-zinc-800 dark:hover:border-zinc-700',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={!canRead}
        title={obj.key}
        className={cn('flex flex-1 flex-col text-left disabled:cursor-default', focusRing, 'focus-visible:ring-inset focus-visible:ring-offset-0')}
      >
        <div className={cn('relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden', style.bg)}>
          {thumb ? (
            <img
              src={downloadUrl(bucketId, obj.key, true)}
              alt=""
              loading="lazy"
              onError={() => setThumbFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <Icon size={44} strokeWidth={1.4} className={style.fg} />
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2 border-t border-gray-100 px-3 py-2.5 dark:border-zinc-800">
          <FileTypeIcon name={obj.name} size={15} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{obj.name}</div>
            <div className="truncate text-[11px] text-gray-500 dark:text-zinc-400">
              {fmtSize(obj.size)} · {fmtDate(obj.lastModified)}
            </div>
          </div>
        </div>
      </button>
      {selectable && (
        <div
          className={cn(
            'absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900/90 dark:ring-white/10',
            !selected && hoverReveal,
          )}
        >
          <Checkbox ariaLabel={`Select ${obj.name}`} checked={selected} onChange={onSelect} />
        </div>
      )}
      {canRead && (
        <a
          href={downloadUrl(bucketId, obj.key)}
          title="Download"
          aria-label={`Download ${obj.name}`}
          className={cn(
            'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-gray-600 shadow-sm ring-1 ring-black/5 hover:text-gray-900 dark:bg-zinc-900/90 dark:text-zinc-300 dark:ring-white/10 dark:hover:text-white',
            focusRing,
            hoverReveal,
          )}
        >
          <Download size={14} />
        </a>
      )}
    </div>
  )
}

function SortTh({ label, k, sort, onClick, className }: { label: string; k: SortKey; sort: Sort; onClick: (k: SortKey) => void; className?: string }) {
  const active = sort.key === k
  return (
    <th className={cn('px-4 py-2.5', className)} aria-sort={active ? (sort.asc ? 'ascending' : 'descending') : undefined}>
      <button
        className={cn('inline-flex items-center gap-1 rounded hover:text-gray-900 dark:hover:text-zinc-100', focusRing, active && 'text-gray-900 dark:text-zinc-100')}
        onClick={() => onClick(k)}
      >
        {label}
        {active && <ChevronDown size={13} className={cn('transition-transform', sort.asc && 'rotate-180')} />}
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
            {create.isPending ? <Spinner className="border-white/30 border-t-white dark:border-white/30 dark:border-t-white" /> : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
