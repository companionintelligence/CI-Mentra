#!/usr/bin/env bash
# make-og.sh — regenerate the social share image from its source.
#
#   site/seo/og.svg       source (1200x630: the ring mark, product name and tagline)
#   site/public/og.png    output, 1200x630, quantised to a small palette (about 48 KB);
#                         referenced by og:image / twitter:image in scripts/inject-seo.mjs
#
# Run it after editing the copy in og.svg, then commit both files. The output is committed;
# this is not part of the site build. Needs rsvg-convert (librsvg) and ImageMagick:
# `brew install librsvg imagemagick`. The SVG asks for Helvetica/Arial, so render on a machine
# that has one of them (macOS does) or the text will come out in a fallback font.
# The PNG is stripped of timestamps, so rerunning it on unchanged input gives the same pixels
# and, with the same tool versions, the same bytes. The og:image width and height in
# inject-seo.mjs (1200x630) must match; the site tests check the PNG header.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/../site/seo/og.svg"
OUT="$HERE/../site/public/og.png"

rsvg-convert -w 1200 -h 630 "$SRC" | magick png:- -colors 64 -strip "PNG8:$OUT"
echo "wrote site/public/og.png ($(wc -c < "$OUT" | tr -d ' ') bytes)"
