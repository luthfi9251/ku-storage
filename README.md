# ku-storage

Give other people controlled access to your Cloudflare R2 (or any
S3-compatible) buckets — without handing out R2 tokens.

An admin registers R2 credentials and buckets once. Other users log in to
ku-storage and can only list, upload, overwrite or delete objects in the
bucket folders (prefixes) they were granted. R2 credentials never leave the
server, access can be revoked instantly, and every action is written to an
audit log under the user's name.

One Go process serves the JSON API (`/api/*`) and an embedded React SPA.
Metadata (users, sessions, groups, connections, buckets, grants, audit log)
lives in a local SQLite file. Object data stays in R2.

## Requirements

- Go 1.26+, Node 22+ (build only)
- An R2 API token (Object Read & Write) scoped to the buckets you want to share

## Quick start

    make build
    ./ku-storage    # serves on :8080, metadata in ./ku-storage.db

Open http://localhost:8080 — the first visit asks you to create the admin.
Then, under **Admin**:

1. **Connections** → New connection → kind R2, your Cloudflare account ID,
   access key and secret. Add the buckets (or *Discover buckets* when the
   token may list them) and press **Test** (tick *write* to also try an upload).
2. **Users** → Invite user → copy the invite link and send it yourself. The
   user sets their own password; the link works once and expires after 72h.
3. **Groups** (optional) → bundle users, then grant to the group.
4. **Access** → New grant → user or group, bucket, folder (prefix) and
   permissions.

Buckets are created and configured (CORS, lifecycle, public access) in the
Cloudflare dashboard, not in ku-storage.

## Permissions

| Permission | Allows |
|---|---|
| read | list, download, preview |
| create | upload new objects, create folders |
| update | overwrite existing objects |
| delete | delete objects and folders |

Presets: **Viewer** (read), **Contributor** (+create), **Editor** (+update),
**Manager** (+delete). A grant on `clients/acme/` covers everything below
that folder and nothing else (`clients/acme-old/` is a different folder).
Effective permissions are the union of the user's own grants and those of
their groups. Users with a grant deep in a bucket can navigate down to it
from the bucket root without seeing anything else on the way. Admins can do
everything on every registered bucket.

"Upload new" vs "overwrite" is enforced by R2 itself with conditional writes
(`If-None-Match: *`), so a user with only *create* can never replace a file.

## Configuration

| Env | Default | Purpose |
|---|---|---|
| KUSTORAGE_ADDR | :8080 | listen address |
| KUSTORAGE_DB | ku-storage.db | SQLite metadata path |
| KUSTORAGE_CRYPT_KEY | (auto) | hex 32-byte AES key for stored secrets; else generated `.ku-storage-key` next to the DB |
| KUSTORAGE_PUBLIC_URL | (empty) | public origin, e.g. `https://files.example.com`; set it behind a reverse proxy (used for the CSRF origin check and secure cookies) |
| KUSTORAGE_TRUST_PROXY | false | trust `X-Forwarded-For/Proto/Host` (only behind your own proxy) |
| KUSTORAGE_MAX_UPLOAD | 5GiB | max size per uploaded file |
| KUSTORAGE_AUDIT_DAYS | 365 | audit log retention |

Back up the DB **and** the key file together: without the key the stored R2
secrets cannot be decrypted.

## How it works

- **Uploads** stream through the server (no temp files) with a fixed 64 MiB
  multipart part size, so memory per upload is bounded.
- **Downloads and previews** redirect to a presigned R2 URL valid for 5
  minutes, issued after the permission check. R2 egress is free and the
  server does not carry the bytes; content opens on the R2 origin, so a
  malicious HTML/SVG file cannot touch the ku-storage session. HTML and
  source files preview as plain text.
- **Listings** are never cached or polled (R2 list calls are Class A
  operations); the browser loads 1000 entries per page.
- **Sessions** are stored server-side: disabling a user, resetting their
  password or revoking a grant takes effect on the next request.
- Folder delete is recursive and limited to 10,000 objects per folder.

Tip: add an R2 lifecycle rule "abort incomplete multipart uploads after 1
day" so interrupted large uploads do not leave billable parts behind.

## Development

    make test          # unit + API tests (in-memory storage fake)
    docker compose -f docker-compose.test.yml up -d
    make integration   # s3x against MinIO

`go test -tags integration ./internal/s3x/` also runs against a real R2
bucket — see the header of `internal/s3x/s3x_integration_test.go`.

Design: `docs/superpowers/specs/2026-11-19-ku-storage-v1-design.md`,
API contract: `docs/api.md`.
