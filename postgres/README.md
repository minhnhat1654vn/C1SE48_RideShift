# postgres/ — Tài sản database

Thư mục này chứa mọi thứ liên quan đến **PostgreSQL 16 + PostGIS** của RideShift.
Schema được backend FastAPI **sở hữu và tự đảm bảo** khi khởi động — các file dưới đây
phục vụ khởi tạo container và khôi phục dữ liệu mẫu.

## Nội dung

| Đường dẫn | Vai trò |
|---|---|
| `init/01_schema.sql` | Schema đầy đủ (`CREATE TABLE IF NOT EXISTS` — idempotent). Docker mount vào `/docker-entrypoint-initdb.d` → chạy **tự động lần đầu** khi container db khởi tạo. Bản sao đồng bộ của `backend/app/schema.sql`. |
| `snapshot/rideshift-snapshot-latest.sql` | Ảnh dữ liệu mẫu (TRUNCATE + INSERT: admin, phương tiện, vùng LEZ, quy định, trọng số, địa điểm, chuyến đi demo…). Dùng để restore nhanh cho demo. |

> Lưu ý PostGIS: khi extension khả dụng, `backend/app/db.py` sẽ thêm cột
> `geometry(Polygon, 4326)` + GIST index cho `lez_zone`. JSON `coordinates`
> ([lat, lng] pairs) luôn là **nguồn chuẩn** — thiếu PostGIS hệ thống vẫn chạy được
> (phân tích không gian chạy trong Python/Shapely).

## Restore dữ liệu mẫu

Từ thư mục gốc repo (đang chạy `docker compose up`):

```bash
docker compose exec -T db psql -U postgres -d rideshift < postgres/snapshot/rideshift-snapshot-latest.sql
```

Hoặc trực tiếp vào PostgreSQL bất kỳ:

```bash
psql "postgresql://postgres:postgres@localhost:5432/rideshift" \
  -f postgres/snapshot/rideshift-snapshot-latest.sql
```

Snapshot dùng `TRUNCATE ... ` + `session_replication_role = replica` nên sẽ **ghi đè** dữ
liệu hiện có của các bảng nghiệp vụ — chỉ dùng khi muốn quay về bộ dữ liệu mẫu.
