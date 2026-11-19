# ku-storage HTTP API (v1)

Kontrak antara backend Go dan SPA. Semua body JSON memakai camelCase.
ID selalu string opaque. Timestamp: string RFC3339 (UTC). Field nullable
ditulis `T | null`.

## Konvensi

- Error: status HTTP non-2xx + `{ "error": "CODE", "message": "..." }`.
- Auth: cookie `ku_storage_session` (HttpOnly). `401 UNAUTHENTICATED` →
  SPA redirect ke `/login`.
- CSRF: semua method selain GET/HEAD harus mengirim header `Origin` yang
  sama dengan origin aplikasi (browser melakukannya otomatis untuk
  `fetch`). Gagal → `403 BAD_ORIGIN`.
- `/api/admin/*` hanya untuk role `admin` → selain itu `403 FORBIDDEN`.

### Tipe bersama

```ts
type Perms = { read: boolean; create: boolean; update: boolean; delete: boolean }
type Role = 'admin' | 'user'

type MeUser = { id: string; username: string; displayName: string; role: Role }

type EntryPoint = {
  bucketId: string
  bucketName: string       // nama bucket di R2
  displayName: string      // nama tampilan bucket (fallback ke bucketName)
  connectionName: string
  prefix: string           // '' = seluruh bucket, selain itu diakhiri '/'
  perms: Perms
}
```

Error codes yang dipakai: `UNAUTHENTICATED`, `FORBIDDEN`, `BAD_ORIGIN`,
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
| POST | `/api/invites/{token}` | `{ password }` | `{ user: MeUser }` (+ cookie, langsung login) |
| GET | `/api/me` | – | `{ user: MeUser, access: EntryPoint[] }` |
| PUT | `/api/me/password` | `{ currentPassword, newPassword }` | `204` (session lain diputus) |
| GET | `/api/me/sessions` | – | `Session[]` |
| DELETE | `/api/me/sessions/{id}` | – | `204` |
| POST | `/api/me/sessions/revoke-others` | – | `204` |

```ts
type Session = { id: string; ip: string; userAgent: string; createdAt: string; lastSeenAt: string; current: boolean }
```

Password minimal 10 karakter (`400 INVALID_INPUT`). Username: 3–64
karakter `[a-z0-9._-]`, case-insensitive (disimpan lowercase).

Admin melihat `access` berisi semua bucket terdaftar dengan prefix `''`
dan semua perms `true`.

## Object (dicek authz)

`bucket` = bucket **id** (bukan nama).

### `GET /api/browse?bucket=&prefix=&cursor=`

```ts
type BrowseResult = {
  bucket: { id: string; name: string; displayName: string }
  prefix: string
  virtual: boolean          // true = folder sintetis menuju grant, tanpa isi R2
  perms: Perms              // izin efektif pada prefix ini
  folders: { name: string; prefix: string; perms: Perms }[]
  objects: { key: string; name: string; size: number; lastModified: string; etag: string }[]
  nextCursor: string | null // kirim balik sebagai ?cursor= untuk halaman berikut
}
```

Maks 1000 entri (folder + object) per halaman. Object penanda folder
(key == prefix) tidak ikut di `objects`. `403 FORBIDDEN` bila prefix
tidak bisa dilihat.

### `GET /api/objects/stat?bucket=&key=`

`{ key, size, lastModified, etag, contentType, metadata: Record<string,string> }`

### `GET /api/objects/download?bucket=&key=&inline=0|1`

`302` ke presigned URL R2 (berlaku 5 menit). `inline=1` untuk preview
(Content-Disposition inline), default attachment. Dipakai langsung sebagai
`href` / `src`.

### `PUT /api/objects?bucket=&key=&overwrite=0|1`

Body = isi file mentah. Wajib `Content-Length` (browser otomatis untuk
`File`/`Blob`). `Content-Type` dari header request.

- `201 { key, size, etag }`
- `409 OBJECT_EXISTS` — object sudah ada dan `overwrite=0`
- `409 OBJECT_MISSING` — `overwrite=1`, user tidak punya `create`, key belum ada
- `409 CONFLICT` — object berubah saat sedang ditimpa (coba lagi)
- `403 FORBIDDEN` — tidak punya `create` (overwrite=0) / `update` (overwrite=1)
- `413 TOO_LARGE`, `411 LENGTH_REQUIRED`, `400 INVALID_KEY`

### `POST /api/folders`

`{ bucket, prefix, name }` → `201 { prefix }` (prefix folder baru, diakhiri
`/`). `409 OBJECT_EXISTS` bila sudah ada.

### `POST /api/objects/delete`

`{ bucket, keys: string[] }` (maks 1000). Key berakhiran `/` = folder,
dihapus rekursif (maks 10.000 object per folder → `422 FOLDER_TOO_LARGE`,
dicek sebelum menghapus apa pun).

→ `{ deleted: number, errors: { key: string; message: string }[] }`

## Admin

```ts
type GroupRef = { id: string; name: string }
type User = {
  id: string; username: string; displayName: string; role: Role
  disabled: boolean; pending: boolean          // pending = belum set password
  createdAt: string; lastLoginAt: string | null
  groups: GroupRef[]
}
type InviteLink = { invitePath: string; expiresAt: string }  // SPA menambah window.location.origin

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
| POST | `/api/admin/users/{id}/reset` | – | `InviteLink` (session user diputus) |
| DELETE | `/api/admin/users/{id}` | – | `204`. `409 LAST_ADMIN` |
| GET | `/api/admin/users/{id}/access` | – | `{ grants: (Grant & { via: 'user' \| 'group' })[], access: EntryPoint[] }` |
| GET | `/api/admin/groups` | – | `Group[]` |
| POST | `/api/admin/groups` | `{ name, memberIds: string[] }` | `201 Group` |
| PUT | `/api/admin/groups/{id}` | `{ name, memberIds }` | `Group` |
| DELETE | `/api/admin/groups/{id}` | – | `204` (grant grup ikut terhapus) |
| GET | `/api/admin/connections` | – | `Connection[]` |
| POST | `/api/admin/connections` | `{ name, kind, accountId, endpoint, region, pathStyle, accessKey, secretKey }` | `201 Connection` |
| PUT | `/api/admin/connections/{id}` | sama; `secretKey: ''` = tidak diubah | `Connection` |
| DELETE | `/api/admin/connections/{id}` | – | `204`. `409 CONFLICT` bila masih punya bucket |
| POST | `/api/admin/connections/{id}/discover` | – | `{ buckets: string[] }` atau `502 STORAGE_ERROR` |
| GET | `/api/admin/buckets` | – | `Bucket[]` |
| POST | `/api/admin/buckets` | `{ connectionId, name, displayName }` | `201 Bucket` |
| PUT | `/api/admin/buckets/{id}` | `{ displayName }` | `Bucket` |
| DELETE | `/api/admin/buckets/{id}` | `{ confirmName }` (= nama bucket) | `204`. `400 CONFIRM_MISMATCH` |
| POST | `/api/admin/buckets/{id}/test` | `{ write: boolean }` | `{ ok: boolean, steps: { name: string; ok: boolean; message: string }[] }` |
| GET | `/api/admin/grants?bucket=&subjectType=&subjectId=` | – | `Grant[]` |
| POST | `/api/admin/grants` | `{ subjectType, subjectId, bucketId, prefix, perms }` | `201 Grant` (upsert pada subject+bucket+prefix) |
| PUT | `/api/admin/grants/{id}` | `{ prefix, perms }` | `Grant` |
| DELETE | `/api/admin/grants/{id}` | – | `204` |
| GET | `/api/admin/audit?user=&bucket=&action=&result=&from=&to=&before=&limit=` | – | `{ items: AuditEntry[], nextBefore: string \| null }` |
| GET | `/api/admin/audit.csv?...` | filter sama | `text/csv` (attachment) |

Untuk kolom `kind: 'r2'` cukup `accountId`; `endpoint`/`region`/`pathStyle`
diabaikan (region otomatis `auto`). Untuk `kind: 's3'` wajib `endpoint`
(`https://...` atau `http://...`).

Grant: `perms.read` wajib `true` bila perms lain ada yang `true`
(`400 INVALID_INPUT`). `prefix` dinormalisasi server (ditambah `/`).

`audit` `from`/`to` = RFC3339 atau `YYYY-MM-DD`; `before` = id entri
terakhir halaman sebelumnya (paging mundur, terbaru dulu); `limit`
default 100, maks 500.
