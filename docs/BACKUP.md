# Backup & Phục hồi (chống mất mát)

> **Vấn đề:** sandbox nhiều lần bị reset khiến source code + dữ liệu seed mất (Task 17–19, Kaggle pipeline…).
> **Giải pháp:** bộ script backup 4 lớp + **cơ chế tự phục hồi backend** (self-healing) chạy ngay khi mở trang web.

## Các lớp bảo vệ

| Lớp | Vị trí | Nội dung | Sống sót khi… |
|---|---|---|---|
| 1 | Git repo (`.git` trong project) | commit lịch sử source | sandbox giữ project |
| 2 | `db/pg-snapshot-latest.sql` (**git-tracked**) | snapshot DB mới nhất (348 dòng/11 bảng, tiếng Việt) | **sandbox reset — được pre-stop đóng gói vào `repo.tar`** |
| 3 | `backups/` (trong project, gitignored) | tarball 45MB + DB snapshot | thường xuyên |
| 4 | **`/home/z/rideshift-backups/`** (ngoài project) | tarball + DB snapshot | **project bị reset/xoá** |

> Bài học Task 25: `backups/` bị gitignore nên **mất toàn bộ nội dung khi reset**
> (pre-stop chỉ đóng gói file git-tracked). Từ đó bản DB snapshot luôn được sao
> sang `db/pg-snapshot-latest.sql` — đường dẫn git-tracked.

## Cơ chế tự phục hồi (Task 26)

Sandbox **hủy mọi tiến trình nền** sinh ra từ shell session, nhưng các tiến trình con
của **Next.js dev server sinh lúc boot** vẫn sống. Nhờ đó:

```
Trình duyệt mở trang ──► page.tsx ping /api/backend-keepalive (mỗi 45s)
                              │ FastAPI :8000 đã chạy? → {"backend":"up"}
                              └ Chết? → spawn scripts/ensure-backend.sh
                                        (tiến trình con của next-server → KHÔNG bị hủy)
                                          ① cài pip deps nếu thiếu
                                          ② chờ PostgreSQL + tạo DB rideshift
                                          ③ DB rỗng → khôi phục db/pg-snapshot-latest.sql
                                          ④ khởi động uvicorn :8000
```

- `scripts/ensure-backend.sh` — an toàn khi chạy lặp lại (exit sớm nếu API còn sống).
- `.zscripts/dev.sh` — boot path: khởi động backend qua chính script này (không cần mở trình duyệt).
- Nếu thiếu snapshot → lifespan của backend tự `init_db()` + `seed()` (seed tiếng Việt).

## Chạy backup

```bash
bash scripts/backup.sh          # giữ 5 bản gần nhất
KEEP=8 bash scripts/backup.sh   # giữ 8 bản
```

Mỗi lần chạy tạo:
- `backups/rideshift-src-<timestamp>.tar.gz` — toàn bộ source (`src/`, `mini-services/fastapi-backend/`, `prisma/`, `scripts/`, `docs/`, `public/`, `worklog.md`, `.git`…), **không** kèm `node_modules`/`.next`/`db/pgdata`
- `backups/db-snapshot-<timestamp>.sql` — toàn bộ 11 bảng PostgreSQL (dữ liệu tiếng Việt đã dịch, trip records, dataset trend…)
- `db/pg-snapshot-latest.sql` — bản copy git-tracked của DB snapshot (commit kèm source)

## Phục hồi

```bash
bash scripts/restore.sh                                  # bản mới nhất ngoài project
bash scripts/restore.sh <rideshift-src-....tar.gz> [<db-snapshot-....sql>]
```

Sau reset **tự khôi phục** mà không cần làm gì: mở trang → keepalive tự dựng lại
deps + DB + backend. Trường hợp project bị xoá trắng:

```bash
# 1. Khôi phục source (nếu project bị xoá: tạo lại thư mục rồi giải nén tarball vào đó)
bash scripts/restore.sh

# 2. Cài lại phụ thuộc + khởi động
bun install
bash scripts/ensure-backend.sh                          # deps + DB + FastAPI :8000
cd ../.. && bun run dev                                 # Next.js :3000 (đã chạy lúc boot)
```

## Công cụ DB

```bash
python3 scripts/db_snapshot.py tables      # xem bảng + số dòng
python3 scripts/db_snapshot.py dump out.sql
python3 scripts/db_snapshot.py restore out.sql
```

> Lưu ý: bundled PostgreSQL 18 chỉ có `initdb/pg_ctl/postgres` (không có `pg_dump`) —
> snapshot dùng Python `psycopg` tạo INSERT an toàn (bypass FK bằng
> `session_replication_role=replica`), idempotent khi restore.
