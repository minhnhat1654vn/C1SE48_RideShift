#!/usr/bin/env bash
# RideShift restore — phục hồi source code (+ git history) và dữ liệu DB từ bản backup.
#
#   bash scripts/restore.sh                          # dùng bản mới nhất trong /home/z/rideshift-backups
#   bash scripts/restore.sh backups/rideshift-src-20250930-040000.tar.gz [db-snapshot-....sql]
#
# Sau khi chạy: nếu node_modules thiếu → `bun install`; khởi động lại services
# (bun run db:pg:start, uvicorn, bun run dev). Script sẽ tự phục hồi DB nếu server đang chạy.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIRROR="/home/z/rideshift-backups"
OUT="$ROOT/backups"

TGZ="${1:-$(ls -1t "$MIRROR"/rideshift-src-*.tar.gz "$OUT"/rideshift-src-*.tar.gz 2>/dev/null | head -n 1 || true)}"
[ -n "${TGZ:-}" ] && [ -f "$TGZ" ] || { echo "❌ Không tìm thấy tarball backup."; exit 1; }
echo "==> 1/2 Giải nén source: $TGZ"
tar xzf "$TGZ" -C "$ROOT"

# Tìm DB snapshot đi kèm (cùng timestamp nếu có, nếu không dùng bản mới nhất)
SQL="${2:-$(ls -1t "${TGZ/rideshift-src/db-snapshot}" 2>/dev/null | head -n 1 || true)}"
[ -n "${SQL:-}" ] && [ -f "$SQL" ] || SQL="$(ls -1t "$MIRROR"/db-snapshot-*.sql "$OUT"/db-snapshot-*.sql 2>/dev/null | head -n 1 || true)"

if [ -n "${SQL:-}" ] && [ -f "$SQL" ]; then
  if bun --cwd "$ROOT" scripts/postgres.ts status >/dev/null 2>&1; then
    echo "==> 2/2 Phục hồi DB từ: $SQL"
    python3 "$ROOT/scripts/db_snapshot.py" restore "$SQL"
  else
    echo "⚠️  PostgreSQL chưa chạy — KHÔNG phục hồi DB tự động."
    echo "    Chạy sau khi khởi động: bun run db:pg:start && python3 scripts/db_snapshot.py restore '$SQL'"
  fi
else
  echo "⚠️  Không có DB snapshot — chỉ phục hồi source."
fi

echo ""
echo "✅ Restore xong từ $(basename "$TGZ")."
echo "   Bước tiếp theo (nếu môi trường trống):"
echo "     bun install                # nếu thiếu node_modules"
echo "     bun run db:pg:start        # khởi động PostgreSQL"
echo "     python3 scripts/db_snapshot.py restore <db-snapshot.sql>"
echo "     cd mini-services/fastapi-backend && bun run dev   (uvicorn :8000, --reload)"
echo "     bun run dev                (Next.js :3000)"
