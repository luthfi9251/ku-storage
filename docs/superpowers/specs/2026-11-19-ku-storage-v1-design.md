# ku-storage v1 — Design

Date: 2026-11-19
Status: Implemented (v1)

## Ringkasan

ku-storage adalah **access broker** untuk object storage Cloudflare R2
(dan S3-compatible lain). Admin mendaftarkan kredensial R2 sekali di
server; user lain login ke ku-storage dan hanya bisa melihat / membuat /
mengubah / menghapus object pada bucket & folder (prefix) yang di-grant
kepadanya. Kredensial R2 tidak pernah keluar dari server, dan setiap aksi
tercatat atas nama user di audit log.

Pain point yang diselesaikan: token R2 hanya bisa dibatasi per bucket,
tidak bisa per folder, tidak membedakan upload vs hapus, dan tidak punya
jejak per orang. Memberi akses ke orang lain berarti membagikan token.

Stack mengikuti ku-dump / ku-crud: Go (single binary, `net/http`
ServeMux) + React SPA di-embed via `embed.FS`, metadata di SQLite
(`modernc.org/sqlite`, tanpa CGO), klien S3 `minio-go/v7`.

## Goals (v1)

1. Admin mendaftarkan koneksi R2 (account ID + access key) dan bucket
   yang boleh dikelola melalui ku-storage
2. Admin mengelola user (undang, nonaktifkan, reset password) dan grup
3. Admin memberi **grant**: user/grup × bucket × prefix × izin
   (`read`, `create`, `update`, `delete`)
4. User menjelajah, upload, menimpa, membuat folder, mengunduh, preview,
   dan menghapus object — dibatasi ketat oleh grant, dicek di server
5. Audit log semua aksi (termasuk yang ditolak), bisa difilter admin
6. Pencabutan akses / nonaktif user berlaku seketika

## Non-goals (v1)

- **Membuat / menghapus / mengonfigurasi bucket** — dilakukan di
  dashboard Cloudflare (keputusan produk, bukan sekadar ditunda)
- Share link / presigned URL untuk pihak di luar ku-storage (v2)
- Rename / move / copy object, operasi rekursif besar sebagai job (v2)
- Edit metadata object, download folder sebagai ZIP (v2)
- SSO/OIDC, 2FA, kuota upload, delegasi grant oleh non-admin (v3)
- Versioning, ACL, bucket policy, object tagging (tidak didukung R2)
- Upload resumable

## Arsitektur

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
│  │ groups, connections, buckets,│  │ per koneksi      │  │
│  │ grants, audit_log            │  │ (minio-go)       │  │
│  └──────────────────────────────┘  └─────────┬────────┘  │
└──────────────────────────────────────────────┼───────────┘
                                               │ S3 API
         browser ── presigned GET (302) ──→ Cloudflare R2
```

- **Upload** selalu lewat server (stream, tanpa file temp) — server
  adalah titik penegakan izin; user tidak pernah memegang kredensial
  yang bisa menulis key sembarang.
- **Download / preview** lewat redirect 302 ke presigned GET berumur
  pendek, diterbitkan *setelah* izin dicek. Egress R2 gratis, server tidak
  menanggung bandwidth, Range request (video) jalan, dan konten dibuka
  dari origin R2 sehingga HTML/SVG berbahaya tidak bisa menyentuh session
  ku-storage.
- **Listing** tidak di-cache di SQLite; R2 adalah sumber kebenaran.
  (ListObjects = operasi Class A berbayar → tidak ada polling/auto-refresh.)

### Package layout

| Package | Tanggung jawab |
|---|---|
| `cmd/ku-storage` | entrypoint: config env, wiring, serve |
| `internal/config` | env config (pola ku-dump) |
| `internal/cryptx` | AES-256-GCM untuk secret koneksi (salin dari ku-dump) |
| `internal/meta` | SQLite store + migrasi: users, sessions, invites, groups, connections, buckets, grants, audit |
| `internal/authz` | **inti**: normalisasi & validasi key/prefix, evaluasi izin efektif, navigasi virtual. Pure function, tanpa I/O, diuji tabel |
| `internal/s3x` | wrapper minio-go: pool client per koneksi, list, put kondisional, stat, delete batch, presign, discover bucket |
| `internal/api` | handler HTTP, middleware session/admin/CSRF, audit hook |
| `web/` | React SPA + `embed.go` |

## Model akses

### Role aplikasi
- `admin` — mengelola koneksi, bucket, user, grup, grant; melihat audit;
  punya seluruh izin di semua bucket terdaftar (tetap tercatat di audit).
- `user` — hanya melihat & bertindak sesuai grant.

User pertama dibuat lewat halaman setup (pola ku-dump) dan otomatis admin.
Minimal satu admin aktif harus selalu ada (server menolak demote/disable
admin terakhir).

### Izin

| Izin | Operasi |
|---|---|
| `read` | list, stat, download, preview |
| `create` | upload ke key yang **belum ada**, buat folder |
| `update` | menimpa object yang **sudah ada** |
| `delete` | hapus object / folder |

Disimpan sebagai bitmask. Preset di UI: **Viewer** (read),
**Contributor** (read+create), **Editor** (read+create+update),
**Manager** (read+create+update+delete). `create`/`update`/`delete` tanpa
`read` ditolak saat menyimpan grant (UI tidak bisa dipakai tanpa list).

### Grant

```
grant = subject (user | group) × bucket × prefix × perms
```

- `prefix` dinormalisasi: kosong (= seluruh bucket) atau diakhiri `/`.
  Contoh: `clients/acme/`. Ini menjamin batas folder — grant
  `clients/acme/` **tidak** mencakup `clients/acme-evil/x`.
- **Izin efektif** user pada `(bucket, key)` = OR dari `perms` semua grant
  milik user tersebut + grup-grupnya di bucket itu, dengan
  `strings.HasPrefix(key, grant.prefix)`.
- Konsekuensi (monoton): izin pada key di dalam folder F selalu ⊇ izin
  pada F. Jadi cek izin pada folder cukup untuk operasi atas seluruh isi
  folder tersebut (dipakai oleh hapus folder).
- Unik per `(subject, bucket, prefix)`; menyimpan ulang = update perms.

### Navigasi virtual

User dengan grant `clients/acme/reports/` boleh "melihat jalan" dari root
bucket tanpa melihat isi lain:

- `GET /api/browse?bucket=B&prefix=P`
  - Jika P tercakup grant `read` → list ke R2 (delimiter `/`, max 1000,
    continuation token). Setiap folder di hasil diberi `perms` efektifnya
    (bisa lebih besar bila ada grant lebih dalam).
  - Jika P **bukan** tercakup tetapi merupakan leluhur dari prefix grant
    → **tanpa memanggil R2**, kembalikan folder sintetis menuju grant
    tersebut (mis. di root: `clients/`; di `clients/`: `acme/`).
  - Selain itu → `403 FORBIDDEN` (dan diaudit sebagai `denied`).
- Halaman awal user ("Akses Saya") menampilkan daftar titik masuk:
  setiap pasangan (bucket, prefix) grant yang tidak berada di dalam grant
  lain miliknya.

### Validasi key

Ditolak dengan `400 INVALID_KEY` bila:
- bukan UTF-8 valid, panjang > 1024 byte, atau kosong
- diawali `/`, mengandung `//`, segmen `.` atau `..`
- mengandung karakter kontrol (`< 0x20`, `0x7f`) atau `\`

Folder = object 0 byte dengan key berakhiran `/`. Nama file/folder baru
dari UI divalidasi dengan aturan yang sama sebelum digabung dengan prefix.

## Operasi object & penegakan izin

| Operasi | Izin yang dicek | Implementasi R2 |
|---|---|---|
| List | `read` pada prefix | `ListObjectsV2` delimiter `/`, max 1000 |
| Stat | `read` | `HeadObject` |
| Download / preview | `read` | presigned GET 5 menit, `response-content-disposition` = `attachment` (download) atau `inline` (preview), 302 |
| Upload baru | `create` | `PutObject` + `If-None-Match: *` → 412 dipetakan ke `409 OBJECT_EXISTS` |
| Timpa (`overwrite=1`) | `update` (+`create` jika ternyata key belum ada) | punya create+update → PUT biasa; hanya update → `HeadObject` lalu PUT dengan `If-Match: "<etag>"` (key tidak ada → `409 OBJECT_MISSING`, berubah di tengah → `409 CONFLICT`) |
| Buat folder | `create` pada folder baru | PUT 0 byte `prefix/nama/` + `If-None-Match: *` |
| Hapus object (bulk, ≤1000 key) | `delete` pada setiap key | `DeleteObjects` |
| Hapus folder | `delete` pada prefix folder | list rekursif + `DeleteObjects` per 1000, sinkron, **maks 10.000 object** per request (lebih → `422 FOLDER_TOO_LARGE`, akan ditangani job di v2) |

Catatan:
- R2 mengevaluasi `If-None-Match: *` secara atomik terhadap state bucket
  (juga pada `CompleteMultipartUpload`) — tidak ada race create vs create.
  minio-go: `PutObjectOptions.SetMatchETagExcept("*")` /
  `SetMatchETag("*")`; header ikut ke `CompleteMultipartUpload`.
- Implementasi memakai `If-Match: "<etag>"` (bukan `If-Match: *`) agar
  tidak bergantung pada dukungan wildcard. Sudah diverifikasi terhadap
  MinIO (termasuk multipart kondisional). **Masih perlu dijalankan sekali
  terhadap R2 asli** (`go test -tags integration ./internal/s3x/` dengan
  env `KUSTORAGE_TEST_KIND=r2`), terutama header kondisional pada
  multipart.
- Upload: satu file per request `PUT /api/objects?bucket=&key=` dengan
  body mentah + `Content-Length` wajib (size diketahui → minio-go memilih
  part size tetap; part size di-set eksplisit 64 MiB agar memori per
  upload terbatas dan memenuhi syarat R2 bahwa part berukuran seragam).
  Batas ukuran default 5 GiB (`KUSTORAGE_MAX_UPLOAD`). Content-Type dari
  header request (fallback `mime.TypeByExtension`).
- UI mengunggah paralel maks 3 file, progress via XHR upload events,
  drag-drop folder memetakan path relatif menjadi key.

## Koneksi & bucket

- Koneksi `kind`:
  - `r2`: `account_id`, access key, secret → endpoint
    `https://<account_id>.r2.cloudflarestorage.com`, region `auto`.
  - `s3`: endpoint bebas, region, `path_style` (bool) — untuk MinIO dsb.
    (dan dipakai integration test).
- Secret dienkripsi AES-256-GCM (`cryptx`), tidak pernah dikembalikan ke
  UI (`hasSecret: true`; field kosong saat edit = tidak diubah).
- Bucket didaftarkan **manual** per koneksi (token R2 umumnya di-scope
  per bucket sehingga `ListBuckets` ditolak). Tombol *Discover* mencoba
  `ListBuckets` bila token mengizinkan.
- *Test* per bucket: `HeadBucket` + `ListObjectsV2` max-keys 1 + PUT/DELETE
  object probe opsional (`.ku-storage-probe-<rand>`) untuk memastikan
  token punya akses tulis.
- Menghapus pendaftaran bucket menghapus grant-nya (konfirmasi ketik nama,
  divalidasi backend). Isi bucket di R2 tidak disentuh.
- Client minio di-pool per koneksi, di-invalidate saat koneksi diubah.

## Auth & session

- Password bcrypt, minimal 10 karakter.
- **Session server-side** (beda dari token HMAC stateless ku-dump, yang
  tidak bisa dicabut): token acak 32 byte di cookie
  `ku_storage_session` (HttpOnly, Secure bila HTTPS, `SameSite=Strict`),
  yang disimpan di DB hanya SHA-256-nya. Expiry 24 jam, diperpanjang
  (sliding) bila aktif, absolut maks 7 hari.
- Nonaktifkan user / reset password → hapus semua session user itu.
  Grant dibaca dari DB setiap request (cache in-memory ≤ 5 detik,
  di-invalidate saat grant/grup/user berubah) → pencabutan seketika.
- **Undangan**: admin membuat user (username, nama, role, grup) → server
  membuat invite token sekali pakai berlaku 72 jam → admin menyalin link
  `/invite/<token>` dan mengirimkannya sendiri (tidak ada email di v1).
  User mengatur password sendiri; admin tidak pernah tahu password.
  Reset password memakai mekanisme yang sama.
- Rate limit login 5 gagal / 15 menit per username+IP (salin dari ku-dump).
- CSRF: `SameSite=Strict` + method non-GET wajib header `Origin` yang sama
  dengan host (atau `KUSTORAGE_PUBLIC_URL`).
- User dapat melihat & mengakhiri session aktifnya sendiri ("logout semua
  perangkat") di halaman Akun.

## Audit log

Satu baris per aksi yang mengubah data atau mengakses object, termasuk
penolakan:

```
audit_log(id, ts, user_id, username, ip, action, bucket_id, bucket_name,
          key, size_bytes, result /*ok|denied|error*/, detail)
```

- `action`: `login`, `login_failed`, `logout`, `object.download`,
  `object.preview`, `object.upload`, `object.overwrite`, `object.delete`,
  `folder.create`, `folder.delete`, `browse.denied`, `user.*`, `group.*`,
  `grant.*`, `connection.*`, `bucket.*`.
- List/browse yang berhasil **tidak** dicatat (terlalu bising);
  penolakannya dicatat.
- Hapus folder: satu baris ringkasan (`detail`: jumlah object) +
  daftar key disimpan di `detail` (dipotong 10.000 key).
- Nama user & bucket di-denormalisasi agar log tetap terbaca setelah
  entitas dihapus. Retensi default 365 hari (`KUSTORAGE_AUDIT_DAYS`),
  dibersihkan saat startup + setiap 24 jam.
- Admin: filter by user, bucket, action, result, rentang waktu; ekspor CSV.

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
audit_log    (lihat di atas; index ts, user_id, bucket_id)
```

Catatan:
- Grant dengan `subject_type=user` dihapus saat user dihapus, grup
  sama — ditangani di layer store (polimorfik, bukan FK).
- Koneksi tidak bisa dihapus selama masih punya bucket terdaftar.
- ID eksternal opaque (pola `ids.go` ku-dump).

## API

Semua respons error: `{error: "CODE", message: "..."}` (pola ku-dump).

**Auth & akun**

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/auth/status` | `{needsSetup}` |
| POST | `/api/auth/setup` | buat admin pertama |
| POST | `/api/auth/login`, `/api/auth/logout` | session |
| GET/POST | `/api/invites/{token}` | cek / set password dari link undangan atau reset |
| GET | `/api/me` | user + role + daftar titik masuk akses |
| PUT | `/api/me/password` | ganti password (wajib password lama) |
| GET/DELETE | `/api/me/sessions`, `/api/me/sessions/{id}` | session aktif |

**Object (user, dicek authz)**

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/browse?bucket=&prefix=&cursor=` | list folder (nyata atau virtual) + perms efektif |
| GET | `/api/objects/stat?bucket=&key=` | metadata object |
| GET | `/api/objects/download?bucket=&key=&inline=0\|1` | 302 ke presigned GET |
| PUT | `/api/objects?bucket=&key=&overwrite=0\|1` | upload stream (body mentah) |
| POST | `/api/folders` | `{bucket, prefix, name}` buat folder |
| POST | `/api/objects/delete` | `{bucket, keys[]}` hapus object & folder (folder = key berakhiran `/`, rekursif) |

**Admin**

| Method | Path | Fungsi |
|---|---|---|
| GET/POST | `/api/admin/users` | list / buat user (+ link undangan) |
| PUT | `/api/admin/users/{id}` | ubah nama, role, disabled, grup |
| POST | `/api/admin/users/{id}/reset` | link reset password + putus session |
| DELETE | `/api/admin/users/{id}` | hapus user |
| GET | `/api/admin/users/{id}/access` | grant langsung + via grup (tampilan akses efektif) |
| GET/POST/PUT/DELETE | `/api/admin/groups[/{id}]` | CRUD grup + anggota |
| GET/POST/PUT/DELETE | `/api/admin/connections[/{id}]` | CRUD koneksi |
| POST | `/api/admin/connections/{id}/discover` | `ListBuckets` |
| GET/POST/PUT/DELETE | `/api/admin/buckets[/{id}]` | daftar / daftarkan / ubah / hapus pendaftaran bucket |
| POST | `/api/admin/buckets/{id}/test` | uji akses baca/tulis |
| GET/POST/PUT/DELETE | `/api/admin/grants[/{id}]` | CRUD grant (filter by subject / bucket) |
| GET | `/api/admin/audit` , `/api/admin/audit.csv` | audit log + ekspor |

Route `/api/admin/*` dibungkus middleware `admin`. Semua route object
memakai satu fungsi `authz.Require(user, bucket, key, perm)` sebelum
memanggil `s3x` — tidak ada jalur ke R2 yang tidak melewati fungsi ini.

## Frontend

Stack sama dengan ku-dump: Vite + TypeScript + Tailwind 3, TanStack Query
(`staleTime` 30 detik, tanpa polling), react-router, lucide-react.

| Halaman | Isi |
|---|---|
| `/setup`, `/login`, `/invite/:token` | setup admin, login, set password |
| `/` | **Akses Saya**: kartu titik masuk (bucket · prefix · badge izin) |
| `/b/:bucketId?prefix=` | **File browser**: breadcrumb, tabel (nama, ukuran, diubah, tipe), sort per halaman, "Muat lagi" (cursor), filter nama di halaman; aksi sesuai perms: Upload (tombol + drag-drop file/folder), Folder baru, Download, Preview (gambar/video/audio/PDF/teks di panel samping), Hapus (multi-select, konfirmasi; folder → ketik nama) |
| `/account` | ganti password, session aktif |
| `/admin/users` | tabel user, undang, reset, nonaktifkan, salin link; detail → akses efektif |
| `/admin/groups` | CRUD grup + anggota |
| `/admin/access` | daftar grant per bucket; form: subject, bucket, prefix (dengan picker folder yang membrowse bucket), preset izin / checkbox |
| `/admin/connections` | koneksi + bucket terdaftar, discover, test |
| `/admin/audit` | tabel audit + filter + ekspor CSV |

UX kunci:
- Tombol aksi yang tidak diizinkan **disembunyikan** (bukan disabled)
  agar user tidak bingung; server tetap menegakkan.
- Upload ke nama yang sudah ada → dialog "Timpa?" hanya bila punya
  `update`; tanpa `update` → "Ganti nama" otomatis (`nama (1).ext`) atau
  lewati.
- Antrian upload melayang (progress per file, retry file gagal, batal).
- URL menyimpan bucket + prefix sehingga link folder bisa dibagikan ke
  user lain yang punya akses.

## Error handling

| Kondisi | Respons |
|---|---|
| tidak login / session habis | `401 UNAUTHENTICATED` → SPA ke `/login` |
| izin kurang | `403 FORBIDDEN` (+ audit `denied`) |
| key tidak valid | `400 INVALID_KEY` |
| object sudah ada (create) | `409 OBJECT_EXISTS` |
| object tidak ada (update-only) | `409 OBJECT_MISSING` |
| folder > 10.000 object | `422 FOLDER_TOO_LARGE` |
| upload > batas | `413 TOO_LARGE` |
| tanpa Content-Length | `411 LENGTH_REQUIRED` |
| R2 menolak kredensial / bucket hilang | `502 STORAGE_ERROR` dengan pesan R2 (tanpa membocorkan secret) |

Upload yang gagal di tengah: minio-go meng-abort multipart upload;
sebagai jaring pengaman, dokumentasikan agar admin memasang lifecycle rule
"abort incomplete multipart uploads" di dashboard R2.

## Konfigurasi

| Env | Default | Fungsi |
|---|---|---|
| `KUSTORAGE_ADDR` | `:8080` | listen address |
| `KUSTORAGE_DB` | `ku-storage.db` | path SQLite |
| `KUSTORAGE_CRYPT_KEY` | (auto `.ku-storage-key`) | hex 32 byte AES key |
| `KUSTORAGE_PUBLIC_URL` | (kosong) | origin publik untuk cek CSRF & link undangan; set bila di belakang reverse proxy |
| `KUSTORAGE_TRUST_PROXY` | `false` | percaya `X-Forwarded-For` untuk IP di audit & rate limit |
| `KUSTORAGE_MAX_UPLOAD` | `5GiB` | batas ukuran per file |
| `KUSTORAGE_AUDIT_DAYS` | `365` | retensi audit |

Docker: multi-stage (node → go → `gcr.io/distroless/static`), tidak butuh
CLI eksternal. Volume `/data` untuk DB + key file.

## Keamanan (ringkasan)

- Kredensial R2 hanya di server, dienkripsi at-rest.
- Satu jalur authz terpusat; prefix ber-batas `/`; validasi key ketat.
- Session server-side yang bisa dicabut; cookie HttpOnly/Strict; cek
  Origin; rate limit login.
- Presigned GET 5 menit, diterbitkan per request setelah cek izin;
  konten dibuka dari origin R2 (bukan origin aplikasi).
- Header keamanan SPA: CSP ketat (`default-src 'self'`, `img-src`/
  `media-src`/`frame-src` mengizinkan `*.r2.cloudflarestorage.com` untuk
  preview), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.
- Audit untuk aksi berhasil maupun ditolak.

## Testing

- **Unit `authz`** (prioritas tertinggi, table-driven): normalisasi
  prefix, batas `/` (`acme/` vs `acme-evil/`), union user+grup, navigasi
  virtual, validasi key (traversal, `//`, kontrol, unicode).
- **Unit `meta`**: migrasi, CRUD, cascade grant, session expiry, invite
  sekali pakai, proteksi admin terakhir.
- **API tests** (httptest + fake `s3x`): setiap endpoint object dicoba
  oleh user tanpa izin → 403 + baris audit.
- **Integration** (`-tags integration`, docker-compose MinIO): upload
  create/overwrite kondisional, multipart > 64 MiB, hapus folder, presign.
- **Smoke R2** (opsional, jalan bila env `R2_TEST_*` di-set): verifikasi
  `If-None-Match: *`, `If-Match: "<etag>"`, conditional pada multipart, dan
  presigned GET terhadap R2 asli.
- Frontend: `tsc` + build.

## Rencana v2 (untuk konteks, bukan scope)

Share link (izin `share`, TTL maksimum diatur admin, tercatat audit),
rename/move/copy, job runner untuk operasi rekursif besar + hitung ukuran
folder, edit metadata & header (Content-Type, Cache-Control), download
folder sebagai ZIP, upload langsung via presigned PUT (butuh CORS di
dashboard R2).
