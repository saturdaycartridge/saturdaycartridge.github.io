#!/bin/bash
# Rebuild the web models from the Helicopter Pack FBX files (Blender 5.x).
#   npm run helicopters                      all aircraft
#   npm run helicopters -- RescueTwin        some of them
# HELI=<path> points at another pack project. Files are gzipped because GitHub Pages does not compress
# binary types; the site inflates them with DecompressionStream (src/three/fetch.js).
set -euo pipefail
cd "$(dirname "$0")/.."
HELI="${HELI:-../../Helicopter Pack}"
BLENDER="${BLENDER:-$(command -v blender || echo /Applications/Blender.app/Contents/MacOS/Blender)}"
SRC="$HELI/Assets/RotorTrail - Helicopter Pack/Models"
MATS="$HELI/Source/build/materials.json"
OUT=public/models/helicopters
RAW=.cache/helicopters
mkdir -p "$RAW" "$OUT"
"$BLENDER" -b --factory-startup --python tools/export_helicopters.py -- "$SRC" "$RAW" "$@" 2>&1 | grep -E "exported|Error|Traceback"
for f in "$RAW"/*.meta.json; do
  n=$(basename "$f" .meta.json)
  if [ $# -gt 0 ] && [[ " $* " != *" $n "* ]]; then continue; fi
  for part in lite lod0; do
    node tools/pack_helicopters.mjs "$MATS" "$RAW/$n.$part.glb" "$RAW/$n.$part.opt.glb"
    gzip -9 -n -c "$RAW/$n.$part.opt.glb" > "$OUT/$n.$part.glb.gz"
    gzip -9 -n -c "$RAW/$n.$part.wire.bin" > "$OUT/$n.$part.wire.bin.gz"
  done
done
HELI="$HELI" python3 tools/helicopter_data.py "$RAW"
ls -l "$OUT" | awk 'NR>1 {printf "%-36s %5dK\n", $9, $5/1024}'
