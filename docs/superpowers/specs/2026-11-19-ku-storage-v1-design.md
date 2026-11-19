# ku-storage v1 — Design

Date: 2026-11-19
Status: Implemented (v1)

## Summary

ku-storage is an **access broker** for Cloudflare R2 object storage
(and other S3-compatible storage). The admin registers R2 credentials once on
the server; other users log in to ku-storage and can only view / create /
modify / delete objects in the buckets & folders (prefixes) granted
to them. R2 credentials never leave the server, and every action
is recorded under the user's name in the audit log.

Pain point being solved: R2 tokens can only be scoped per bucket,
not per folder, don't distinguish upload vs delete, and leave no
per-person trail. Giving someone else access means sharing the token.

The stack follows ku-dump / ku-crud: Go (single binary, `net/http`
ServeMux) + React SPA embedded via `embed.FS`, metadata in SQLite
(`modernc.org/sqlite`, no CGO), S3 client `minio-go/v7`.

## Goals (v1)

1. Admin registers R2 connections (account ID + access key) and the buckets
   that may be managed through ku-storage
2. Admin manages users (invite, disable, reset password) and groups
3. Admin issues **grants**: user/group × bucket × prefix × permissions
   (`read`, `create`, `update`, `delete`)
4. Users browse, upload, overwrite, create folders, download, preview,
   and delete objects — strictly limited by grants, checked on the server
5. Audit log of all actions (including denied ones), filterable by admins
6. Revoking access / disabling a user takes effect immediately

## Non-goals (v1)

- **Creating / deleting / configuring buckets** — done in the
  Cloudflare dashboard (a product decision, not merely deferred)
- Share links / presigned URLs for parties outside ku-storage (v2)
- Rename / move / copy objects, large recursive operations as jobs (v2)
- Editing object metadata, downloading a folder as ZIP (v2)
- SSO/OIDC, 2FA, upload quotas, grant delegation by non-admins (v3)
- Versioning, ACLs, bucket policies, object tagging (not supported by R2)
- Resumable uploads

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                 Binary ku-storage (:8080)                │
│  ┌──────────────┐   ┌─────────────────────────────────┐  │
│  │  React SPA   │←→ │  Go API /api/*                  │  │
│  │  (embed.FS)  │   │  session · authz · audit        │  │
│  └──────────────┘   └────────┬───────────────┬────────┘  │
│                              │               │           │
│  ┌───────────────────────────┴──┐  ┌─────────┴────────┐  │
│  │ SQLite: users, sessions,     │  │ s3x: client pool │  │
│  │ groups, connections, buckets,│  │ per connection   │  │
│  │ grants, audit_log            │  │ (minio-go)       │  │
│  └──────────────────────────────┘  └─────────┬────────┘  │
└──────────────────────────────────────────────┼───────────┘
                                               │ S3 API
         browser ── presigned GET (302) ──→ Cloudflare R2
```

- **Upload** always goes through the server (streamed, no temp file) — the server
  is the permission enforcement point; users never hold credentials
  that could write arbitrary keys.
- **Download / preview** via a 302 redirect to a short-lived presigned GET,
  issued *after* permissions are checked. R2 egress is free, the server doesn't
  carry the bandwidth, Range requests (video) work, and content is opened
  from the R2 origin so malicious HTML/SVG cannot touch the ku-storage
  session.
- **Listing** is not cached in SQLite; R2 is the source of truth.
  (ListObjects = paid Class A operation → no polling/auto-refresh.)

### Package layout

| Package | Responsibility |
|---|---|
| `cmd/ku-storage` | entrypoint: env config, wiring, serve |
| `internal/config` | env config (ku-dump pattern) |
| `internal/cryptx` | AES-256-GCM for connection secrets (copied from ku-dump) |
| `internal/meta` | SQLite store + migrations: users, sessions, invites, groups, connections, buckets, grants, audit |
| `internal/authz` | **core**: key/prefix normalization & validation, effective permission evaluation, virtual navigation. Pure functions, no I/O, table-tested |
| `internal/s3x` | minio-go wrapper: client pool per connection, list, conditional put, stat, batch delete, presign, bucket discovery |
| `internal/api` | HTTP handlers, session/admin/CSRF middleware, audit hook |
| `web/` | React SPA + `embed.go` |

## Access model

### Application roles
- `admin` — manages connections, buckets, users, groups, grants; views the audit log;
  has all permissions on every registered bucket (still recorded in the audit log).
- `user` — can only view & act according to grants.

The first user is created via the setup page (ku-dump pattern) and is automatically an admin.
At least one active admin must always exist (the server rejects demoting/disabling
the last admin).

### Permissions

| Permission | Operations |
|---|---|
| `read` | list, stat, download, preview |
| `create` | upload to a key that **does not exist yet**, create folder |
| `update` | overwrite an object that **already exists** |
| `delete` | delete object / folder |

Stored as a bitmask. UI presets: **Viewer** (read),
**Contributor** (read+create), **Editor** (read+create+update),
**Manager** (read+create+update+delete). `create`/`update`/`delete` without
`read` is rejected when saving a grant (the UI is unusable without list).

### Grant

```
grant = subject (user | group) × bucket × prefix × perms
```

- `prefix` is normalized: empty (= entire bucket) or ending with `/`.
  Example: `clients/acme/`. This guarantees folder boundaries — the grant
  `clients/acme/` does **not** cover `clients/acme-evil/x`.
- A user's **effective permissions** on `(bucket, key)` = the OR of `perms` of all grants
  belonging to that user + their groups on that bucket, where
  `strings.HasPrefix(key, grant.prefix)`.
- Consequence (monotonic): permissions on a key inside folder F are always ⊇ permissions
  on F. So checking permissions on the folder is sufficient for operations on all
  of that folder's contents (used by folder delete).
- Unique per `(subject, bucket, prefix)`; saving again = updating perms.

### Virtual navigation

A user with a grant on `clients/acme/reports/` may "see the path" from the bucket
root without seeing any other contents:

- `GET /api/browse?bucket=B&prefix=P`
  - If P is covered by a `read` grant → list from R2 (delimiter `/`, max 1000,
    continuation token). Each folder in the result is given its effective `perms`
    (may be greater if there is a deeper grant).
  - If P is **not** covered but is an ancestor of a grant prefix
    → **without calling R2**, return synthetic folders leading to that grant
    (e.g. at root: `clients/`; at `clients/`: `acme/`).
  - Otherwise → `403 FORBIDDEN` (and audited as `denied`).
- The user's home page ("My Access") shows a list of entry points:
  every (bucket, prefix) grant pair that is not inside another
  of their grants.

### Key validation

Rejected with `400 INVALID_KEY` if:
- not valid UTF-8, length > 1024 bytes, or empty
- starts with `/`, contains `//`, or a `.` or `..` segment
- contains control characters (`< 0x20`, `0x7f`) or `\`

Folder = 0-byte object with a key ending in `/`. New file/folder names
from the UI are validated with the same rules before being joined with the prefix.

## Object operations & permission enforcement

| Operation | Permission checked | R2 implementation |
|---|---|---|
| List | `read` on prefix | `ListObjectsV2` delimiter `/`, max 1000 |
| Stat | `read` | `HeadObject` |
| Download / preview | `read` | 5-minute presigned GET, `response-content-disposition` = `attachment` (download) or `inline` (preview), 302 |
| New upload | `create` | `PutObject` + `If-None-Match: *` → 412 mapped to `409 OBJECT_EXISTS` |
| Overwrite (`overwrite=1`) | `update` (+`create` if the key turns out not to exist) | has create+update → plain PUT; update only → `HeadObject` then PUT with `If-Match: "<etag>"` (key missing → `409 OBJECT_MISSING`, changed in between → `409 CONFLICT`) |
| Create folder | `create` on the new folder | 0-byte PUT `prefix/name/` + `If-None-Match: *` |
| Delete objects (bulk, ≤1000 keys) | `delete` on each key | `DeleteObjects` |
| Delete folder | `delete` on the folder prefix | recursive list + `DeleteObjects` per 1000, synchronous, **max 10,000 objects** per request (more → `422 FOLDER_TOO_LARGE`, to be handled by jobs in v2) |

Notes:
- R2 evaluates `If-None-Match: *` atomically against bucket state
  (also on `CompleteMultipartUpload`) — no create vs create race.
  minio-go: `PutObjectOptions.SetMatchETagExcept("*")` /
  `SetMatchETag("*")`; the header is carried to `CompleteMultipartUpload`.
- The implementation uses `If-Match: "<etag>"` (not `If-Match: *`) so as
  not to depend on wildcard support. Already verified against
  MinIO (including conditional multipart). **Still needs to be run once
  against real R2** (`go test -tags integration ./internal/s3x/` with
  env `KUSTORAGE_TEST_KIND=r2`), especially the conditional headers on
  multipart.
- Upload: one file per request `PUT /api/objects?bucket=&key=` with
  a raw body + mandatory `Content-Length` (size known → minio-go picks a
  fixed part size; part size is set explicitly to 64 MiB so memory per
  upload is bounded and R2's requirement that parts be uniformly sized is met).
  Default size limit 5 GiB (`KUSTORAGE_MAX_UPLOAD`). Content-Type from the
  request header (fallback `mime.TypeByExtension`).
- The UI uploads at most 3 files in parallel, progress via XHR upload events,
  folder drag-drop maps relative paths to keys.

## Connections & buckets

- Connection `kind`:
  - `r2`: `account_id`, access key, secret → endpoint
    `https://<account_id>.r2.cloudflarestorage.com`, region `auto`.
  - `s3`: arbitrary endpoint, region, `path_style` (bool) — for MinIO etc.
    (and used by integration tests).
- Secrets are encrypted with AES-256-GCM (`cryptx`), never returned to the
  UI (`hasSecret: true`; empty field on edit = unchanged).
- Buckets are registered **manually** per connection (R2 tokens are usually scoped
  per bucket, so `ListBuckets` is denied). The *Discover* button tries
  `ListBuckets` if the token allows it.
- *Test* per bucket: `HeadBucket` + `ListObjectsV2` max-keys 1 + optional PUT/DELETE
  of a probe object (`.ku-storage-probe-<rand>`) to make sure the
  token has write access.
- Removing a bucket registration deletes its grants (confirmation by typing the name,
  validated by the backend). Bucket contents in R2 are not touched.
- minio clients are pooled per connection, invalidated when the connection changes.

## Auth & session

- bcrypt passwords, minimum 10 characters.
- **Server-side sessions** (unlike ku-dump's stateless HMAC tokens, which
  cannot be revoked): 32-byte random token in the cookie
  `ku_storage_session` (HttpOnly, Secure when HTTPS, `SameSite=Strict`),
  of which only the SHA-256 is stored in the DB. 24-hour expiry, extended
  (sliding) while active, absolute max 7 days.
- Disabling a user / resetting a password → deletes all of that user's sessions.
  Grants are read from the DB on every request (in-memory cache ≤ 5 seconds,
  invalidated when grants/groups/users change) → immediate revocation.
- **Invitations**: the admin creates a user (username, name, role, groups) → the server
  creates a single-use invite token valid for 72 hours → the admin copies the link
  `/invite/<token>` and sends it themselves (no email in v1).
  Users set their own password; the admin never knows the password.
  Password reset uses the same mechanism.
- Login rate limit 5 failures / 15 minutes per username+IP (copied from ku-dump).
- CSRF: `SameSite=Strict` + non-GET methods require an `Origin` header matching
  the host (or `KUSTORAGE_PUBLIC_URL`).
- Users can view & end their own active sessions ("log out all
  devices") on the Account page.

## Audit log

One row per action that modifies data or accesses an object, including
denials:

```
audit_log(id, ts, user_id, username, ip, action, bucket_id, bucket_name,
          key, size_bytes, result /*ok|denied|error*/, detail)
```

- `action`: `login`, `login_failed`, `logout`, `object.download`,
  `object.preview`, `object.upload`, `object.overwrite`, `object.delete`,
  `folder.create`, `folder.delete`, `browse.denied`, `user.*`, `group.*`,
  `grant.*`, `connection.*`, `bucket.*`.
- Successful list/browse is **not** recorded (too noisy);
  denials are recorded.
- Folder delete: one summary row (`detail`: object count) +
  the key list stored in `detail` (truncated at 10,000 keys).
- User & bucket names are denormalized so the log stays readable after
  entities are deleted. Default retention 365 days (`KUSTORAGE_AUDIT_DAYS`),
  cleaned up at startup + every 24 hours.
- Admin: filter by user, bucket, action, result, time range; CSV export.

## Data model (SQLite)

```sql
users        (id, username UNIQUE, display_name, password_hash NULL,
              role /*admin|user*/, disabled, created_at, last_login_at)
sessions     (id, token_hash UNIQUE, user_id → users ON DELETE CASCADE,
              ip, user_agent, created_at, last_seen_at, expires_at)
invites      (id, token_hash UNIQUE, user_id → users ON DELETE CASCADE,
              purpose /*invite|reset*/, expires_at, used_at)
groups       (id, name UNIQUE, created_at)
group_members(group_id → groups CASCADE, user_id → users CASCADE,
              PRIMARY KEY (group_id, user_id))
connections  (id, name UNIQUE, kind /*r2|s3*/, account_id, endpoint,
              region, path_style, access_key, secret_enc, created_at)
buckets      (id, connection_id → connections, name, display_name,
              created_at, UNIQUE(connection_id, name))
grants       (id, subject_type /*user|group*/, subject_id, bucket_id →
              buckets CASCADE, prefix, perms INTEGER, created_by,
              created_at, UNIQUE(subject_type, subject_id, bucket_id, prefix))
audit_log    (see above; index ts, user_id, bucket_id)
```

Notes:
- Grants with `subject_type=user` are deleted when the user is deleted, likewise
  for groups — handled in the store layer (polymorphic, not an FK).
- A connection cannot be deleted while it still has registered buckets.
- Opaque external IDs (ku-dump `ids.go` pattern).

## API

All error responses: `{error: "CODE", message: "..."}` (ku-dump pattern).

**Auth & account**

| Method | Path | Function |
|---|---|---|
| GET | `/api/auth/status` | `{needsSetup}` |
| POST | `/api/auth/setup` | create the first admin |
| POST | `/api/auth/login`, `/api/auth/logout` | session |
| GET/POST | `/api/invites/{token}` | check / set password from an invite or reset link |
| GET | `/api/me` | user + role + list of access entry points |
| PUT | `/api/me/password` | change password (old password required) |
| GET/DELETE | `/api/me/sessions`, `/api/me/sessions/{id}` | active sessions |

**Object (user, authz-checked)**

| Method | Path | Function |
|---|---|---|
| GET | `/api/browse?bucket=&prefix=&cursor=` | list folder (real or virtual) + effective perms |
| GET | `/api/objects/stat?bucket=&key=` | object metadata |
| GET | `/api/objects/download?bucket=&key=&inline=0\|1` | 302 to presigned GET |
| PUT | `/api/objects?bucket=&key=&overwrite=0\|1` | stream upload (raw body) |
| POST | `/api/folders` | `{bucket, prefix, name}` create folder |
| POST | `/api/objects/delete` | `{bucket, keys[]}` delete objects & folders (folder = key ending in `/`, recursive) |

**Admin**

| Method | Path | Function |
|---|---|---|
| GET/POST | `/api/admin/users` | list / create users (+ invite link) |
| PUT | `/api/admin/users/{id}` | change name, role, disabled, groups |
| POST | `/api/admin/users/{id}/reset` | password reset link + terminate sessions |
| DELETE | `/api/admin/users/{id}` | delete user |
| GET | `/api/admin/users/{id}/access` | direct grants + via groups (effective access view) |
| GET/POST/PUT/DELETE | `/api/admin/groups[/{id}]` | CRUD groups + members |
| GET/POST/PUT/DELETE | `/api/admin/connections[/{id}]` | CRUD connections |
| POST | `/api/admin/connections/{id}/discover` | `ListBuckets` |
| GET/POST/PUT/DELETE | `/api/admin/buckets[/{id}]` | list / register / modify / remove bucket registrations |
| POST | `/api/admin/buckets/{id}/test` | test read/write access |
| GET/POST/PUT/DELETE | `/api/admin/grants[/{id}]` | CRUD grants (filter by subject / bucket) |
| GET | `/api/admin/audit` , `/api/admin/audit.csv` | audit log + export |

`/api/admin/*` routes are wrapped in the `admin` middleware. All object routes
use a single function `authz.Require(user, bucket, key, perm)` before
calling `s3x` — there is no path to R2 that does not go through this function.

## Frontend

Same stack as ku-dump: Vite + TypeScript + Tailwind 3, TanStack Query
(`staleTime` 30 seconds, no polling), react-router, lucide-react.

| Page | Contents |
|---|---|
| `/setup`, `/login`, `/invite/:token` | admin setup, login, set password |
| `/` | **My Access**: entry point cards (bucket · prefix · permission badge) |
| `/b/:bucketId?prefix=` | **File browser**: breadcrumb, table (name, size, modified, type), per-page sort, "Load more" (cursor), in-page name filter; actions according to perms: Upload (button + file/folder drag-drop), New folder, Download, Preview (image/video/audio/PDF/text in a side panel), Delete (multi-select, confirmation; folder → type the name) |
| `/account` | change password, active sessions |
| `/admin/users` | user table, invite, reset, disable, copy link; detail → effective access |
| `/admin/groups` | CRUD groups + members |
| `/admin/access` | grant list per bucket; form: subject, bucket, prefix (with a folder picker that browses the bucket), permission presets / checkboxes |
| `/admin/connections` | connections + registered buckets, discover, test |
| `/admin/audit` | audit table + filters + CSV export |

Key UX:
- Action buttons that aren't permitted are **hidden** (not disabled)
  so users aren't confused; the server still enforces.
- Uploading to a name that already exists → "Overwrite?" dialog only if the user has
  `update`; without `update` → automatic "Rename" (`name (1).ext`) or
  skip.
- Floating upload queue (per-file progress, retry failed files, cancel).
- The URL stores bucket + prefix so folder links can be shared with
  other users who have access.

## Error handling

| Condition | Response |
|---|---|
| not logged in / session expired | `401 UNAUTHENTICATED` → SPA to `/login` |
| insufficient permission | `403 FORBIDDEN` (+ audit `denied`) |
| invalid key | `400 INVALID_KEY` |
| object already exists (create) | `409 OBJECT_EXISTS` |
| object does not exist (update-only) | `409 OBJECT_MISSING` |
| folder > 10,000 objects | `422 FOLDER_TOO_LARGE` |
| upload > limit | `413 TOO_LARGE` |
| no Content-Length | `411 LENGTH_REQUIRED` |
| R2 rejects credentials / bucket missing | `502 STORAGE_ERROR` with the R2 message (without leaking the secret) |

Uploads that fail midway: minio-go aborts the multipart upload;
as a safety net, document that admins should set up a lifecycle rule
"abort incomplete multipart uploads" in the R2 dashboard.

## Configuration

| Env | Default | Function |
|---|---|---|
| `KUSTORAGE_ADDR` | `:8080` | listen address |
| `KUSTORAGE_DB` | `ku-storage.db` | SQLite path |
| `KUSTORAGE_CRYPT_KEY` | (auto `.ku-storage-key`) | hex 32-byte AES key |
| `KUSTORAGE_PUBLIC_URL` | (empty) | public origin for CSRF checks & invite links; set when behind a reverse proxy |
| `KUSTORAGE_TRUST_PROXY` | `false` | trust `X-Forwarded-For` for IPs in audit & rate limit |
| `KUSTORAGE_MAX_UPLOAD` | `5GiB` | per-file size limit |
| `KUSTORAGE_AUDIT_DAYS` | `365` | audit retention |

Docker: multi-stage (node → go → `gcr.io/distroless/static`), no external
CLI required. Volume `/data` for the DB + key file.

## Security (summary)

- R2 credentials only on the server, encrypted at rest.
- A single centralized authz path; `/`-bounded prefixes; strict key validation.
- Revocable server-side sessions; HttpOnly/Strict cookie; Origin
  check; login rate limit.
- 5-minute presigned GET, issued per request after the permission check;
  content opened from the R2 origin (not the application origin).
- SPA security headers: strict CSP (`default-src 'self'`, `img-src`/
  `media-src`/`frame-src` allow `*.r2.cloudflarestorage.com` for
  preview), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.
- Audit for both successful and denied actions.

## Testing

- **`authz` unit tests** (highest priority, table-driven): prefix
  normalization, `/` boundary (`acme/` vs `acme-evil/`), user+group union, virtual
  navigation, key validation (traversal, `//`, control chars, unicode).
- **`meta` unit tests**: migrations, CRUD, grant cascade, session expiry, single-use
  invites, last-admin protection.
- **API tests** (httptest + fake `s3x`): every object endpoint is tried
  by a user without permission → 403 + audit row.
- **Integration** (`-tags integration`, docker-compose MinIO): conditional
  create/overwrite upload, multipart > 64 MiB, folder delete, presign.
- **R2 smoke** (optional, runs when `R2_TEST_*` env is set): verifies
  `If-None-Match: *`, `If-Match: "<etag>"`, conditionals on multipart, and
  presigned GET against real R2.
- Frontend: `tsc` + build.

## v2 plan (for context, not scope)

Share links (`share` permission, maximum TTL set by admin, recorded in audit),
rename/move/copy, job runner for large recursive operations + folder size
calculation, editing metadata & headers (Content-Type, Cache-Control), downloading
folders as ZIP, direct upload via presigned PUT (requires CORS in the
R2 dashboard).
