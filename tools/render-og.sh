#!/bin/bash
# Renders the social preview (public/assets/og.jpg) from the home page hero. Needs the dev server
# running (npm run dev) and Google Chrome.
set -e
cd "$(dirname "$0")/.."
URL="${URL:-http://localhost:8742/?og}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT
"$CHROME" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
  --user-data-dir="$PROFILE" --force-device-scale-factor=1 --virtual-time-budget=15000 \
  --window-size=1200,630 --screenshot=".cache/og.png" "$URL" >/dev/null 2>&1
sips -s format jpeg -s formatOptions 88 .cache/og.png --out public/assets/og.jpg >/dev/null
echo public/assets/og.jpg
