import type { Perms } from './types'

// Client-side mirror of the server's key validation (spec: "Validasi key").

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

/** Validates a single path segment (file or folder name). Returns an error message or ''. */
export function validateName(name: string): string {
  if (name === '') return 'Name is empty'
  if (name === '.' || name === '..') return 'Name cannot be "." or ".."'
  if (name.includes('/')) return 'Name cannot contain "/"'
  if (name.includes('\\')) return 'Name cannot contain "\\"'
  if (CONTROL.test(name)) return 'Name cannot contain control characters'
  return ''
}

/** Validates a relative path (e.g. "dir/sub/file.txt") made of segments. */
export function validateRelPath(rel: string): string {
  if (rel === '') return 'Empty path'
  for (const seg of rel.split('/')) {
    const e = validateName(seg)
    if (e) return `${e} (${rel})`
  }
  return ''
}

export function validateKey(key: string): string {
  if (new TextEncoder().encode(key).length > 1024) return 'Key is longer than 1024 bytes'
  return ''
}

/** "a/b/c/" -> ["a/", "a/b/", "a/b/c/"] with labels. */
export function crumbs(prefix: string): { label: string; prefix: string }[] {
  const out: { label: string; prefix: string }[] = []
  let acc = ''
  for (const seg of prefix.split('/')) {
    if (!seg) continue
    acc += seg + '/'
    out.push({ label: seg, prefix: acc })
  }
  return out
}

/** "report.pdf" + 2 -> "report (2).pdf"; ".env" + 1 -> ".env (1)". */
export function renamed(name: string, n: number): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return `${name} (${n})`
  return `${name.slice(0, dot)} (${n})${name.slice(dot)}`
}

export function splitKey(key: string): { dir: string; name: string } {
  const i = key.lastIndexOf('/')
  return i < 0 ? { dir: '', name: key } : { dir: key.slice(0, i + 1), name: key.slice(i + 1) }
}

export const NO_PERMS: Perms = { read: false, create: false, update: false, delete: false }
export const ALL_PERMS: Perms = { read: true, create: true, update: true, delete: true }

export const PRESETS: { label: string; perms: Perms }[] = [
  { label: 'Viewer', perms: { read: true, create: false, update: false, delete: false } },
  { label: 'Contributor', perms: { read: true, create: true, update: false, delete: false } },
  { label: 'Editor', perms: { read: true, create: true, update: true, delete: false } },
  { label: 'Manager', perms: { read: true, create: true, update: true, delete: true } },
]

export function samePerms(a: Perms, b: Perms): boolean {
  return a.read === b.read && a.create === b.create && a.update === b.update && a.delete === b.delete
}

export function presetName(p: Perms): string {
  return PRESETS.find((x) => samePerms(x.perms, p))?.label ?? 'Custom'
}

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | null

const EXT: Record<string, PreviewKind> = {}
for (const e of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico']) EXT[e] = 'image'
for (const e of ['mp4', 'webm', 'mov', 'm4v', 'ogv']) EXT[e] = 'video'
for (const e of ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus']) EXT[e] = 'audio'
EXT.pdf = 'pdf'
for (const e of [
  'txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xml', 'yaml', 'yml', 'toml', 'ini',
  'conf', 'cfg', 'env', 'sql', 'sh', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'css', 'go', 'py', 'rb', 'rs', 'java',
  'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php',
]) EXT[e] = 'text'

export function previewKind(name: string): PreviewKind {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  return EXT[name.slice(dot + 1).toLowerCase()] ?? null
}
