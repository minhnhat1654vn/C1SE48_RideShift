# postgres/ — Tài sản database

Thư mục này chứa mọi thứ liên quan đến **PostgreSQL 16 + PostGIS** của RideShift.
Schema được backend FastAPI **sở hữu trọn vẹn** (frontend là API consumer thuần,
không giữ bảng nào) và **tự tạo + tự seed khi boot** — file dưới đây chỉ là tài
liệu tham khảo và công cụ khôi phục dữ liệu mẫu.

## Nội dung

| Đường dẫn | Vai trò |
|---|---|
| `schema.reference.sql` | **Tài liệu tham khảo** — bản sao của `backend/app/schema.sql`. KHÔNG cần tự chạy: backend tạo + seed khi boot (idempotent). |
| `snapshot/rideshift-snapshot-latest.sql` | Ảnh dữ liệu mẫu (TRUNCATE + INSERT: admin, phương tiện, vùng LEZ, quy định, trọng số, địa điểm, chuyến đi demo…). Dùng để restore nhanh cho demo. |

## Sơ đồ schema — theo tài liệu thiết kế "DB FINAL"

Bảng nghiệp vụ được tổ chức vào **6 schema** đúng như DB FINAL.pdf — **tên bảng
và PK (BIGSERIAL) bám sát tài liệu + ERD nhóm** (dbdiagram), với các điều chỉnh
đã chốt của Capstone: bỏ `core.users`/`core.vehicles` (hệ thống chỉ có 2 role
guest/admin, không lưu tài khoản người dùng thường), thêm `core.admins` +
`core.admin_sessions`, và giữ 2 bảng pipeline dữ liệu khảo sát:

| Schema | Bảng | Nội dung |
|---|---|---|
| `core` | `study_areas`, `admins`, `admin_sessions`, `system_logs`, `dataset_runs` | Khu vực nghiên cứu, tài khoản + phiên quản trị (US-21/30), audit log, nhật ký pipeline |
| `gis` | `administrative_regions` (31 seeded = 30 quận/huyện khớp `oridist` của khảo sát + "Central Hanoi"), `road_segments`, `points_of_interest` (trống — import GIS theo 15 bước trong DB FINAL) | Ranh giới hành chính + dữ liệu GIS |
| `transportation` | `transportation_modes`, `transportation_locations` | 7 phương thức + bến/ga/điểm dừng |
| `policy` | `lez_zones`, `lez_rules`, `vehicle_types`, `vehicle_restrictions` | Vùng LEZ + quy định + taxonomy phương tiện + hạn chế |
| `trip` | `trips`, `trip_routes`, `trip_lez_analyses` | Chuyến đi + tuyến OSRM + phân tích giao LEZ |
| `decision` | `recommendation_criteria`, `recommendation_runs`, `recommendation_scores`, `impact_assessments`, `air_quality_observations`, `vehicle_survey_responses`, `dataset_trends` | MCDM (tiêu chí/lần chạy/điểm/tác động), AQI, dữ liệu khảo sát, aggregate xu hướng |

Tổng: **24 bảng** = 21 bảng DB FINAL điều chỉnh (bỏ users/vehicles, thêm
admins/admin_sessions) + `vehicle_survey_responses` (theo ERD) +
`dataset_runs`/`dataset_trends` (giữ lại — phục vụ chức năng 34–35 và tiêu chí
"trend" của MCDM).

Schema `public` **không chứa bảng nghiệp vụ** — chỉ có object hệ thống của
PostGIS (`spatial_ref_sys`, hàm `ST_*`). Các schema `tiger` / `tiger_data` /
`topology` (side-effect của image `postgis/postgis`) bị loại bỏ: compose đặt
`POSTGRES_MULTIPLE_EXTENSIONS=postgis` và `schema.sql` DROP phần thừa lúc boot.

Mọi kết nối backend đặt `search_path = public, core, policy, transportation,
trip, decision` (xem `backend/app/db.py`) — SQL trong app dùng tên đầy đủ
`schema.bảng`. Các cột mở rộng so với DB FINAL (app cần, ghi nhận deviation):
`transportation_modes.icon/sort_order/co2_per_km_g/avg_speed_kmh`,
`transportation_locations.lat/lng` + `trips.origin_lat/origin_lng/dest_lat/
dest_lng` (số thực tiện tra cứu, tách từ cột geometry),
`trips.origin_district/top_mode_id/top_score/avg_*` (analytics pandas).

## Ai sở hữu schema nào?

**Một chủ duy nhất — backend FastAPI** (`backend/app/schema.sql` + `seed.py`,
chạy idempotent trong lifespan lúc boot). Thứ tự khởi động:
**db → backend → frontend**. Trước đây frontend từng sở hữu họ bảng camelCase
Prisma qua service `dbinit` — đã bị loại bỏ hoàn toàn (code route + `prisma/`
đã xoá; `schema.sql` tự dọn legacy lúc boot).

> ⚠️ Không đưa Prisma/ORM thứ hai vào frontend: DB dùng chung phải có một chủ
> duy nhất. Bổ sung bảng mới → sửa `backend/app/schema.sql` (+ `seed.py` nếu
> cần dòng mặc định) và copy sang `postgres/schema.reference.sql`.

> **PostGIS là yêu cầu bắt buộc** (đúng DB FINAL): toàn bộ 10 cột hình học là
> kiểu `GEOMETRY(...)` thật với type modifier + GIST spatial index —
> `study_areas.geometry` / `administrative_regions.geometry` /
> `lez_zones.geometry` = `GEOMETRY(MULTIPOLYGON,4326)`, `road_segments.geometry`
> / `trip_routes.geometry` = `GEOMETRY(LINESTRING,4326)`, `points_of_interest.
> geometry` / `transportation_locations.geometry` / `trips.origin` /
> `trips.destination` / `air_quality_observations.location` =
> `GEOMETRY(POINT,4326)`. Backend ghi qua `ST_SetSRID(ST_GeomFromGeoJSON(…),4326)`
> và đọc qua `ST_AsGeoJSON` (xem `app/db.py::geom_write/geom_read`) nên API vẫn
> trả GeoJSON `[[lat, lng], …]` như cũ — frontend không đổi gì. Chạy trên
> PostgreSQL thường (không PostGIS) sẽ bị từ chối ngay lúc boot với thông báo
> rõ ràng; volume cũ cột TEXT được tự upgrade in-place bởi khối cuối của
> `schema.sql` (không mất dữ liệu, không cần re-seed).

## Migration từ layout cũ (trước DB FINAL)

`backend/app/seed.py::migrate_legacy()` tự chạy lúc boot: nếu DB còn các bảng
cũ (`public.admin_user`, `core.admin_user`, `trip.trip_record`,
`decision.criteria_weight`, … — layout phẳng hoặc tên số ít), nó sẽ **copy dữ
liệu sang 24 bảng mới** (map mode qua `code`, zone qua tên, region qua quận)
rồi **DROP bảng cũ**. Không cần can thiệp tay — chỉ cần `docker compose up`
lại như bình thường; muốn sạch hoàn toàn thì `docker compose down -v`.

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

Snapshot tự đặt `search_path` theo 6 schema nên chạy được trên DB mới. File dùng
`TRUNCATE ...` + `session_replication_role = replica` nên sẽ **ghi đè** dữ liệu
hiện có của các bảng nghiệp vụ — chỉ dùng khi muốn quay về bộ dữ liệu mẫu.
