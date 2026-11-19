import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, UNAUTHENTICATED_EVENT } from './lib/api'
import type { AuthStatus, MeResponse, MeUser, UserResponse } from './lib/types'

interface AuthState {
  loading: boolean
  needsSetup: boolean
  me: MeUser | null
  isAdmin: boolean
  login: (username: string, password: string) => Promise<void>
  setup: (username: string, password: string, displayName: string) => Promise<void>
  /** Used after accepting an invite (server already set the cookie). */
  adopt: (user: MeUser) => void
  logout: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside provider')
  return v
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [me, setMe] = useState<MeUser | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await api.get<MeResponse>('/api/me')
        if (!cancelled) {
          qc.setQueryData(['me'], res)
          setMe(res.user)
        }
      } catch {
        try {
          const st = await api.get<AuthStatus>('/api/auth/status')
          if (!cancelled) setNeedsSetup(st.needsSetup)
        } catch {
          /* server unreachable */
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [qc])

  // Any 401 UNAUTHENTICATED from the API drops the local session; RequireAuth then redirects to /login.
  useEffect(() => {
    const onUnauth = () => {
      setMe(null)
      qc.clear()
    }
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauth)
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauth)
  }, [qc])

  const adopt = useCallback(
    (user: MeUser) => {
      qc.clear()
      setMe(user)
      setNeedsSetup(false)
    },
    [qc],
  )

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await api.post<UserResponse>('/api/auth/login', { username, password })
      adopt(res.user)
    },
    [adopt],
  )

  const setup = useCallback(
    async (username: string, password: string, displayName: string) => {
      const res = await api.post<UserResponse>('/api/auth/setup', {
        username,
        password,
        ...(displayName ? { displayName } : {}),
      })
      adopt(res.user)
    },
    [adopt],
  )

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout')
    } finally {
      setMe(null)
      qc.clear()
    }
  }, [qc])

  return (
    <Ctx.Provider value={{ loading, needsSetup, me, isAdmin: me?.role === 'admin', login, setup, adopt, logout }}>
      {children}
    </Ctx.Provider>
  )
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, me } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="p-8 text-slate-500">Loading…</div>
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  return <>{children}</>
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}
