import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, ComponentType, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { AlertCircle, Check, CheckCircle2, Copy, HardDrive, Info, Inbox, X } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { createPortal } from 'react-dom'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Shared teal focus ring for anything interactive. */
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900'

type IconType = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>

/** Closes on Escape while `active`. */
export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onEscape])
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

function LogoMark({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const box = { sm: 'h-7 w-7 rounded-lg', md: 'h-8 w-8 rounded-xl', lg: 'h-11 w-11 rounded-xl' }[size]
  const icon = { sm: 15, md: 17, lg: 22 }[size]
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center bg-teal-600 text-white shadow-sm shadow-teal-900/20', box, className)}>
      <HardDrive size={icon} strokeWidth={2.2} />
    </span>
  )
}

export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={inverted ? 'bg-white text-teal-700 shadow-none' : undefined} />
      <span className={cn('text-[17px] font-semibold tracking-tight', inverted ? 'text-white' : 'text-gray-900 dark:text-zinc-50')}>
        ku-storage
      </span>
    </span>
  )
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean)
  const initials = ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
  return (
    <span
      className={cn(
        'inline-flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-800 dark:bg-teal-500/20 dark:text-teal-200',
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Buttons & form controls
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'outline' | 'danger' | 'ghost' | 'secondary' | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-teal-600 text-white shadow-sm hover:bg-teal-700 active:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500',
  secondary:
    'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700',
  outline:
    'border border-gray-300 bg-white text-gray-700 shadow-sm hover:bg-gray-50 hover:text-gray-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-white',
  ghost: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 active:bg-rose-800 dark:bg-rose-600 dark:hover:bg-rose-500',
  success: 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 dark:hover:bg-emerald-500',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-xl',
}

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return cn(
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50',
    focusRing,
    buttonVariants[variant],
    buttonSizes[size],
    className,
  )
}

export function Button({ variant = 'primary', size = 'md', className, children, ...props }: ButtonProps) {
  return (
    <button {...props} className={buttonClass(variant, size, className)}>
      {children}
    </button>
  )
}

/** Square icon-only button; `label` becomes aria-label and title. */
export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
        focusRing,
        className,
      )}
    >
      {children}
    </button>
  )
}

const control =
  'w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm transition-colors placeholder:text-gray-400 hover:border-gray-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:hover:border-zinc-600 dark:focus:border-teal-400'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(control, 'h-9 py-2', className)} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(control, 'h-9 py-1.5 pr-8', className)} />
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-zinc-300">{label}</span>
        {hint && <span className="text-xs text-gray-400 dark:text-zinc-500">{hint}</span>}
      </div>
      {children}
    </label>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className,
  indeterminate,
  ariaLabel,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  disabled?: boolean
  className?: string
  indeterminate?: boolean
  ariaLabel?: string
}) {
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-zinc-300',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        aria-label={ariaLabel}
        className="h-4 w-4 cursor-pointer rounded border-gray-300 accent-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 dark:accent-teal-500"
        checked={checked}
        disabled={disabled}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate && !checked
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-block h-4 w-4 animate-spin rounded-full border-2 border-teal-600/25 border-t-teal-600 dark:border-teal-400/25 dark:border-t-teal-400', className)}
    />
  )
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-xl border border-gray-200 bg-white shadow-card dark:border-zinc-800 dark:bg-zinc-900', className)}>
      {children}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-zinc-50">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-zinc-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({
  children,
  icon: Icon = Inbox,
  title,
  className,
}: {
  children?: ReactNode
  icon?: IconType
  title?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-2xl border border-dashed border-gray-300 bg-white/60 px-6 py-14 text-center dark:border-zinc-700 dark:bg-zinc-900/40',
        className,
      )}
    >
      <div className="relative mb-4">
        <div className="absolute -inset-3 rounded-full bg-teal-50 dark:bg-teal-500/5" />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-teal-100 bg-white text-teal-600 shadow-card dark:border-teal-500/20 dark:bg-zinc-900 dark:text-teal-400">
          <Icon size={26} strokeWidth={1.75} />
        </div>
      </div>
      {title && <div className="text-base font-semibold text-gray-900 dark:text-zinc-100">{title}</div>}
      {children && <div className="mt-1 max-w-md text-sm text-gray-500 dark:text-zinc-400">{children}</div>}
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

export function ErrorBox({ children, className }: { children: ReactNode; className?: string }) {
  if (!children) return null
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
        className,
      )}
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function InfoBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-800 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200',
        className,
      )}
    >
      <Info size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export type BadgeTone = 'green' | 'red' | 'amber' | 'blue' | 'slate' | 'violet' | 'indigo' | 'teal'

const badgeTones: Record<BadgeTone, { cls: string; dot: string }> = {
  green: { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25', dot: 'bg-emerald-500' },
  red: { cls: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/25', dot: 'bg-rose-500' },
  amber: { cls: 'bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25', dot: 'bg-amber-500' },
  blue: { cls: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/25', dot: 'bg-sky-500' },
  slate: { cls: 'bg-gray-100 text-gray-600 ring-gray-500/20 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-600/40', dot: 'bg-gray-400' },
  violet: { cls: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/25', dot: 'bg-violet-500' },
  indigo: { cls: 'bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-400/25', dot: 'bg-teal-500' },
  teal: { cls: 'bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-400/25', dot: 'bg-teal-500' },
}

export function Badge({ tone, children, pulse = false, className }: { tone: BadgeTone; children: ReactNode; pulse?: boolean; className?: string }) {
  const t = badgeTones[tone]
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', t.cls, className)}>
      {pulse && <span className={cn('h-1.5 w-1.5 animate-pulse rounded-full', t.dot)} />}
      {children}
    </span>
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
        <Badge key={i.k} tone={i.tone}>
          {i.label}
        </Badge>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-card dark:border-zinc-800 dark:bg-zinc-900', className)}>
      <table className="w-full text-left text-sm [&_tbody_tr:last-child_td]:border-b-0">{children}</table>
    </div>
  )
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-medium text-gray-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400',
        className,
      )}
    >
      {children}
    </th>
  )
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn('border-b border-gray-100 px-4 py-3 align-middle text-gray-700 dark:border-zinc-800/70 dark:text-zinc-300', className)}>
      {children}
    </td>
  )
}

// ---------------------------------------------------------------------------
// Menu (dropdown)
// ---------------------------------------------------------------------------

export function Menu({
  button,
  buttonClassName,
  ariaLabel,
  align = 'right',
  width = 'w-56',
  children,
}: {
  button: ReactNode
  buttonClassName?: string
  ariaLabel?: string
  align?: 'left' | 'right'
  width?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useEscape(open, close)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(focusRing, buttonClassName)}
        onClick={() => setOpen((o) => !o)}
      >
        {button}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'animate-pop absolute z-50 mt-2 origin-top overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-pop dark:border-zinc-700/80 dark:bg-zinc-900',
            align === 'right' ? 'right-0' : 'left-0',
            width,
          )}
          onClick={close}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export const menuItemClass =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:bg-gray-100 focus-visible:outline-none dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 dark:focus-visible:bg-zinc-800'

export function MenuItem({ icon: Icon, children, onClick, danger }: { icon?: IconType; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(menuItemClass, danger && 'text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-300')}
      onClick={onClick}
    >
      {Icon && <Icon size={16} className="shrink-0 opacity-70" />}
      {children}
    </button>
  )
}

export function MenuDivider() {
  return <div className="my-1 h-px bg-gray-100 dark:bg-zinc-800" />
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

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
  useEscape(open, onClose)
  if (!open) return null
  return createPortal(
    <div
      className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-gray-900/30 p-0 backdrop-blur-sm sm:items-center sm:p-4 dark:bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'animate-pop flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-white text-gray-900 shadow-pop sm:rounded-2xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-sm text-gray-500 dark:text-zinc-400">{subtitle}</p>}
          </div>
          <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1 h-8 w-8">
            <X size={18} />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-6 pt-3">{children}</div>
      </div>
    </div>,
    document.body,
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
  useEscape(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="animate-fade fixed inset-0 z-40 flex justify-end bg-gray-900/20 backdrop-blur-[2px] dark:bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'animate-slide-in-right flex h-full w-full flex-col border-l border-gray-200 bg-white shadow-pop dark:border-zinc-800 dark:bg-zinc-900',
          width,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-gray-900 dark:text-zinc-50">{title}</h2>
            {subtitle && <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-zinc-400">{subtitle}</div>}
          </div>
          <IconButton label="Close" onClick={onClose} className="h-8 w-8">
            <X size={18} />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
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
        <div className="text-sm text-gray-600 dark:text-zinc-300">{message}</div>
        {typeToConfirm && (
          <Field label={`Type "${typeToConfirm}" to confirm`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus className="font-mono" />
          </Field>
        )}
        <ErrorBox>{error}</ErrorBox>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={!ok || busy}>
            {busy ? <Spinner className="border-white/30 border-t-white dark:border-white/30 dark:border-t-white" /> : confirmLabel}
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
      {done ? <Check size={14} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={14} />}
      {done ? 'Copied' : 'Copy'}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

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
      <div className="pointer-events-none fixed right-0 top-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4" aria-live="polite">
        {items.map((t) => {
          const Icon = t.tone === 'ok' ? CheckCircle2 : t.tone === 'error' ? AlertCircle : Info
          return (
            <div
              key={t.id}
              className="animate-pop pointer-events-auto flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3.5 text-sm text-gray-800 shadow-pop dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <Icon
                size={18}
                className={cn(
                  'mt-px shrink-0',
                  t.tone === 'ok' && 'text-emerald-600 dark:text-emerald-400',
                  t.tone === 'error' && 'text-rose-600 dark:text-rose-400',
                  t.tone === 'info' && 'text-teal-600 dark:text-teal-400',
                )}
              />
              <span className="flex-1 break-words">{t.text}</span>
              <button
                aria-label="Dismiss"
                className="shrink-0 rounded text-gray-400 hover:text-gray-700 dark:text-zinc-500 dark:hover:text-zinc-200"
                onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
              >
                <X size={15} />
              </button>
            </div>
          )
        })}
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
