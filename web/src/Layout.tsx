import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Cable,
  ChevronDown,
  FolderLock,
  Folders,
  LogOut,
  Menu as MenuIcon,
  Moon,
  ScrollText,
  Settings2,
  Sun,
  UserRound,
  Users,
  UsersRound,
  X,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useAuth } from './auth'
import UploadPanel from './browser/UploadPanel'
import { currentTheme, setTheme } from './theme'
import type { Theme } from './theme'
import { Avatar, IconButton, Logo, Menu, MenuDivider, MenuItem, cn, focusRing, menuItemClass, useEscape } from './ui'

type NavItem = { to: string; label: string; icon: ComponentType<{ size?: number; className?: string }> }

const adminNav: NavItem[] = [
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/groups', label: 'Groups', icon: UsersRound },
  { to: '/admin/access', label: 'Access', icon: FolderLock },
  { to: '/admin/connections', label: 'Connections', icon: Cable },
  { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
]

function useTheme(): [Theme, () => void] {
  const [theme, set] = useState<Theme>(currentTheme)
  const toggle = useCallback(() => {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark'
    setTheme(next)
    set(next)
  }, [])
  return [theme, toggle]
}

const topLink = (active: boolean) =>
  cn(
    'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
    focusRing,
    active
      ? 'bg-teal-50 text-teal-800 dark:bg-teal-500/15 dark:text-teal-200'
      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
  )

export default function Layout() {
  const { me, isAdmin, logout } = useAuth()
  const navigate = useNavigate()
  const loc = useLocation()
  const [theme, toggleTheme] = useTheme()
  const [sheet, setSheet] = useState(false)
  const closeSheet = useCallback(() => setSheet(false), [])
  useEscape(sheet, closeSheet)

  // Close the mobile sheet on navigation.
  useEffect(() => setSheet(false), [loc.pathname, loc.search])

  const filesActive = loc.pathname === '/' || loc.pathname.startsWith('/b/')
  const adminActive = loc.pathname.startsWith('/admin')
  const name = me?.displayName || me?.username || ''

  async function doLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-zinc-800 dark:bg-zinc-900/90 dark:supports-[backdrop-filter]:bg-zinc-900/80">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-4 sm:px-6 lg:px-8">
          <IconButton label="Open menu" className="-ml-2 md:hidden" onClick={() => setSheet(true)}>
            <MenuIcon size={20} />
          </IconButton>
          <Link to="/" className={cn('mr-4 rounded-lg', focusRing)} aria-label="ku-storage home">
            <Logo />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            <Link to="/" className={topLink(filesActive)}>
              <Folders size={16} /> Files
            </Link>
            {isAdmin && (
              <Menu
                align="left"
                buttonClassName={topLink(adminActive)}
                button={
                  <>
                    <Settings2 size={16} /> Admin <ChevronDown size={14} className="opacity-60" />
                  </>
                }
              >
                <div className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-gray-400 dark:text-zinc-500">Administration</div>
                {adminNav.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    role="menuitem"
                    className={({ isActive }) => cn(menuItemClass, isActive && 'bg-teal-50 text-teal-800 dark:bg-teal-500/15 dark:text-teal-200')}
                  >
                    <Icon size={16} className="shrink-0 opacity-70" />
                    {label}
                  </NavLink>
                ))}
              </Menu>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </IconButton>
            <Menu
              ariaLabel="Account menu"
              buttonClassName="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 hover:bg-gray-100 dark:hover:bg-zinc-800"
              width="w-64"
              button={
                <>
                  <Avatar name={name} />
                  <ChevronDown size={14} className="hidden text-gray-400 sm:block" />
                </>
              }
            >
              <div className="flex items-center gap-3 px-2.5 py-2.5">
                <Avatar name={name} className="h-9 w-9" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-gray-900 dark:text-zinc-50">{name}</div>
                  <div className="truncate text-xs text-gray-500 dark:text-zinc-400">
                    <span className="font-mono">{me?.username}</span> · {isAdmin ? 'Administrator' : 'User'}
                  </div>
                </div>
              </div>
              <MenuDivider />
              <MenuItem icon={UserRound} onClick={() => navigate('/account')}>
                Account
              </MenuItem>
              <MenuItem icon={LogOut} onClick={() => void doLogout()} danger>
                Log out
              </MenuItem>
            </Menu>
          </div>
        </div>
      </header>

      {sheet && (
        <div className="animate-fade fixed inset-0 z-40 bg-gray-900/30 backdrop-blur-sm md:hidden dark:bg-black/60" onClick={closeSheet}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="animate-pop flex h-full w-[min(20rem,85vw)] flex-col border-r border-gray-200 bg-white shadow-pop dark:border-zinc-800 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-16 items-center justify-between border-b border-gray-200 px-4 dark:border-zinc-800">
              <Logo />
              <IconButton label="Close menu" onClick={closeSheet}>
                <X size={20} />
              </IconButton>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main">
              <Link to="/" className={cn(topLink(filesActive), 'flex w-full')}>
                <Folders size={16} /> Files
              </Link>
              <Link to="/account" className={cn(topLink(loc.pathname === '/account'), 'flex w-full')}>
                <UserRound size={16} /> Account
              </Link>
              {isAdmin && (
                <>
                  <div className="px-3 pb-1 pt-4 text-xs font-medium text-gray-400 dark:text-zinc-500">Administration</div>
                  {adminNav.map(({ to, label, icon: Icon }) => (
                    <NavLink key={to} to={to} className={({ isActive }) => cn(topLink(isActive), 'flex w-full')}>
                      <Icon size={16} /> {label}
                    </NavLink>
                  ))}
                </>
              )}
            </nav>
            <div className="border-t border-gray-200 p-3 dark:border-zinc-800">
              <div className="flex items-center gap-3 px-2 py-2">
                <Avatar name={name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{name}</div>
                  <div className="text-xs text-gray-500 dark:text-zinc-400">{isAdmin ? 'Administrator' : 'User'}</div>
                </div>
                <IconButton label="Log out" onClick={() => void doLogout()} className="hover:text-rose-600 dark:hover:text-rose-400">
                  <LogOut size={18} />
                </IconButton>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <Outlet />
      </main>

      <UploadPanel />
    </div>
  )
}
