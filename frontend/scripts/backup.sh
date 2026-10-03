#!/usr/bin/env bash
# RideShift backup — chông mat mat do sandbox reset.
# Tạo: (1) tarball toàn bộ source code + git history, (2) snapshot dữ liệu PostgreSQL.
# Lưu 3 lớp:
#   ./backups/                 (trong project, gitignored — tarball lớn)
#   /home/z/rideshift-backups/ (NGOÀI project — sống sót khi project bị reset)
#   db/pg-snapshot-latest.sql  (GIT-TRACKED — sống sót qua repo.tar pre-stop,
#                               dùng để ensure-backend.sh tự khôi phục khi DB trống)
#
#   bash scripts/backup.sh            # chạy backup đầy đủ
#   KEEP=8 bash scripts/backup.sh     # giữ 8 bản gần nhất (mặc định 5)

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
KEEP="${KEEP:-5}"
OUT="$ROOT/backups"
MIRROR="/home/z/rideshift-backups"
SRC_TGZ="$OUT/rideshift-src-$TS.tar.gz"
DB_SQL="$OUT/db-snapshot-$TS.sql"
mkdir -p "$OUT" "$MIRROR"

echo "==> 1/4 DB snapshot"
python3 "$ROOT/scripts/db_snapshot.py" dump "$DB_SQL"

# Bản mới nhất luôn nằm ở đường dẫn git-tracked (survives sandbox reset qua repo.tar).
cp -f "$DB_SQL" "$ROOT/db/pg-snapshot-latest.sql"

echo "==> 2/4 Source tarball (kèm .git, không kèm node_modules/.next/pgdata)"
tar czf "$SRC_TGZ" -C "$ROOT" \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='backups' \
  --exclude='db/pgdata' \
  --exclude='db/pg.log' \
  --exclude='native' \
  --exclude='skills' \
  --exclude='examples' \
  --exclude='upload' \
  --exclude='download' \
  --exclude='tool-results' \
  --exclude='.zscripts' \
  --exclude='*.log' \
  --exclude='*.tsbuildinfo' \
  --exclude='mini-services/fastapi-backend/node_modules' \
  --exclude='mini-services/fastapi-backend/__pycache__' \
  --exclude='*/__pycache__' \
  .

echo "==> 3/4 Mirror ra ngoài project + dọn bản cũ"
cp -f "$SRC_TGZ" "$DB_SQL" "$MIRROR/"
for dir in "$OUT" "$MIRROR"; do
  ls -1t "$dir"/rideshift-src-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
  ls -1t "$dir"/db-snapshot-*.sql 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
done

echo ""
echo "✅ Backup xong:"
ls -lh "$SRC_TGZ" "$DB_SQL" | awk '{print "   " $9 "  (" $5 ")"}'
echo "   Mirror: $MIRROR"
