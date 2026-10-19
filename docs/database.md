# RideShift — Database Design (đối chiếu proposal C1SE.48)

> ⚠️ **Tài liệu lịch sử** — mô tả layout 11 bảng phẳng giai đoạn đầu của demo.
> Layout **hiện hành là 24 bảng / 6 schema theo DB FINAL** (10 cột hình học là
> PostGIS `GEOMETRY(...)` thật + GIST index, PostGIS bắt buộc) — xem
> **`docs/db.md`** và `postgres/schema.reference.sql`.



> Viết lại từ đầu, đối chiếu trực tiếp proposal gốc: §10 Technology Stack
> (PostgreSQL + PostGIS), Objective 3 (spatial qua PostgreSQL/PostGIS),
> NFR-02 (PostGIS indexes), Deliverable #10 (PostgreSQL + PostGIS Database),
> Deliverable #11 (Processed Survey Dataset), Deliverable #12 (Database design + ERD).
> Sơ đồ quan hệ: **`docs/db-erd.png`** (vẽ đúng style dbdiagram, 11 bảng + 7 liên kết).

---

## 1. Kết luận audit database vs proposal

| Yêu cầu proposal | Thực tế trong code | Trạng thái |
|---|---|---|
| §10: Database = **PostgreSQL** | PostgreSQL 18.4 user-space (sandbox) / PostgreSQL 16 (Docker compose); DB `rideshift`; schema do FastAPI sở hữu | ✅ |
| §10 + Deliverable #10: **PostGIS** spatial database | `postgis/postgis:16-3.4` trong docker-compose; `app/db.py` tự `CREATE EXTENSION postgis` + cột `lez_zone.geom geometry(Polygon,4326)` + backfill từ JSON mỗi boot | ✅ deploy / ⚠️ sandbox fallback Shapely (không có root để cài extension — hạn chế môi trường) |
| NFR-02: **PostGIS indexes** cho spatial query | `CREATE INDEX lez_zone_geom_gist ON lez_zone USING gist (geom)` tự tạo khi PostGIS bật | ✅ deploy / ⚠️ sandbox |
| Objective 3: outside / partial / within bằng PostgreSQL/PostGIS | Dual-mode: PostGIS path (geom sync + DB-level) hoặc Shapely trong `services/geo.py` — cùng kết quả 3 trạng thái | ✅ |
| Deliverable #10: DB chứa structured + spatial data | 9 bảng nghiệp vụ + 2 bảng dataset; spatial = zone polygons (JSON + geom) + tọa độ trips/locations | ✅ |
| Deliverable #11: processed survey dataset | Bảng `decision.vehicle_survey_responses` (25.586 dòng thật) + `decision.dataset_trends` (42 dòng) + `core.dataset_runs` + 3 CSV trong `data/processed/` | ✅ chạy trên bộ dữ liệu thật Kaggle (xem §7) |

**Điểm mạnh kiến trúc DB**: schema 100% portable (prisma sqlite→postgresql chỉ đổi
1 dòng provider, 0 dòng app code); ownership rõ — FastAPI tạo/migrate schema
(`schema.sql`, idempotent `CREATE TABLE IF NOT EXISTS`), Prisma chỉ là tư liệu.

---

## 2. Thông tin kết nối & vận hành

```
Sandbox  : postgresql://postgres@127.0.0.1:5432/rideshift   (trust auth, socket /tmp)
Docker   : postgresql://postgres:postgres@db:5432/rideshift (service `db` trong compose)
Runtime  : psycopg 3 (dict_row), connection-per-request; transactional context `db.tx()`
```

| Lệnh | Công dụng |
|---|---|
| `bun run db:pg:start` | Khởi động PG user-space (auto-initdb `db/pgdata`, auto-hydrate ICU symlinks) |
| `bun run db:pg:stop` / `db:pg:status` | Dừng / tra trạng thái |
| `bun run db:pg:start` sau reset | PG data dir mất → tự initdb lại; schema+seed tự tạo lúc backend boot (`db.init_db()` + `seed.seed()`) |
| Backend boot (tự động) | `main.py` lifespan: schema.sql → seed (idempotent) → chạy pipeline dataset nếu `dataset_trend` trống |

> ⚠️ Platform có thể inject `DATABASE_URL=file:...custom.db` — `app/config.py`
> tự fallback về DSN PostgreSQL ở trên khi URL không bắt đầu bằng `postgres`.

---

## 3. Sơ đồ ERD

Xem **`docs/db-erd.png`** (nguồn chỉnh sửa: `docs/db-erd.html`, render lại bằng
`docs/shot_erd.py`). 11 bảng, 7 liên kết:

- FK cứng (`ON DELETE CASCADE`): `admin_session.user_id → admin_user.id`,
  `policy_rule.zone_id → lez_zone.id`, `policy_rule.mode_id → transport_mode.id`
- Tham chiếu logic (text id): `trip_record.{vehicle_id, top_mode_id, chosen_mode_id} → transport_mode.id`,
  `dataset_trend.mode_id → transport_mode.id`

---

## 4. Bảng dữ liệu (11 bảng, snake_case)

### 4.1 Nghiệp vụ lõi

**`transport_mode`** — 7 phương tiện + tham số MCDM
`id` PK (`gasoline_motorbike`, `electric_motorbike`, `private_car`, `bus`, `bicycle`, `walking`, `taxi`),
`name`, `description`, `icon`, `avg_speed_kmh`, `base_cost_vnd`, `cost_per_km_vnd`,
`co2_per_km_g`, `base_accessibility`, `base_convenience`, `wait_minutes`, `enabled`, `sort_order`.

**`lez_zone`** — vùng phát thải thấp
`id` PK, `name`, `description`, `coordinates` TEXT (JSON `[[lat,lng]…]` — **nguồn chuẩn, portable**),
`active`, `created_at`, `updated_at`.
*(Khi PostGIS bật: thêm `geom geometry(Polygon,4326)` + GIST — xem §5.)*

**`policy_rule`** — ràng buộc LEZ theo zone × mode
`id` PK, `zone_id` FK CASCADE, `mode_id` FK CASCADE,
`restriction_type` (`banned` | `conditional`), `condition` (vd "Euro 4+"),
`start_time`/`end_time` (`06:00`–`22:00`), `days` (`Mon,Tue,…`), `active`, `created_at`.

**`criteria_weight`** — trọng số TOPSIS (admin sửa được, tổng = 100)
`criterion` UNIQUE ∈ {`travelTime`, `cost`, `lezCompliance`, `accessibility`, `convenience`, `environment`, `trend`},
`weight` (seed: 25/20/20/10/10/10/5), `label`.

**`transportation_location`** — marker bản đồ
`id` PK, `name`, `type` (`bus_stop` | `metro` | `brt`), `lat`, `lng`, `active`.

### 4.2 Giao dịch & phiên

**`trip_record`** — mỗi lần phân tích + lựa chọn của user (nguồn liệu analytics)
`id` PK, `origin_name`, `dest_name`, `origin_district`,
`origin_lat/lng`, `dest_lat/lng`, `distance_km`, `duration_min`,
`vehicle_id` (mode hiện tại của user), `purpose` (`work|school|shopping|leisure|other`),
`departure_hour`, `lez_affected`, `top_mode_id`, `top_score`,
`avg_cost_vnd`, `avg_time_min`, `chosen_mode_id` (quyết định thực tế), `switched`,
`created_at`. Index: `created_at`, `purpose`.

**`admin_user`** — `username` UNIQUE, `password_hash` (sha256+salt), `full_name`.
**`admin_session`** — `token` UNIQUE, `user_id` FK CASCADE, `expires_at` (8h);
cookie httpOnly `rs_admin_session`.

### 4.3 Cache & dataset pipeline

**`air_quality_cache`** — `cache_key` UNIQUE = `'{lat}:{lng}'` (2 số thập phân),
`payload` JSON (AirQualityInfo), `fetched_at`; TTL 30'.

**`dataset_trend`** — đầu ra pipeline pandas, feed tiêu chí `trend` của TOPSIS
`mode_id`, `month`, `share` (0..1), `trend_index` (0..1), `sample_count`. Index `mode_id`.

**`dataset_run`** — audit log pipeline: `ran_at`, `source_file`, `rows_in`, `rows_clean`, `notes`.

---

## 5. PostGIS dual-mode (NFR-02)

```
app/db.py
├── enable_postgis_if_available()
│     CREATE EXTENSION IF NOT EXISTS postgis          ← thất bại → return False (sandbox)
│     ALTER TABLE lez_zone ADD COLUMN geom geometry(Polygon,4326)
│     CREATE INDEX lez_zone_geom_gist USING gist(geom)   ← NFR-02
│     backfill: coordinates JSON → ST_GeomFromGeoJSON
├── sync_zone_geom()  ← giữ geom đồng bộ khi admin CRUD zone
└── postgis_available() ← routers/services rẽ nhánh Shapely khi False
```

- **Docker/deploy**: PostGIS bật → spatial query chạy trong DB (đúng chữ "PostGIS
  Spatial Query" của proposal §12) với GIST index.
- **Sandbox**: PG user-space không kèm extension → `services/geo.py` dùng Shapely
  trong app layer; outside/partial/within cho kết quả like-for-like.
  Đây là rẽ nhánh tự động, không cần cấu hình tay.

## 6. Seed data (idempotent, `app/seed.py`)

1 admin (`admin`/`admin123`) · 7 modes · 2 LEZ zones (Hoàn Kiếm core + Ring Road 1) ·
7 policy rules · 7 weights (25/20/20/10/10/10/5) · 12 transportation locations ·
140 demo trips (RNG seed 48, phân bổ purpose/hour/quận thực tế).

## 7. Dataset pipeline → Deliverable #11

```
data/vehicle_at_hanoi.csv ──(app/services/trend.py — pandas)──► data/processed/
                                                                 ├── processed_trips.csv  (cleaned)
                                                                 ├── mode_trend.csv       (analysis)
                                                                 └── mode_stats.csv       (features)
                                                          + bảng dataset_trend / dataset_run
```

✅ **Đã dùng dữ liệu thật:** `data/dataHN.csv` (Kaggle "Vehicle at Ha Noi
Dataset", 25.590 dòng × 58 cột, 9,1MB — commit trong repo) được pipeline xử lý
trên trục **6 nhóm tuổi** (khảo sát không có cột ngày): 25.586 dòng sạch persist
vào `decision.vehicle_survey_responses` (raw_data JSONB đủ 58 cột), 42 aggregate
vào `decision.dataset_trends`. Fallback scaffold monthly 2.400 dòng vẫn giữ khi
thiếu file thật. Chi tiết trong `docs/db.md` §7.

## 8. Legacy

- `prisma/schema.prisma` (9 model camelCase) — **không còn runtime**; giữ lại chỉ
  làm tư liệu so sánh thiết kế. Toàn bộ quyền sở hữu schema thuộc
  `mini-services/fastapi-backend/app/schema.sql`.
- `db/custom.db` (SQLite) — backup thời kỳ đầu, không còn được đọc.
