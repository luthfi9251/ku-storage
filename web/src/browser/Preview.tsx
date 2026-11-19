import { useQuery } from '@tanstack/react-query'
import { Download, FileQuestion } from 'lucide-react'
import { api, downloadUrl, errMsg, qs } from '../lib/api'
import { fmtDate, fmtSize } from '../lib/format'
import { previewKind } from '../lib/keys'
import type { PreviewKind } from '../lib/keys'
import type { BrowseObject, ObjectStat } from '../lib/types'
import { Drawer, ErrorBox, Spinner } from '../ui'

function kindFromType(ct: string): PreviewKind {
  if (ct.startsWith('image/')) return 'image'
  if (ct.startsWith('video/')) return 'video'
  if (ct.startsWith('audio/')) return 'audio'
  if (ct === 'application/pdf') return 'pdf'
  if (ct.startsWith('text/') || ct === 'application/json' || ct === 'application/xml') return 'text'
  return null
}

export default function Preview({ bucketId, obj, onClose }: { bucketId: string; obj: BrowseObject | null; onClose: () => void }) {
  const stat = useQuery({
    queryKey: ['stat', bucketId, obj?.key],
    queryFn: () => api.get<ObjectStat>(`/api/objects/stat${qs({ bucket: bucketId, key: obj!.key })}`),
    enabled: !!obj,
  })

  if (!obj) return null
  const kind = previewKind(obj.name) ?? (stat.data ? kindFromType(stat.data.contentType) : null)
  const src = downloadUrl(bucketId, obj.key, true)

  return (
    <Drawer open onClose={onClose} title={obj.name} subtitle={<span className="font-mono">{obj.key}</span>} width="max-w-2xl">
      <div className="space-y-5">
        <div className="flex min-h-[12rem] items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950/70">
          {kind === 'image' && <img src={src} alt={obj.name} className="max-h-[60vh] max-w-full object-contain" />}
          {kind === 'video' && <video src={src} controls className="max-h-[60vh] w-full" />}
          {kind === 'audio' && <audio src={src} controls className="m-6 w-full" />}
          {kind === 'pdf' && <iframe src={src} title={obj.name} className="h-[65vh] w-full bg-white" />}
          {kind === 'text' && <iframe src={src} title={obj.name} sandbox="" className="h-[65vh] w-full bg-white" />}
          {kind === null && (
            stat.isLoading ? (
              <Spinner />
            ) : (
              <div className="flex flex-col items-center gap-2 p-8 text-sm text-slate-500">
                <FileQuestion size={32} />
                No preview available for this file type.
              </div>
            )
          )}
        </div>

        <a
          href={downloadUrl(bucketId, obj.key)}
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500"
        >
          <Download size={16} /> Download
        </a>

        <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="text-slate-500">Size</dt>
          <dd className="text-slate-200">
            {fmtSize(obj.size)} <span className="text-slate-500">({obj.size.toLocaleString()} bytes)</span>
          </dd>
          <dt className="text-slate-500">Last modified</dt>
          <dd className="text-slate-200">{fmtDate(obj.lastModified)}</dd>
          <dt className="text-slate-500">ETag</dt>
          <dd className="break-all font-mono text-slate-300">{obj.etag}</dd>
          {stat.data && (
            <>
              <dt className="text-slate-500">Content type</dt>
              <dd className="font-mono text-slate-300">{stat.data.contentType || '—'}</dd>
              {Object.entries(stat.data.metadata ?? {}).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="truncate text-slate-500" title={k}>
                    {k}
                  </dt>
                  <dd className="break-all font-mono text-slate-300">{v}</dd>
                </div>
              ))}
            </>
          )}
        </dl>
        {stat.isError && <ErrorBox>{errMsg(stat.error)}</ErrorBox>}
      </div>
    </Drawer>
  )
}
