# ku-storage HTTP API (v1)

Contract between the Go backend and the SPA. All JSON bodies use camelCase.
IDs are always opaque strings. Timestamps: RFC3339 strings (UTC). Nullable
fields are written `T | null`.

## Conventions

- Errors: non-2xx HTTP status + `{ "error": "CODE", "message": "..." }`.
- Auth: cookie `ku_storage_session` (HttpOnly). `401 UNAUTHENTICATED` →
  the SPA redirects to `/login`.
- CSRF: every method other than GET/HEAD must send an `Origin` header equal
  to the application origin (browsers do this automatically for `fetch`).
  Otherwise → `403 BAD_ORIGIN`.
- `/api/admin/*` is for the `admin` role only → otherwise `403 FORBIDDEN`.

### Shared types

```ts
type Perms = { read: boolean; create: boolean; update: boolean; delete: boolean }
type Role = 'admin' | 'user'

type MeUser = { id: string; username: string; displayName: string; role: Role }

type EntryPoint = {
  bucketId: string
  bucketName: string       // bucket name in R2
  displayName: string      // bucket display name (falls back to bucketName)
  connectionName: string
  prefix: string           // '' = whole bucket, otherwise ends with '/'
  perms: Perms
}
```

Error codes in use: `UNAUTHENTICATED`, `FORBIDDEN`, `BAD_ORIGIN`,
`INVALID_BODY`, `INVALID_INPUT`, `INVALID_KEY`, `NOT_FOUND`,
`RATE_LIMITED`, `INVALID_CREDENTIALS`, `ALREADY_SETUP`, `CONFLICT`,
`OBJECT_EXISTS`, `OBJECT_MISSING`, `FOLDER_TOO_LARGE`, `TOO_LARGE`,
`LENGTH_REQUIRED`, `STORAGE_ERROR`, `CONFIRM_MISMATCH`, `LAST_ADMIN`,
`INVITE_INVALID`, `INTERNAL`.

## Auth & akun

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/auth/status` | – | `{ needsSetup: boolean }` |
| POST | `/api/auth/setup` | `{ username, password, displayName? }` | `201 { user: MeUser }` (+ cookie) |
| POST | `/api/auth/login` | `{ username, password }` | `{ user: MeUser }` (+ cookie). `401 INVALID_CREDENTIALS`, `429 RATE_LIMITED` |
| POST | `/api/auth/logout` | – | `204` |
| GET | `/api/invites/{token}` | – | `{ username, displayName, purpose: 'invite' \| 'reset' }`. `404 INVITE_INVALID` |
| POST | `/api/invites/{token}` | `{ password }` | `{ user: MeUser }` (+ cookie, logged in right away) |
| GET | `/api/me` | – | `{ user: MeUser, access: EntryPoint[] }` |
| PUT | `/api/me/password` | `{ currentPassword, newPassword }` | `204` (other sessions are ended) |
| GET | `/api/me/sessions` | – | `Session[]` |
| DELETE | `/api/me/sessions/{id}` | – | `204` |
| POST | `/api/me/sessions/revoke-others` | – | `204` |

```ts
type Session = { id: string; ip: string; userAgent: string; createdAt: string; lastSeenAt: string; current: boolean }
```

Passwords need at least 10 characters (`400 INVALID_INPUT`). Usernames: 3–64
characters of `[a-z0-9._-]`, case-insensitive (stored lowercase).

For admins, `access` lists every registered bucket with prefix `''` and
all perms `true`.

## Objects (authz-checked)

`bucket` = bucket **id** (not the name).

### `GET /api/browse?bucket=&prefix=&cursor=`

```ts
type BrowseResult = {
  bucket: { id: string; name: string; displayName: string }
  prefix: string
  virtual: boolean          // true = synthetic folders leading to a grant, no R2 content
  perms: Perms              // effective permissions at this prefix
  folders: { name: string; prefix: string; perms: Perms }[]
  objects: { key: string; name: string; size: number; lastModified: string; etag: string }[]
  nextCursor: string | null // send back as ?cursor= for the next page
}
```

At most 1000 entries (folders + objects) per page. The folder marker object
(key == prefix) is not included in `objects`. `403 FORBIDDEN` when the prefix
is not visible.

### `GET /api/objects/stat?bucket=&key=`

`{ key, size, lastModified, etag, contentType, metadata: Record<string,string> }`

### `GET /api/objects/download?bucket=&key=&inline=0|1`

`302` to a presigned R2 URL (valid for 5 minutes). `inline=1` for preview
(Content-Disposition inline), attachment by default. Used directly as
`href` / `src`.

### `PUT /api/objects?bucket=&key=&overwrite=0|1`

Body = raw file content. `Content-Length` is required (browsers set it for
`File`/`Blob`). `Content-Type` comes from the request header.

- `201 { key, size, etag }`
- `409 OBJECT_EXISTS` — the object exists and `overwrite=0`
- `409 OBJECT_MISSING` — `overwrite=1`, the user lacks `create` and the key does not exist
- `409 CONFLICT` — the object changed while being overwritten (try again)
- `403 FORBIDDEN` — missing `create` (overwrite=0) / `update` (overwrite=1)
- `413 TOO_LARGE`, `411 LENGTH_REQUIRED`, `400 INVALID_KEY`

### `POST /api/folders`

`{ bucket, prefix, name }` → `201 { prefix }` (prefix of the new folder, ending
with `/`). `409 OBJECT_EXISTS` if it already exists.

### `POST /api/objects/delete`

`{ bucket, keys: string[] }` (max 1000). A key ending with `/` is a folder,
deleted recursively (max 10,000 objects per folder → `422 FOLDER_TOO_LARGE`,
checked before anything is deleted).

→ `{ deleted: number, errors: { key: string; message: string }[] }`

## Admin

```ts
type GroupRef = { id: string; name: string }
type User = {
  id: string; username: string; displayName: string; role: Role
  disabled: boolean; pending: boolean          // pending = no password set yet
  createdAt: string; lastLoginAt: string | null
  groups: GroupRef[]
}
type InviteLink = { invitePath: string; expiresAt: string }  // the SPA prepends window.location.origin

type Group = { id: string; name: string; createdAt: string; members: { id: string; username: string; displayName: string }[] }

type Bucket = {
  id: string; connectionId: string; connectionName: string
  name: string; displayName: string; createdAt: string; grantCount: number
}
type Connection = {
  id: string; name: string; kind: 'r2' | 's3'
  accountId: string; endpoint: string; region: string; pathStyle: boolean
  accessKey: string; hasSecret: boolean; createdAt: string
  buckets: Bucket[]
}

type Grant = {
  id: string
  subjectType: 'user' | 'group'; subjectId: string; subjectName: string
  bucketId: string; bucketName: string
  prefix: string; perms: Perms; createdAt: string
}

type AuditEntry = {
  id: string; ts: string; userId: string | null; username: string; ip: string
  action: string; bucketName: string; key: string; size: number
  result: 'ok' | 'denied' | 'error'; detail: string
}
```

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/admin/users` | – | `User[]` |
| POST | `/api/admin/users` | `{ username, displayName, role, groupIds: string[] }` | `201 { user: User, invite: InviteLink }` |
| PUT | `/api/admin/users/{id}` | `{ displayName, role, disabled, groupIds }` | `User`. `409 LAST_ADMIN` |
| POST | `/api/admin/users/{id}/reset` | – | `InviteLink` (the user's sessions are ended) |
| DELETE | `/api/admin/users/{id}` | – | `204`. `409 LAST_ADMIN` |
| GET | `/api/admin/users/{id}/access` | – | `{ grants: (Grant & { via: 'user' \| 'group' })[], access: EntryPoint[] }` |
| GET | `/api/admin/groups` | – | `Group[]` |
| POST | `/api/admin/groups` | `{ name, memberIds: string[] }` | `201 Group` |
| PUT | `/api/admin/groups/{id}` | `{ name, memberIds }` | `Group` |
| DELETE | `/api/admin/groups/{id}` | – | `204` (the group's grants are removed too) |
| GET | `/api/admin/connections` | – | `Connection[]` |
| POST | `/api/admin/connections` | `{ name, kind, accountId, endpoint, region, pathStyle, accessKey, secretKey }` | `201 Connection` |
| PUT | `/api/admin/connections/{id}` | same; `secretKey: ''` = unchanged | `Connection` |
| DELETE | `/api/admin/connections/{id}` | – | `204`. `409 CONFLICT` while it still has buckets |
| POST | `/api/admin/connections/{id}/discover` | – | `{ buckets: string[] }` or `502 STORAGE_ERROR` |
| GET | `/api/admin/buckets` | – | `Bucket[]` |
| POST | `/api/admin/buckets` | `{ connectionId, name, displayName }` | `201 Bucket` |
| PUT | `/api/admin/buckets/{id}` | `{ displayName }` | `Bucket` |
| DELETE | `/api/admin/buckets/{id}` | `{ confirmName }` (= bucket name) | `204`. `400 CONFIRM_MISMATCH` |
| POST | `/api/admin/buckets/{id}/test` | `{ write: boolean }` | `{ ok: boolean, steps: { name: string; ok: boolean; message: string }[] }` |
| GET | `/api/admin/grants?bucket=&subjectType=&subjectId=` | – | `Grant[]` |
| POST | `/api/admin/grants` | `{ subjectType, subjectId, bucketId, prefix, perms }` | `201 Grant` (upsert on subject+bucket+prefix) |
| PUT | `/api/admin/grants/{id}` | `{ prefix, perms }` | `Grant` |
| DELETE | `/api/admin/grants/{id}` | – | `204` |
| GET | `/api/admin/audit?user=&bucket=&action=&result=&from=&to=&before=&limit=` | – | `{ items: AuditEntry[], nextBefore: string \| null }` |
| GET | `/api/admin/audit.csv?...` | same filters | `text/csv` (attachment) |

For `kind: 'r2'`, `accountId` is enough; `endpoint`/`region`/`pathStyle`
are ignored (region is always `auto`). For `kind: 's3'`, `endpoint` is
required (`https://...` or `http://...`).

Grants: `perms.read` must be `true` when any other perm is `true`
(`400 INVALID_INPUT`). The server normalises `prefix` (appends `/`).

`audit` `from`/`to` = RFC3339 or `YYYY-MM-DD` (`to` is inclusive for dates);
`before` = id of the last entry of the previous page (pages go backwards,
newest first); `limit` defaults to 100, max 500.
