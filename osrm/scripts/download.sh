#!/usr/bin/env bash
# Tải bản trích xuất OSM Việt Nam từ Geofabrik (~700 MB) vào osrm/data/
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/data"
mkdir -p "$DIR"

URL="${OSM_PBF_URL:-https://download.geofabrik.de/asia/vietnam-latest.osm.pbf}"
OUT="$DIR/vietnam-latest.osm.pbf"

echo "Downloading $URL"
curl -L --fail --retry 3 -o "$OUT" "$URL"
echo "Saved: $OUT ($(du -h "$OUT" | cut -f1))"
echo "Next:  ./scripts/build.sh car   (hoặc bike | foot)"
