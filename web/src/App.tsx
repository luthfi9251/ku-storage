import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError } from './lib/api'
import { AuthProvider, RequireAdmin, RequireAuth } from './auth'
import { ToastProvider } from './ui'
import { UploadProvider } from './browser/uploads'
import Layout from './Layout'
import Login from './pages/Login'
import Invite from './pages/Invite'
import MyAccess from './pages/MyAccess'
import Browser from './pages/Browser'
import Account from './pages/Account'
import Users from './pages/admin/Users'
import Groups from './pages/admin/Groups'
import Access from './pages/admin/Access'
import Connections from './pages/admin/Connections'
import Audit from './pages/admin/Audit'

// No polling anywhere: listing a bucket costs money.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <UploadProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/setup" element={<Navigate to="/login" replace />} />
                <Route path="/invite/:token" element={<Invite />} />
                <Route
                  element={
                    <RequireAuth>
                      <Layout />
                    </RequireAuth>
                  }
                >
                  <Route index element={<MyAccess />} />
                  <Route path="/b/:bucketId" element={<Browser />} />
                  <Route path="/account" element={<Account />} />
                  <Route path="/admin" element={<RequireAdmin><Navigate to="/admin/users" replace /></RequireAdmin>} />
                  <Route path="/admin/users" element={<RequireAdmin><Users /></RequireAdmin>} />
                  <Route path="/admin/groups" element={<RequireAdmin><Groups /></RequireAdmin>} />
                  <Route path="/admin/access" element={<RequireAdmin><Access /></RequireAdmin>} />
                  <Route path="/admin/connections" element={<RequireAdmin><Connections /></RequireAdmin>} />
                  <Route path="/admin/audit" element={<RequireAdmin><Audit /></RequireAdmin>} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </UploadProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
