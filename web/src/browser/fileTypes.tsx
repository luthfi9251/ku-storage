import { File, FileArchive, FileCode, FileImage, FileMusic, FileText, FileVideo } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '../ui'

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'archive' | 'code' | 'text' | 'other'

const KIND: Record<string, FileKind> = {}
const add = (k: FileKind, exts: string) => exts.split(' ').forEach((e) => (KIND[e] = k))
add('image', 'png jpg jpeg gif webp avif svg bmp ico tif tiff heic')
add('video', 'mp4 webm mov m4v ogv mkv avi')
add('audio', 'mp3 wav ogg oga m4a aac flac opus')
add('pdf', 'pdf')
add('archive', 'zip tar gz tgz bz2 xz 7z rar zst')
add('code', 'js mjs ts tsx jsx css scss html go py rb rs java kt c h cpp hpp cs php sh sql json jsonl ndjson xml yaml yml toml')
add('text', 'txt md markdown log csv tsv ini conf cfg env doc docx rtf odt xls xlsx ods ppt pptx')

export function fileKind(name: string): FileKind {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return 'other'
  return KIND[name.slice(dot + 1).toLowerCase()] ?? 'other'
}

type Style = { icon: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>; fg: string; bg: string }

const STYLE: Record<FileKind, Style> = {
  image: { icon: FileImage, fg: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-500/10' },
  video: { icon: FileVideo, fg: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-500/10' },
  audio: { icon: FileMusic, fg: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-500/10' },
  pdf: { icon: FileText, fg: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10' },
  archive: { icon: FileArchive, fg: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10' },
  code: { icon: FileCode, fg: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-50 dark:bg-sky-500/10' },
  text: { icon: FileText, fg: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10' },
  other: { icon: File, fg: 'text-gray-500 dark:text-zinc-400', bg: 'bg-gray-100 dark:bg-zinc-800' },
}

export function fileStyle(name: string): Style {
  return STYLE[fileKind(name)]
}

export function FileTypeIcon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const s = fileStyle(name)
  const Icon = s.icon
  return <Icon size={size} className={cn('shrink-0', s.fg, className)} />
}
