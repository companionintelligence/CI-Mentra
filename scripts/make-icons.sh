#!/usr/bin/env bash
# make-icons.sh — regenerate the raster icons in site/public/ from the ring mark.
#
#   site/public/icon.svg           source (transparent, same mark as the in-page logo)
#   site/public/favicon.ico        16 + 32 + 48 px, transparent
#   site/public/icon-192.png       web manifest icon, on the page background
#   site/public/icon-512.png       web manifest icon, on the page background
#   site/public/apple-touch-icon.png   180 px, on the page background (iOS ignores alpha)
#
# The outputs are committed; this is not part of the site build. Needs rsvg-convert
# (librsvg) and ImageMagick: `brew install librsvg imagemagick`.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../site/public"
BG="#0a1312"   # --bg in site.css (dark)
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# Opaque tile: the mark at ~62% of the tile, centred, on the dark page background.
tile() { # size out
  local size="$1" out="$2" mark=$(( $1 * 62 / 100 ))
  rsvg-convert -w "$mark" -h "$mark" "$OUT/icon.svg" -o "$tmp/mark.png"
  magick -size "${size}x${size}" "xc:$BG" "$tmp/mark.png" -gravity center -composite -strip "PNG24:$out"
}
tile 192 "$OUT/icon-192.png"
tile 512 "$OUT/icon-512.png"
tile 180 "$OUT/apple-touch-icon.png"

for s in 16 32 48; do rsvg-convert -w "$s" -h "$s" "$OUT/icon.svg" -o "$tmp/f$s.png"; done
magick "$tmp/f16.png" "$tmp/f32.png" "$tmp/f48.png" "$OUT/favicon.ico"
echo "wrote icons into site/public"
