import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Cable, FolderLock, Home, KeyRound, LogOut, ScrollText, ShieldCheck, User as UserIcon, Users, UsersRound, Warehouse } from 'lucide-react'
import { useAuth } from './auth'
import UploadPanel from './browser/UploadPanel'

type NavItem = { to: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }

const mainNav: NavItem[] = [
  { to: '/', label: 'My Access', icon: Home },
  { to: '/account', label: 'Account', icon: KeyRound },
]

const adminNav: NavItem[] = [
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/groups', label: 'Groups', icon: UsersRound },
  { to: '/admin/access', label: 'Access', icon: FolderLock },
  { to: '/admin/connections', label: 'Connections', icon: Cable },
  { to: '/admin/audit', label: 'Audit Log', icon: ScrollText },
]

export default function Layout() {
  const { me, isAdmin, logout } = useAuth()
  const navigate = useNavigate()

  const groups = [{ title: 'Storage', items: mainNav }, ...(isAdmin ? [{ title: 'Admin', items: adminNav }] : [])]

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500/30 selection:text-indigo-200">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-slate-800/80 bg-slate-900/90 backdrop-blur-xl">
        <div className="flex items-center gap-3 border-b border-slate-800/80 px-6 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-md shadow-indigo-600/30">
            <Warehouse size={20} className="text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight text-white">ku-storage</span>
              <span className="rounded border border-indigo-500/20 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-400">
                v1.0
              </span>
            </div>
            <p className="text-[11px] text-slate-400">R2 Access Broker</p>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
          {groups.map((group) => (
            <div key={group.title} className="space-y-1">
              <div className="mb-1.5 px-3.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {group.title}
              </div>
              {group.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cnNav(isActive)}>
                  <Icon size={18} className="transition-transform group-hover:scale-110" />
                  <span className="flex-1 font-medium">{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-800/80 p-4">
          <div className="flex items-center justify-between rounded-xl border border-slate-800/60 bg-slate-950/60 p-3">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-800/50 bg-indigo-950 text-indigo-400">
                {isAdmin ? <ShieldCheck size={16} /> : <UserIcon size={16} />}
              </div>
              <div className="truncate">
                <div className="truncate text-xs font-semibold text-slate-200" title={me?.username}>
                  {me?.displayName || me?.username}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  {isAdmin ? 'Administrator' : 'User'}
                </div>
              </div>
            </div>
            <button
              title="Logout"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-rose-400"
              onClick={async () => {
                await logout()
                navigate('/login')
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pl-64">
        <main className="mx-auto w-full max-w-7xl flex-1 p-8">
          <Outlet />
        </main>
      </div>

      <UploadPanel />
    </div>
  )
}

function cnNav(active: boolean): string {
  return `group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm border transition-colors duration-150 outline-none ${
    active
      ? 'bg-gradient-to-r from-indigo-600/20 to-violet-600/10 text-indigo-300 font-semibold border-indigo-500/30 shadow-sm'
      : 'border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
  }`
}
