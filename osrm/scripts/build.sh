#!/usr/bin/env bash
# Build chỉ số OSRM từ osrm/data/vietnam-latest.osm.pbf
# Dùng: ./build.sh [car|bike|foot]   (mặc định car)
set -euo pipefail

PROFILE="${1:-car}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/data"
PBF="$DIR/vietnam-latest.osm.pbf"

case "$PROFILE" in
  car)  LUA="/opt/car.lua" ;;
  bike) LUA="/opt/bicycle.lua" ;;
  foot) LUA="/opt/foot.lua" ;;
  *) echo "Profile không hợp lệ: '$PROFILE' — dùng car | bike | foot"; exit 1 ;;
esac

[ -f "$PBF" ] || { echo "Không thấy $PBF — hãy chạy ./scripts/download.sh trước"; exit 1; }

echo "osrm-extract (profile: $PROFILE)…"
docker run -t --rm -v "$DIR":/data osrm/osrm-backend:latest \
  osrm-extract -p "$LUA" /data/vietnam-latest.osm.pbf

echo "osrm-contract…"
docker run -t --rm -v "$DIR":/data osrm/osrm-backend:latest \
  osrm-contract /data/vietnam-latest.osrm

echo "Xong. Chạy service: ./scripts/serve.sh  (hoặc bật service osrm trong docker-compose.yml)"
