#!/usr/bin/env bash
# Chạy osrm-routed trên :5000 từ dữ liệu đã build ở osrm/data/
# Dùng: ./serve.sh [car|bike|foot]   (mặc định car)
set -euo pipefail

PROFILE="${1:-car}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/data"

case "$PROFILE" in
  car)  BASE="$DIR/vietnam-latest.osrm" ;;
  bike) BASE="$DIR/vietnam-latest-bicycle.osrm" ;;
  foot) BASE="$DIR/vietnam-latest-foot.osrm" ;;
  *) echo "Profile không hợp lệ: '$PROFILE' — dùng car | bike | foot"; exit 1 ;;
esac

ls "$BASE"* >/dev/null 2>&1 || { echo "Không thấy $BASE* — hãy chạy ./scripts/build.sh $PROFILE trước"; exit 1; }

exec docker run -t --rm -i -p 5000:5000 -v "$DIR":/data osrm/osrm-backend:latest \
  osrm-routed --algorithm mld "/data/$(basename "$BASE")"
