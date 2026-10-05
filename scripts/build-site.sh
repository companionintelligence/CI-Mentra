#!/usr/bin/env bash
# build-site.sh — assemble site/dist for mentra.ci.computer (Cloudflare Worker assets).
#
#   site/public/*  -> site/dist/          setup guide
#   public/*       -> site/dist/app/      the companion UI, served against the demo BFF
#   public/brand   -> site/dist/brand/    canon tokens for the setup page
#
# The companion UI is copied verbatim so the demo is exactly what the bridge serves; the only
# additions are the build-time steps below (demo bar and footer, SEO, analytics, fingerprints).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/site/dist"

rm -rf "$OUT"
mkdir -p "$OUT/app"
cp -R "$ROOT/site/public/." "$OUT/"
cp -R "$ROOT/public/." "$OUT/app/"
cp -R "$ROOT/public/brand" "$OUT/brand"

# Demo chrome for /app/ only: links to ci.computer, docs, Buy Companion Core, Download Companion.
# Must run before inject-ga.mjs, which reveals the footer's analytics notice.
node "$ROOT/scripts/inject-crosslinks.mjs" "$OUT"

# Google Analytics 4: no-op unless GA_MEASUREMENT_ID is set to a valid G-XXXX id.
node "$ROOT/scripts/inject-ga.mjs" "$OUT"

# SEO: title, canonical, icons, OG/Twitter, JSON-LD on every page, sitemap.xml, robots.txt (idempotent).
node "$ROOT/scripts/inject-seo.mjs" "$OUT"

# Fingerprint local CSS/JS references (?v=<hash>) so the Worker can cache them as immutable.
# Last, after every step that edits HTML or writes a script.
node "$ROOT/scripts/version-assets.mjs" "$OUT"

echo "built $(find "$OUT" -type f | wc -l | tr -d ' ') files into site/dist"
