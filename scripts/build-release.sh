#!/usr/bin/env bash
# Cross-compiles ku-storage (with the already built SPA in web/dist) and
# packages one archive per platform plus SHA256SUMS into dist/.
# Usage: scripts/build-release.sh v1.0.0
set -euo pipefail

VERSION="${1:?usage: $0 <version>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
TARGETS="linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64"

if ! ls "$ROOT"/web/dist/assets/*.js >/dev/null 2>&1; then
  echo "web/dist is not built; run: npm --prefix web ci && npm --prefix web run build" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"
for target in $TARGETS; do
  os="${target%/*}"
  arch="${target#*/}"
  name="ku-storage_${VERSION}_${os}_${arch}"
  stage="$(mktemp -d)"
  bin="ku-storage"
  [ "$os" = windows ] && bin="ku-storage.exe"
  echo "building $name"
  (cd "$ROOT" && CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath \
    -ldflags "-s -w -X main.version=$VERSION" -o "$stage/$bin" ./cmd/ku-storage)
  cp "$ROOT/README.md" "$stage/"
  if [ "$os" = windows ]; then
    (cd "$stage" && zip -q "$OUT/$name.zip" "$bin" README.md)
  else
    tar -C "$stage" -czf "$OUT/$name.tar.gz" "$bin" README.md
  fi
  rm -rf "$stage"
done
(cd "$OUT" && sha256sum ./*.tar.gz ./*.zip | sed 's#\./##' > SHA256SUMS)
ls -lh "$OUT"
