import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { api, qs } from '../lib/api'
import type { BrowseFolder, BrowseObject, BrowseResult } from '../lib/types'

/** Paged listing of one prefix. Pages are only fetched on demand ("Load more"); never polled. */
export function useBrowse(bucketId: string, prefix: string, enabled = true) {
  const q = useInfiniteQuery({
    queryKey: ['browse', bucketId, prefix],
    queryFn: ({ pageParam }) => api.get<BrowseResult>(`/api/browse${qs({ bucket: bucketId, prefix, cursor: pageParam })}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabled && !!bucketId,
  })

  const merged = useMemo(() => {
    const pages = q.data?.pages ?? []
    if (pages.length === 0) return null
    const first = pages[0]
    const folders: BrowseFolder[] = []
    const objects: BrowseObject[] = []
    const seenF = new Set<string>()
    const seenO = new Set<string>()
    for (const p of pages) {
      for (const f of p.folders) if (!seenF.has(f.prefix)) (seenF.add(f.prefix), folders.push(f))
      for (const o of p.objects) if (!seenO.has(o.key)) (seenO.add(o.key), objects.push(o))
    }
    return { bucket: first.bucket, prefix: first.prefix, virtual: first.virtual, perms: first.perms, folders, objects }
  }, [q.data])

  return { ...q, merged }
}
