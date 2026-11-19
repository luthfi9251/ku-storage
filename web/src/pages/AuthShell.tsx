import type { FormEvent, ReactNode } from 'react'
import { FolderTree, ShieldCheck, UploadCloud } from 'lucide-react'
import { Logo } from '../ui'

const benefits = [
  { icon: FolderTree, text: 'Grant access per folder, not per bucket' },
  { icon: ShieldCheck, text: 'Your R2 keys never leave the server' },
  { icon: UploadCloud, text: 'Browse, preview and upload from any browser' },
]

export default function AuthShell({
  title,
  subtitle,
  onSubmit,
  children,
}: {
  title?: string
  subtitle: string
  onSubmit: (e: FormEvent) => void
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen bg-canvas dark:bg-zinc-950 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-teal-600 via-teal-700 to-emerald-800 p-12 text-white lg:flex lg:flex-col">
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07]" aria-hidden>
          <defs>
            <pattern id="auth-grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M32 0H0V32" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#auth-grid)" />
        </svg>
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-white/10" aria-hidden />
        <Logo inverted className="relative" />
        <div className="relative my-auto max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Share your R2 buckets safely — folder by folder.</h2>
          <ul className="mt-10 space-y-5">
            {benefits.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3.5 text-[15px] text-teal-50">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-inset ring-white/20">
                  <Icon size={18} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-teal-100/70">Cloudflare R2 &amp; S3-compatible storage</p>
      </aside>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
            <p className="mt-3 text-sm text-gray-500 dark:text-zinc-400">Share your R2 buckets safely — folder by folder.</p>
          </div>
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-zinc-50">{title ?? 'Welcome back'}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">{subtitle}</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-5">
            {children}
          </form>
        </div>
      </main>
    </div>
  )
}
