export function fmtSize(bytes: number): string {
  if (bytes < 0 || !Number.isFinite(bytes)) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return u === 0 ? `${v} B` : `${v.toFixed(1)} ${units[u]}`
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = (Date.now() - t) / 1000
  const abs = Math.abs(diff)
  const suffix = diff >= 0 ? 'ago' : 'from now'
  if (abs < 60) return diff >= 0 ? 'just now' : 'in a moment'
  if (abs < 3600) return `${Math.round(abs / 60)}m ${suffix}`
  if (abs < 86400) return `${Math.round(abs / 3600)}h ${suffix}`
  if (abs < 86400 * 30) return `${Math.round(abs / 86400)}d ${suffix}`
  return fmtDate(iso)
}
