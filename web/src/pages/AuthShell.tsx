import type { FormEvent, ReactNode } from 'react'
import { Warehouse } from 'lucide-react'

export default function AuthShell({ subtitle, onSubmit, children }: { subtitle: string; onSubmit: (e: FormEvent) => void; children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4 selection:bg-indigo-500/30 selection:text-indigo-200">
      <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-indigo-600/15 blur-3xl" />
      <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-violet-600/15 blur-3xl" />
      <div className="relative w-full max-w-md">
        <form
          onSubmit={onSubmit}
          className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl backdrop-blur-xl"
        >
          <div className="mb-2 flex flex-col items-center space-y-2 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-lg shadow-indigo-600/30">
              <Warehouse size={24} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">ku-storage</h1>
            <p className="text-xs text-slate-400">{subtitle}</p>
          </div>
          {children}
        </form>
      </div>
    </div>
  )
}
