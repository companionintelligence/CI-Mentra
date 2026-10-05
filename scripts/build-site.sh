#!/usr/bin/env bash
# build-site.sh — assemble site/dist for mentra.ci.computer (Cloudflare Worker assets).
#
#   site/public/*  -> site/dist/          setup guide
#   public/*       -> site/dist/app/      the companion UI, served against the demo BFF
#   public/brand   -> site/dist/brand/    canon tokens for the setup page
#
# The companion UI is copied verbatim so the demo is exactly what the bridge serves.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/site/dist"

rm -rf "$OUT"
mkdir -p "$OUT/app"
cp -R "$ROOT/site/public/." "$OUT/"
cp -R "$ROOT/public/." "$OUT/app/"
cp -R "$ROOT/public/brand" "$OUT/brand"

# Google Analytics 4: no-op unless GA_MEASUREMENT_ID is set to a valid G-XXXX id.
node "$ROOT/scripts/inject-ga.mjs" "$OUT"

echo "built $(find "$OUT" -type f | wc -l | tr -d ' ') files into site/dist"
