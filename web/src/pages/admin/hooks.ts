import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { Bucket, Connection, Group, User } from '../../lib/types'

export const useUsers = () => useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.get<User[]>('/api/admin/users') })
export const useGroups = () => useQuery({ queryKey: ['admin', 'groups'], queryFn: () => api.get<Group[]>('/api/admin/groups') })
export const useBuckets = () => useQuery({ queryKey: ['admin', 'buckets'], queryFn: () => api.get<Bucket[]>('/api/admin/buckets') })
export const useConnections = () =>
  useQuery({ queryKey: ['admin', 'connections'], queryFn: () => api.get<Connection[]>('/api/admin/connections') })
