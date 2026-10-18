#!/bin/bash
# Convert the Helicopter Pack's Unity captures into the site's WebP images.
#   bash tools/helicopter-images.sh          HELI=<path> points at another pack project
# Per aircraft (Source/renders/unity): <id>-<view>-1280.webp and -720.webp for front34, side, rear34, hover.
# Store shots (Store/Screenshots, Store/KeyImages): lineup, fleet, lods, cockpit at 1600 and 800, plus og.jpg.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HELI="${HELI:-$HERE/../../../Helicopter Pack}"
OUT="$HERE/../public/assets/img/helicopters"
mkdir -p "$OUT"
webp() { magick "$1" -resize "$2x" -strip -quality 80 -define webp:method=6 "$3"; }
for f in "$HELI"/Source/renders/unity/*_*.png; do
  base="$(basename "$f" .png)"; id="${base%_*}"; view="${base##*_}"
  webp "$f" 1280 "$OUT/$id-$view-1280.webp"
  webp "$f" 720 "$OUT/$id-$view-720.webp"
done
for shot in lineup fleet lods cockpit; do
  webp "$HELI/Store/Screenshots/$shot.png" 1600 "$OUT/$shot-1600.webp"
  webp "$HELI/Store/Screenshots/$shot.png" 800 "$OUT/$shot-800.webp"
done
webp "$HELI/Store/KeyImages/cover_1950x1300.png" 1600 "$OUT/cover-1600.webp"
webp "$HELI/Store/KeyImages/cover_1950x1300.png" 800 "$OUT/cover-800.webp"
magick "$HELI/Store/KeyImages/social_1200x630.png" -strip -quality 84 "$OUT/og.jpg"
echo "$(ls "$OUT" | wc -l | tr -d ' ') images in $OUT"
