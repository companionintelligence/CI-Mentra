#!/usr/bin/env bash
# vendor-brand.sh — pull the pinned Companion Intelligence brand bundle into public/brand/.
#
# CI-Mentra serves a static public/ from Express; the browser bundle should not depend on node_modules — so it consumes the canon
# as the brand bundle CI-Common attaches to every @companionintelligence/tokens release
# (see CI-Common/CONSUMING.md, Route B). Only tokens.css / tokens.json are vendored.
#
#   scripts/vendor-brand.sh [version]     # default: the version in public/brand/.version
#   scripts/vendor-brand.sh --check       # verify the vendored files against SHA256SUMS (CI)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../public/brand"
if [ "${1:-}" = "--check" ]; then
  ( cd "$OUT" && shasum -a 256 -c SHA256SUMS --quiet ) && echo "✔ brand assets match ci-brand $(cat "$OUT/.version")"
  exit $?
fi
VERSION="${1:-$(cat "$OUT/.version")}"
TAG="@companionintelligence/tokens@${VERSION}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
gh release download "$TAG" --repo companionintelligence/CI-Common --pattern "ci-brand-${VERSION}.tar.gz*" --dir "$tmp"
( cd "$tmp" && shasum -a 256 -c "ci-brand-${VERSION}.tar.gz.sha256" --quiet )
tar -xzf "$tmp/ci-brand-${VERSION}.tar.gz" -C "$tmp"
B="$tmp/ci-brand-${VERSION}"
mkdir -p "$OUT/tokens"
cp "$B/tokens/tokens.css" "$B/tokens/tokens.json" "$OUT/tokens/"
grep -E 'tokens/tokens\.(css|json)' "$B/SHA256SUMS" > "$OUT/SHA256SUMS"
echo "$VERSION" > "$OUT/.version"
( cd "$OUT" && shasum -a 256 -c SHA256SUMS --quiet )
echo "vendored ci-brand ${VERSION} into public/brand"
