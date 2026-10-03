# RideShift — Database Design (đối chiếu proposal C1SE.48)

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
| Deliverable #11: processed survey dataset | Bảng `dataset_trend` + `dataset_run` + 3 CSV trong `data/processed/` | ✅ cơ chế / ⚠️ nguồn đang là scaffold 2.400 dòng (xem §7) |

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

⚠️ **Trạng thái hiện tại (sau reset sandbox):** CSV nguồn là scaffold 2.400 dòng
của `tools/make_dataset.py`; bản tích hợp Kaggle thật (25.590 dòng × 58 cột,
cohort-based trend) đã mất cùng lần reset. Cần tải lại CSV Kaggle về
`data/vehicle_at_hanoi.csv` và port lại phần đọc/feature cohort trong `trend.py`.
Schema DB và cơ chế pipeline **không thay đổi** khi thay nguồn.

## 8. Legacy

- `prisma/schema.prisma` (9 model camelCase) — **không còn runtime**; giữ lại chỉ
  làm tư liệu so sánh thiết kế. Toàn bộ quyền sở hữu schema thuộc
  `mini-services/fastapi-backend/app/schema.sql`.
- `db/custom.db` (SQLite) — backup thời kỳ đầu, không còn được đọc.

## 9. Đối chiếu tài liệu chính thức v1.0 (Task 23) & mapping US → bảng

> Đối chiếu với bộ tài liệu chính thức: **Proposal v1.0**, **Project Plan v1.0**,
> **Product Backlog v1.0** (35 PBI), **User Story v1.0** (35 US + acceptance criteria).
> Kết luận: **schema khớp 100%** với mọi data source ghi trong Product Backlog
> (cột Notes của từng PBI) — không cần thay đổi cấu trúc, chỉ bổ sung tài liệu.

| User Story (v1.0) | Data source trong backlog | Bảng/cột trong schema |
|---|---|---|
| US-01, US-14, US-15 | — (frontend) | trip_record.origin_*/dest_* (persist) |
| US-02, US-03 | — (OSRM + frontend) | trip_record.distance_km, duration_min |
| US-04, US-22, US-31 | LezZone (admin-managed) | `lez_zone` (coordinates JSON + geom PostGIS, active) |
| US-05, US-17 | PolicyRule | `policy_rule` (zone_id, start_time, end_time, days) |
| US-06, US-24 | PolicyRule/vehicle-restriction | `policy_rule` (mode_id, restriction_type, condition) |
| US-08, US-19 | AirQualityCache | `air_quality_cache` (payload JSON, fetched_at) |
| US-10, US-34 | CriteriaWeight | `criteria_weight` (7 tiêu chí, tổng 100%) |
| US-13 | TransportationLocation | `transportation_location` (bus_stop/metro/brt, active) |
| US-16, US-33 | TransportMode | `transport_mode` (enabled, thông số vận hành) |
| US-25–US-29, US-35 | TripRecord (originDistrict, purpose, switched, createdAt) | `trip_record` |
| US-25 (survey source) | processed dataset (Deliverable #11) | `dataset_trend`, `dataset_run` |
| US-21, US-30 | AdminUser / AdminSession | `admin_user`, `admin_session` (token, expires_at 8h) |

**Các thay đổi hành vi sau đối chiếu (không đổi schema):** US-08 gắn nhãn ngữ
cảnh địa lý cho dữ liệu AQ; US-19 trạng thái `unavailable` thay cho số liệu ước
lượng khi không có cache; US-25 dashboard bổ sung thẻ "Survey dataset"
(dataset_run + dataset_trend) và nút Reprocess; US-22 thêm validate phạm vi
lat/lng; US-29/35 bỏ LIMIT 500 khi tổng hợp.

**Export DDL:** `docs/db-schema.sql` (bản export chuẩn của
`app/schema.sql`, chú thích mapping US → bảng + block PostGIS tuỳ chọn).
