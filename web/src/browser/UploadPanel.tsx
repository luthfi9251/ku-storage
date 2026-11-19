import { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, CircleSlash, RotateCcw, TriangleAlert, Upload, X } from 'lucide-react'
import { fmtSize } from '../lib/format'
import { Button, Spinner, cn } from '../ui'
import { useUploads } from './uploads'
import type { UploadItem } from './uploads'

export default function UploadPanel() {
  const up = useUploads()
  const [collapsed, setCollapsed] = useState(false)
  const { items } = up
  if (items.length === 0) return null

  const done = items.filter((x) => x.status === 'done').length
  const active = items.filter((x) => x.status === 'uploading' || x.status === 'queued').length
  const failed = items.filter((x) => x.status === 'error' || x.status === 'canceled')
  const retryable = failed.filter((x) => !x.invalid).length
  const conflicts = items.filter((x) => x.status === 'conflict')
  const conflictsUpd = conflicts.filter((x) => x.canUpdate)
  const conflictsNoUpd = conflicts.filter((x) => !x.canUpdate)

  const totalBytes = items.filter((x) => x.status !== 'skipped' && !x.invalid).reduce((a, x) => a + x.file.size, 0)
  const loadedBytes = items.reduce((a, x) => a + (x.status === 'done' ? x.file.size : x.status === 'uploading' ? x.loaded : 0), 0)
  const pct = totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 100

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[26rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/95 shadow-2xl shadow-black/60 backdrop-blur-xl">
      <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
          {active > 0 ? <Spinner /> : <Upload size={16} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-100">
            {active > 0 ? `Uploading ${active} file${active > 1 ? 's' : ''}` : 'Uploads'}
          </div>
          <div className="text-[11px] text-slate-400">
            {done}/{items.length} done
            {failed.length > 0 && <span className="text-rose-400"> · {failed.length} failed</span>}
            {conflicts.length > 0 && <span className="text-amber-400"> · {conflicts.length} need a decision</span>}
          </div>
        </div>
        <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200" onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {active === 0 && (
          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200" onClick={up.clearAll} title="Close">
            <X size={16} />
          </button>
        )}
      </div>
      <div className="h-1 bg-slate-800">
        <div className="h-1 bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
      </div>

      {!collapsed && (
        <>
          {conflictsUpd.length > 1 && (
            <BulkBar
              text={`${conflictsUpd.length} files already exist.`}
              actions={[
                { label: 'Overwrite all', onClick: () => up.resolve(conflictsUpd[0].id, 'overwrite', true) },
                { label: 'Skip all', onClick: () => up.resolve(conflictsUpd[0].id, 'skip', true) },
              ]}
            />
          )}
          {conflictsNoUpd.length > 1 && (
            <BulkBar
              text={`${conflictsNoUpd.length} files already exist (you can't overwrite).`}
              actions={[
                { label: 'Rename all', onClick: () => up.resolve(conflictsNoUpd[0].id, 'rename', true) },
                { label: 'Skip all', onClick: () => up.resolve(conflictsNoUpd[0].id, 'skip', true) },
              ]}
            />
          )}
          <ul className="max-h-80 divide-y divide-slate-800/70 overflow-y-auto">
            {items.map((it) => (
              <Row key={it.id} it={it} />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-800 px-4 py-2.5">
            {retryable > 0 && (
              <Button size="sm" variant="outline" onClick={up.retryFailed}>
                <RotateCcw size={12} /> Retry failed
              </Button>
            )}
            {active > 0 && (
              <Button size="sm" variant="outline" onClick={up.cancelAll}>
                Cancel all
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={up.clearFinished}>
              Clear finished
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function BulkBar({ text, actions }: { text: string; actions: { label: string; onClick: () => void }[] }) {
  return (
    <div className="flex items-center gap-2 border-b border-amber-900/50 bg-amber-950/30 px-4 py-2 text-xs text-amber-300">
      <TriangleAlert size={14} className="shrink-0" />
      <span className="flex-1">{text}</span>
      {actions.map((a) => (
        <Button key={a.label} size="sm" variant="outline" onClick={a.onClick}>
          {a.label}
        </Button>
      ))}
    </div>
  )
}

function Row({ it }: { it: UploadItem }) {
  const up = useUploads()
  const [all, setAll] = useState(false)
  const pct = it.file.size > 0 ? Math.round((it.loaded / it.file.size) * 100) : it.status === 'done' ? 100 : 0
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-2">
        <StatusIcon it={it} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-slate-200" title={it.key}>
            {it.key}
          </div>
          <div className="truncate text-[11px] text-slate-500">
            {it.bucketLabel} · {fmtSize(it.file.size)}
            {it.status === 'uploading' && ` · ${pct}%`}
            {it.status === 'skipped' && ' · skipped'}
            {it.status === 'canceled' && ' · canceled'}
            {it.mode === 'overwrite' && it.status === 'done' && ' · overwritten'}
          </div>
        </div>
        {(it.status === 'uploading' || it.status === 'queued' || it.status === 'conflict') && (
          <button className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-400" title="Cancel" onClick={() => up.cancel(it.id)}>
            <X size={14} />
          </button>
        )}
        {!it.invalid && (it.status === 'error' || it.status === 'canceled') && (
          <button className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-indigo-300" title="Retry" onClick={() => up.retry(it.id)}>
            <RotateCcw size={14} />
          </button>
        )}
      </div>
      {it.status === 'uploading' && (
        <div className="mt-1.5 h-1 rounded-full bg-slate-800">
          <div className="h-1 rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      {it.status === 'error' && it.error && <div className="mt-1 text-[11px] text-rose-400">{it.error}</div>}
      {it.status === 'conflict' && (
        <div className="mt-2 space-y-2 rounded-lg border border-amber-900/50 bg-amber-950/30 p-2 text-[11px] text-amber-300">
          <div>
            {it.canUpdate
              ? `"${it.name}" already exists. Overwrite?`
              : `"${it.name}" already exists and you don't have permission to overwrite it.`}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {it.canUpdate ? (
              <Button size="sm" variant="primary" onClick={() => up.resolve(it.id, 'overwrite', all)}>
                Overwrite
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => up.resolve(it.id, 'rename', all)}>
                Keep both (rename)
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => up.resolve(it.id, 'skip', all)}>
              Skip
            </Button>
            <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-slate-300">
              <input type="checkbox" className="accent-indigo-500" checked={all} onChange={(e) => setAll(e.target.checked)} />
              Apply to all
            </label>
          </div>
        </div>
      )}
    </li>
  )
}

function StatusIcon({ it }: { it: UploadItem }) {
  const cls = 'shrink-0'
  switch (it.status) {
    case 'done':
      return <CheckCircle2 size={16} className={cn(cls, 'text-emerald-400')} />
    case 'uploading':
      return <Spinner className={cn(cls, 'h-3.5 w-3.5')} />
    case 'error':
      return <TriangleAlert size={16} className={cn(cls, 'text-rose-400')} />
    case 'conflict':
      return <TriangleAlert size={16} className={cn(cls, 'text-amber-400')} />
    case 'canceled':
    case 'skipped':
      return <CircleSlash size={16} className={cn(cls, 'text-slate-500')} />
    default:
      return <Upload size={16} className={cn(cls, 'text-slate-500')} />
  }
}
