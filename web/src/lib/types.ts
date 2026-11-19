// Mirrors docs/api.md exactly.

export type Perms = { read: boolean; create: boolean; update: boolean; delete: boolean }
export type Role = 'admin' | 'user'

export type MeUser = { id: string; username: string; displayName: string; role: Role }

export type EntryPoint = {
  bucketId: string
  bucketName: string
  displayName: string
  connectionName: string
  prefix: string
  perms: Perms
}

export type AuthStatus = { needsSetup: boolean }
export type UserResponse = { user: MeUser }
export type MeResponse = { user: MeUser; access: EntryPoint[] }
export type InviteInfo = { username: string; displayName: string; purpose: 'invite' | 'reset' }

export type Session = {
  id: string
  ip: string
  userAgent: string
  createdAt: string
  lastSeenAt: string
  current: boolean
}

// ---- objects ----

export type BrowseFolder = { name: string; prefix: string; perms: Perms }
export type BrowseObject = { key: string; name: string; size: number; lastModified: string; etag: string }

export type BrowseResult = {
  bucket: { id: string; name: string; displayName: string }
  prefix: string
  virtual: boolean
  perms: Perms
  folders: BrowseFolder[]
  objects: BrowseObject[]
  nextCursor: string | null
}

export type ObjectStat = {
  key: string
  size: number
  lastModified: string
  etag: string
  contentType: string
  metadata: Record<string, string>
}

export type PutObjectResult = { key: string; size: number; etag: string }
export type CreateFolderResult = { prefix: string }
export type DeleteResult = { deleted: number; errors: { key: string; message: string }[] }

// ---- admin ----

export type GroupRef = { id: string; name: string }

export type User = {
  id: string
  username: string
  displayName: string
  role: Role
  disabled: boolean
  pending: boolean
  createdAt: string
  lastLoginAt: string | null
  groups: GroupRef[]
}

export type InviteLink = { invitePath: string; expiresAt: string }
export type CreateUserResult = { user: User; invite: InviteLink }

export type Group = {
  id: string
  name: string
  createdAt: string
  members: { id: string; username: string; displayName: string }[]
}

export type Bucket = {
  id: string
  connectionId: string
  connectionName: string
  name: string
  displayName: string
  createdAt: string
  grantCount: number
}

export type ConnectionKind = 'r2' | 's3'

export type Connection = {
  id: string
  name: string
  kind: ConnectionKind
  accountId: string
  endpoint: string
  region: string
  pathStyle: boolean
  accessKey: string
  hasSecret: boolean
  createdAt: string
  buckets: Bucket[]
}

export type ConnectionInput = {
  name: string
  kind: ConnectionKind
  accountId: string
  endpoint: string
  region: string
  pathStyle: boolean
  accessKey: string
  secretKey: string
}

export type SubjectType = 'user' | 'group'

export type Grant = {
  id: string
  subjectType: SubjectType
  subjectId: string
  subjectName: string
  bucketId: string
  bucketName: string
  prefix: string
  perms: Perms
  createdAt: string
}

export type UserAccess = {
  grants: (Grant & { via: 'user' | 'group' })[]
  access: EntryPoint[]
}

export type BucketTestResult = { ok: boolean; steps: { name: string; ok: boolean; message: string }[] }

export type AuditResult = 'ok' | 'denied' | 'error'

export type AuditEntry = {
  id: string
  ts: string
  userId: string | null
  username: string
  ip: string
  action: string
  bucketName: string
  key: string
  size: number
  result: AuditResult
  detail: string
}

export type AuditPage = { items: AuditEntry[]; nextBefore: string | null }
