#!/bin/bash
# Rebuild the web models from the Everyday Cars FBX files (Blender 5.x on PATH).
#   npm run models                 all vehicles
#   npm run models -- Sedan Van    some of them
# Files are gzipped here because GitHub Pages does not compress binary types; the site inflates them
# with DecompressionStream (src/three/fetch.js).
set -e
cd "$(dirname "$0")/.."
SRC="${MODELS:-../Assets/Everyday Cars - Low Poly Vehicle Pack/Models}"
# vehicle sizes and triangle counts come from the pack's build metadata
META="${META:-../Source/build/meta}"
OUT=public/models/everyday-cars
RAW=.cache/models
mkdir -p "$RAW" "$OUT"
blender -b --factory-startup --python tools/export_vehicles.py -- "$SRC" "$RAW" "$@" 2>&1 | grep -E "exported|Error|Traceback"
for f in "$RAW"/*.glb; do
  case "$f" in *.opt.glb) continue;; esac
  n=$(basename "$f" .glb)
  npx gltf-transform meshopt "$f" "$RAW/$n.opt.glb" --level high > /dev/null
  gzip -9 -n -c "$RAW/$n.opt.glb" > "$OUT/$n.glb.gz"
done
for f in "$RAW"/*.wire.bin; do
  gzip -9 -n -c "$f" > "$OUT/$(basename "$f").gz"
done
python3 tools/vehicle_data.py "$META" "$RAW" src/data/everyday-cars.json
ls -l "$OUT" | awk 'NR>1 {printf "%-28s %5dK\n", $9, $5/1024}'
