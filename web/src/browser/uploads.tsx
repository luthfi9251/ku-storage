import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { notifyUnauthenticated, parseErrorBody } from '../lib/api'
import { renamed, validateKey, validateRelPath } from '../lib/keys'
import type { PickedFile } from './collect'

const CONCURRENCY = 3
const MAX_RENAME = 1000

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'conflict' | 'canceled' | 'skipped'

export interface UploadItem {
  id: string
  bucketId: string
  bucketLabel: string
  /** Key directory (current prefix + relative dirs), ends with '/' or is ''. */
  dir: string
  /** Original file name. */
  name: string
  /** Key currently being uploaded (may be a renamed variant). */
  key: string
  file: File
  status: UploadStatus
  loaded: number
  error: string
  /** Validation failure; cannot be retried. */
  invalid: boolean
  /** 'overwrite' sends overwrite=1; 'rename' auto-increments on 409. */
  mode: 'normal' | 'overwrite' | 'rename'
  renameN: number
  canUpdate: boolean
}

export type ConflictAction = 'overwrite' | 'rename' | 'skip'

interface UploadApi {
  items: UploadItem[]
  enqueue: (opts: { bucketId: string; bucketLabel: string; prefix: string; canUpdate: boolean; files: PickedFile[] }) => number
  cancel: (id: string) => void
  cancelAll: () => void
  retry: (id: string) => void
  retryFailed: () => void
  resolve: (id: string, action: ConflictAction, applyToAll: boolean) => void
  clearFinished: () => void
  clearAll: () => void
}

const Ctx = createContext<UploadApi | null>(null)

export function useUploads(): UploadApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useUploads outside provider')
  return v
}

let seq = 0

/** Applies a conflict action to an item; returns the new item. */
function applyAction(x: UploadItem, action: ConflictAction): UploadItem {
  if (action === 'skip') return { ...x, status: 'skipped', error: '' }
  if (action === 'overwrite' && x.canUpdate)
    return { ...x, status: 'queued', mode: 'overwrite', key: x.dir + x.name, loaded: 0, error: '' }
  const n = x.renameN + 1
  return { ...x, status: 'queued', mode: 'rename', renameN: n, key: x.dir + renamed(x.name, n), loaded: 0, error: '' }
}


export function UploadProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [items, setItems] = useState<UploadItem[]>([])
  const xhrs = useRef(new Map<string, XMLHttpRequest>())
  const dirty = useRef(new Set<string>())
  // "Apply to all" choices for future conflicts, split by whether the user may overwrite.
  const policy = useRef<{ updatable: ConflictAction | null; createOnly: ConflictAction | null }>({
    updatable: null,
    createOnly: null,
  })

  const patch = useCallback((id: string, p: Partial<UploadItem>) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)))
  }, [])

  const onConflict = useCallback((id: string) => {
    setItems((xs) =>
      xs.map((x) => {
        if (x.id !== id) return x
        if (x.mode === 'rename') {
          if (x.renameN >= MAX_RENAME) return { ...x, status: 'error', error: 'Could not find a free name' }
          return applyAction(x, 'rename')
        }
        const pol = x.canUpdate ? policy.current.updatable : policy.current.createOnly
        if (pol) return applyAction(x, pol)
        return { ...x, status: 'conflict', error: 'An object with this name already exists' }
      }),
    )
  }, [])

  const start = useCallback(
    (it: UploadItem) => {
      if (xhrs.current.has(it.id)) return
      const xhr = new XMLHttpRequest()
      xhrs.current.set(it.id, xhr)
      const p = new URLSearchParams({ bucket: it.bucketId, key: it.key, overwrite: it.mode === 'overwrite' ? '1' : '0' })
      xhr.open('PUT', `/api/objects?${p.toString()}`)
      xhr.setRequestHeader('Content-Type', it.file.type || 'application/octet-stream')
      xhr.upload.onprogress = (e) => patch(it.id, { loaded: e.loaded })
      xhr.onload = () => {
        xhrs.current.delete(it.id)
        if (xhr.status >= 200 && xhr.status < 300) {
          dirty.current.add(it.bucketId)
          patch(it.id, { status: 'done', loaded: it.file.size, error: '' })
          return
        }
        const err = parseErrorBody(xhr.status, xhr.statusText, xhr.responseText)
        if (xhr.status === 409 && err.code === 'OBJECT_EXISTS') {
          onConflict(it.id)
          return
        }
        if (xhr.status === 401 && err.code === 'UNAUTHENTICATED') notifyUnauthenticated()
        patch(it.id, { status: 'error', error: err.message })
      }
      xhr.onerror = () => {
        xhrs.current.delete(it.id)
        patch(it.id, { status: 'error', error: 'Network error' })
      }
      xhr.onabort = () => {
        xhrs.current.delete(it.id)
        patch(it.id, { status: 'canceled', error: '' })
      }
      xhr.send(it.file)
    },
    [patch, onConflict],
  )

  // Scheduler: keep up to CONCURRENCY uploads running.
  useEffect(() => {
    const running = items.filter((x) => x.status === 'uploading').length
    const free = CONCURRENCY - running
    if (free > 0) {
      const next = items.filter((x) => x.status === 'queued').slice(0, free)
      if (next.length > 0) {
        const ids = new Set(next.map((x) => x.id))
        setItems((xs) => xs.map((x) => (ids.has(x.id) ? { ...x, status: 'uploading', loaded: 0 } : x)))
        next.forEach((x) => start(x))
        return
      }
    }
    // Idle: refresh listings of buckets that changed (once, not per file).
    if (running === 0 && dirty.current.size > 0 && !items.some((x) => x.status === 'queued')) {
      for (const b of dirty.current) void qc.invalidateQueries({ queryKey: ['browse', b] })
      dirty.current.clear()
    }
  }, [items, start, qc])

  const enqueue: UploadApi['enqueue'] = useCallback(({ bucketId, bucketLabel, prefix, canUpdate, files }) => {
    let invalid = 0
    const add: UploadItem[] = files.map(({ file, relPath }) => {
      const cleanRel = relPath.replace(/^\/+/, '')
      const i = cleanRel.lastIndexOf('/')
      const dir = prefix + (i >= 0 ? cleanRel.slice(0, i + 1) : '')
      const name = i >= 0 ? cleanRel.slice(i + 1) : cleanRel
      const key = dir + name
      const err = validateRelPath(cleanRel) || validateKey(key)
      if (err) invalid++
      return {
        id: `u${++seq}`,
        bucketId,
        bucketLabel,
        dir,
        name,
        key,
        file,
        status: err ? 'error' : 'queued',
        loaded: 0,
        error: err,
        invalid: !!err,
        mode: 'normal',
        renameN: 0,
        canUpdate,
      }
    })
    setItems((xs) => [...xs, ...add])
    return invalid
  }, [])

  const cancel = useCallback((id: string) => {
    const xhr = xhrs.current.get(id)
    if (xhr) xhr.abort()
    else
      setItems((xs) =>
        xs.map((x) => (x.id === id && (x.status === 'queued' || x.status === 'conflict') ? { ...x, status: 'canceled' } : x)),
      )
  }, [])

  const cancelAll = useCallback(() => {
    setItems((xs) => xs.map((x) => (x.status === 'queued' || x.status === 'conflict' ? { ...x, status: 'canceled' } : x)))
    for (const xhr of xhrs.current.values()) xhr.abort()
  }, [])

  const retry = useCallback((id: string) => {
    setItems((xs) =>
      xs.map((x) =>
        x.id === id && !x.invalid && (x.status === 'error' || x.status === 'canceled')
          ? { ...x, status: 'queued', loaded: 0, error: '' }
          : x,
      ),
    )
  }, [])

  const retryFailed = useCallback(() => {
    setItems((xs) =>
      xs.map((x) =>
        !x.invalid && (x.status === 'error' || x.status === 'canceled') ? { ...x, status: 'queued', loaded: 0, error: '' } : x,
      ),
    )
  }, [])

  const resolve = useCallback((id: string, action: ConflictAction, applyToAll: boolean) => {
    setItems((xs) => {
      const target = xs.find((x) => x.id === id)
      if (!target) return xs
      if (!applyToAll) return xs.map((x) => (x.id === id ? applyAction(x, action) : x))
      const cls = target.canUpdate
      if (cls) policy.current.updatable = action
      else policy.current.createOnly = action
      return xs.map((x) => (x.status === 'conflict' && x.canUpdate === cls ? applyAction(x, action) : x))
    })
  }, [])

  const clearFinished = useCallback(() => {
    setItems((xs) => xs.filter((x) => x.status === 'queued' || x.status === 'uploading' || x.status === 'conflict' || x.status === 'error'))
  }, [])

  const clearAll = useCallback(() => {
    for (const xhr of xhrs.current.values()) xhr.abort()
    setItems([])
    policy.current = { updatable: null, createOnly: null }
  }, [])

  // Reset "apply to all" choices once the queue is empty.
  useEffect(() => {
    if (items.length === 0) policy.current = { updatable: null, createOnly: null }
  }, [items.length])

  // Warn before leaving the page while uploads are in flight.
  const busy = items.some((x) => x.status === 'uploading' || x.status === 'queued')
  useEffect(() => {
    if (!busy) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [busy])

  const value = useMemo(
    () => ({ items, enqueue, cancel, cancelAll, retry, retryFailed, resolve, clearFinished, clearAll }),
    [items, enqueue, cancel, cancelAll, retry, retryFailed, resolve, clearFinished, clearAll],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
