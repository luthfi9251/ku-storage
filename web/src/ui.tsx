import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export type ButtonVariant = 'primary' | 'outline' | 'danger' | 'ghost' | 'secondary' | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-500 active:bg-indigo-700 shadow-lg shadow-indigo-600/20 border border-indigo-500/30',
    secondary: 'bg-slate-800 text-slate-100 hover:bg-slate-700 active:bg-slate-850 border border-slate-700',
    outline: 'border border-slate-700 bg-slate-900/60 text-slate-200 hover:bg-slate-800 hover:text-white hover:border-slate-600',
    ghost: 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
    danger: 'bg-rose-600/90 text-white hover:bg-rose-500 active:bg-rose-700 shadow-lg shadow-rose-600/20 border border-rose-500/30',
    success: 'bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700 shadow-lg shadow-emerald-600/20 border border-emerald-500/30',
  }

  const sizes: Record<ButtonSize, string> = {
    sm: 'px-2.5 py-1 text-xs gap-1.5 font-medium rounded-md',
    md: 'px-3.5 py-1.5 text-sm gap-2 font-medium rounded-lg',
    lg: 'px-4 py-2 text-base gap-2.5 font-medium rounded-lg',
  }

  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 select-none focus:outline-none focus:ring-2 focus:ring-indigo-500/40',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-lg border border-slate-700/80 bg-slate-900/90 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition-all duration-150 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50',
        className,
      )}
    />
  )
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'w-full rounded-lg border border-slate-700/80 bg-slate-900 px-3 py-2 text-sm text-slate-100 transition-all duration-150 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50',
        className,
      )}
    />
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">{label}</span>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      {children}
    </label>
  )
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  wide?: boolean
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 transition-opacity"
      onClick={onClose}
    >
      <div
        className={cn(
          'animate-fade-in relative max-h-[90vh] w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/95 p-6 text-slate-100 shadow-2xl shadow-black/80 flex flex-col',
          wide ? 'max-w-2xl' : 'max-w-lg',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-100">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto pr-1">{children}</div>
      </div>
    </div>
  )
}

export type BadgeTone = 'green' | 'red' | 'amber' | 'blue' | 'slate' | 'violet' | 'indigo'

export function Badge({
  tone,
  children,
  pulse = false,
  className,
}: {
  tone: BadgeTone
  children: ReactNode
  pulse?: boolean
  className?: string
}) {
  const tones: Record<BadgeTone, { bg: string; text: string; border: string; dot: string }> = {
    green: { bg: 'bg-emerald-950/60', text: 'text-emerald-400', border: 'border-emerald-800/50', dot: 'bg-emerald-400' },
    red: { bg: 'bg-rose-950/60', text: 'text-rose-400', border: 'border-rose-800/50', dot: 'bg-rose-400' },
    amber: { bg: 'bg-amber-950/60', text: 'text-amber-400', border: 'border-amber-800/50', dot: 'bg-amber-400' },
    blue: { bg: 'bg-sky-950/60', text: 'text-sky-400', border: 'border-sky-800/50', dot: 'bg-sky-400' },
    indigo: { bg: 'bg-indigo-950/60', text: 'text-indigo-400', border: 'border-indigo-800/50', dot: 'bg-indigo-400' },
    slate: { bg: 'bg-slate-800/80', text: 'text-slate-300', border: 'border-slate-700/60', dot: 'bg-slate-400' },
    violet: { bg: 'bg-violet-950/60', text: 'text-violet-400', border: 'border-violet-800/50', dot: 'bg-violet-400' },
  }

  const t = tones[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase',
        t.bg,
        t.text,
        t.border,
        className,
      )}
    >
      {pulse && <span className={cn('h-1.5 w-1.5 rounded-full animate-pulse-dot', t.dot)} />}
      {children}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-indigo-400/30 border-t-indigo-400',
        className,
      )}
    />
  )
}


// ---------------------------------------------------------------------------
// ku-storage additions
// ---------------------------------------------------------------------------

export function ErrorBox({ children, className }: { children: ReactNode; className?: string }) {
  if (!children) return null
  return (
    <div className={cn('rounded-lg border border-rose-800/60 bg-rose-950/40 p-2.5 text-xs text-rose-300', className)}>
      {children}
    </div>
  )
}

export function InfoBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-sky-800/60 bg-sky-950/40 p-2.5 text-xs text-sky-300', className)}>
      {children}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/60 p-12 text-center text-sm text-slate-500">
      {children}
    </div>
  )
}

export function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner className="h-6 w-6" />
    </div>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-2xl border border-slate-800 bg-slate-900/80 shadow-xl backdrop-blur-md', className)}>
      {children}
    </div>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className,
  indeterminate,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  disabled?: boolean
  className?: string
  indeterminate?: boolean
}) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm text-slate-300', disabled && 'cursor-not-allowed opacity-50', className)}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-600 bg-slate-900 accent-indigo-500"
        checked={checked}
        disabled={disabled}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate && !checked
        }}
        onChange={(e) => onChange(e.target.checked)}
        onClick={(e) => e.stopPropagation()}
      />
      {label}
    </label>
  )
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/80 shadow-xl', className)}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  )
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cn('border-b border-slate-800 bg-slate-900 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400', className)}>
      {children}
    </th>
  )
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn('border-b border-slate-800/60 px-4 py-2.5 align-middle', className)}>
      {children}
    </td>
  )
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 'max-w-xl',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className={cn('animate-slide-in-right flex h-full w-full flex-col border-l border-slate-800 bg-slate-900/95 shadow-2xl', width)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-100">{title}</h2>
            {subtitle && <div className="mt-0.5 truncate text-xs text-slate-400">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

/** Confirmation dialog. When `typeToConfirm` is set the user must type that exact text. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = true,
  typeToConfirm,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  typeToConfirm?: string
  busy?: boolean
  error?: string
  onConfirm: () => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  useEffect(() => {
    if (open) setTyped('')
  }, [open])
  const ok = !typeToConfirm || typed === typeToConfirm
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok && !busy) onConfirm()
        }}
      >
        <div className="text-sm text-slate-300">{message}</div>
        {typeToConfirm && (
          <Field label={`Type "${typeToConfirm}" to confirm`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus className="font-mono" />
          </Field>
        )}
        <ErrorBox>{error}</ErrorBox>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={!ok || busy}>
            {busy ? <Spinner className="border-white/30 border-t-white" /> : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          const ta = document.createElement('textarea')
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          ta.remove()
        }
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
      {done ? 'Copied' : 'Copy'}
    </Button>
  )
}

export function PermBadges({ perms, className }: { perms: { read: boolean; create: boolean; update: boolean; delete: boolean }; className?: string }) {
  const items: { k: keyof typeof perms; label: string; tone: BadgeTone }[] = [
    { k: 'read', label: 'read', tone: 'blue' },
    { k: 'create', label: 'create', tone: 'green' },
    { k: 'update', label: 'update', tone: 'amber' },
    { k: 'delete', label: 'delete', tone: 'red' },
  ]
  const on = items.filter((i) => perms[i.k])
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {on.length === 0 && <Badge tone="slate">no access</Badge>}
      {on.map((i) => (
        <Badge key={i.k} tone={i.tone} className="px-1.5 text-[10px]">
          {i.label}
        </Badge>
      ))}
    </span>
  )
}

// ---- toasts ----

type ToastTone = 'ok' | 'error' | 'info'
interface ToastItem {
  id: number
  tone: ToastTone
  text: string
}

const ToastCtx = createContext<((tone: ToastTone, text: string) => void) | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((tone: ToastTone, text: string) => {
    const id = Date.now() + Math.random()
    setItems((xs) => [...xs, { id, tone, text }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed left-1/2 top-4 z-[60] flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              'animate-fade-in pointer-events-auto flex items-start gap-2 rounded-xl border p-3 text-sm shadow-2xl backdrop-blur-xl',
              t.tone === 'ok' && 'border-emerald-800/60 bg-emerald-950/90 text-emerald-200',
              t.tone === 'error' && 'border-rose-800/60 bg-rose-950/90 text-rose-200',
              t.tone === 'info' && 'border-slate-700 bg-slate-900/95 text-slate-200',
            )}
          >
            <span className="flex-1 break-words">{t.text}</span>
            <button
              className="shrink-0 opacity-60 hover:opacity-100"
              onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const push = useContext(ToastCtx)
  if (!push) throw new Error('useToast outside provider')
  return {
    ok: (text: string) => push('ok', text),
    error: (text: string) => push('error', text),
    info: (text: string) => push('info', text),
  }
}
