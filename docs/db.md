# RideShift — Database Design (đối chiếu proposal C1SE.48)

> Viết lại từ đầu, đối chiếu trực tiếp proposal gốc: §10 Technology Stack
> (PostgreSQL + PostGIS), Objective 3 (spatial qua PostgreSQL/PostGIS),
> NFR-02 (PostGIS indexes), Deliverable #10 (PostgreSQL + PostGIS Database),
> Deliverable #11 (Processed Survey Dataset), Deliverable #12 (Database design + ERD).
> Sơ đồ CSDL: **`docs/db-erd.png`** (24 bảng · 6 schema, theo thiết kế DB FINAL
> + ERD nhóm trên dbdiagram).

---

## 1. Kết luận audit database vs proposal

| Yêu cầu proposal | Thực tế trong code | Trạng thái |
|---|---|---|
| §10: Database = **PostgreSQL** | PostgreSQL 18.4 user-space (sandbox) / PostgreSQL 16 (Docker compose); DB `rideshift`; schema do FastAPI sở hữu duy nhất | ✅ |
| §10 + Deliverable #10: **PostGIS** spatial database | `postgis/postgis:16-3.4` trong docker-compose; `schema.sql` định nghĩa trực tiếp **10 cột `GEOMETRY(...)` thật** (MULTIPOLYGON/LINESTRING/POINT, SRID 4326) + 10 GIST index; PostGIS là yêu cầu bắt buộc khi boot | ✅ DB đúng DB FINAL (volume TEXT cũ được upgrade in-place) |
| NFR-02: **PostGIS indexes** cho spatial query | 10 GIST index khai báo ngay trong `schema.sql` cho đủ 10 cột GEOMETRY (fresh install lẫn upgrade đều có) | ✅ |
| Objective 3: outside / partial / within bằng PostgreSQL/PostGIS | Spatial data nằm trong PostGIS GEOMETRY; phân tích 3 trạng thái chạy Shapely trên GeoJSON đọc từ DB (`db.geom_read`) — PostGIS sẵn sàng cho truy vấn DB-level (ST_Intersects…) | ✅ |
| Deliverable #10: DB chứa structured + spatial data | **24 bảng / 6 schema** theo DB FINAL; spatial = 10 cột GEOMETRY (zones/regions/study areas MULTIPOLYGON, routes/roads LINESTRING, POI/locations/trip endpoints/AQ points) | ✅ |
| Deliverable #11: processed survey dataset | Bảng `decision.vehicle_survey_responses` (25.586 dòng thật đã làm sạch) + `decision.dataset_trends` (42 dòng) + `core.dataset_runs` + 3 CSV trong `data/processed/` | ✅ chạy trên bộ dữ liệu thật Kaggle "Vehicle at Ha Noi Dataset" (xem §7) |
| Deliverable #12: Database design + ERD | 24 bảng đặt đúng 6 schema DB FINAL, tên bảng số nhiều + PK `BIGSERIAL` khớp ERD nhóm | ✅ |

**Điểm mạnh kiến trúc DB**: một chủ sở hữu duy nhất — FastAPI tạo/migrate schema
(`schema.sql`, idempotent), frontend là API consumer thuần (không ORM);
migration layout cũ tự động (`seed.py::migrate_legacy`).

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
| Backend boot (tự động) | `main.py` lifespan: schema.sql → migrate legacy → seed (idempotent) → chạy pipeline dataset nếu `dataset_trends` trống |

> ⚠️ Platform có thể inject `DATABASE_URL=file:...custom.db` — `app/config.py`
> tự fallback về DSN PostgreSQL ở trên khi URL không bắt đầu bằng `postgres`.

---

## 3. Sơ đồ ERD — 24 bảng · 6 schema

Xem **`docs/db-erd.png`**. Thiết kế theo **DB FINAL.pdf + ERD nhóm (dbdiagram)**
với các điều chỉnh đã chốt của Capstone:

- **Bỏ `core.users` / `core.vehicles`** — hệ thống chỉ có 2 role (guest/admin),
  không đăng ký/lưu tài khoản người dùng thường và không khai báo xe cá nhân.
  Dữ liệu xác thực đặt trong `core.admins` + `core.admin_sessions` (thay users).
- **Giữ 2 bảng pipeline dữ liệu khảo sát** (không có trong DB FINAL):
  `core.dataset_runs` (audit mỗi lần chạy) + `decision.dataset_trends`
  (mode-share theo tháng) — phục vụ chức năng 34–35 (phân bố lựa chọn, xu
  hướng) và tiêu chí `trend` của TOPSIS.
- **Thêm `decision.vehicle_survey_responses`** (theo ERD): dòng thô đã làm sạch
  của bộ khảo sát — raw layer cho phân tích.
- PK toàn hệ thống là `BIGSERIAL` (khớp ERD); FK `bigint`. Chuỗi FK chính:

```
core.study_areas ──▶ gis.administrative_regions / transportation.transportation_locations
                     / policy.lez_zones / trip.trips
transportation.transportation_modes ──▶ policy.vehicle_types ──▶ policy.vehicle_restrictions
policy.lez_zones ──▶ policy.lez_rules ──▶ policy.vehicle_restrictions
trip.trips ──▶ trip.trip_routes ──▶ trip.trip_lez_analyses (──▶ lez_zones, lez_rules)
trip.trips ──▶ decision.recommendation_runs ──▶ decision.recommendation_scores
trip.trips ──▶ decision.impact_assessments
core.admins ──▶ core.admin_sessions / core.system_logs
```

---

## 4. Bảng dữ liệu (24 bảng, 6 schema, snake_case số nhiều)

### core (5)

- **`study_areas`** — khu vực nghiên cứu (Hà Nội, `code='HN'`): `code` UNIQUE,
  `area_type`, `country_code`, `geometry` (GeoJSON MultiPolygon), `status`.
- **`admins`** — `username` UNIQUE, `password_hash` (sha256+salt), `full_name`,
  `role`, `status`, `last_login_at`.
- **`admin_sessions`** — `token` UNIQUE, `admin_id` FK CASCADE, `expires_at`
  (8h); cookie httpOnly `rs_admin_session`.
- **`system_logs`** — audit: `level`, `action` (LOGIN/ZONE_CREATE/…),
  `entity_type`, `entity_id`, `description`, `ip_address`.
- **`dataset_runs`** — audit pipeline: `ran_at`, `source_file`, `rows_in`,
  `rows_clean`, `notes`.

### gis (3)

- **`administrative_regions`** — 14 quận Hà Nội seeded (`region_type='DISTRICT'`,
  UNIQUE(study_area, name)); trips tham chiếu qua `origin_region_id`.
- **`road_segments`** / **`points_of_interest`** — **trống theo thiết kế**:
  import từ OpenStreetMap/QGIS theo 15 bước DB FINAL, app không tự vẽ.

### transportation (2)

- **`transportation_modes`** — 7 phương thức: `code` UNIQUE
  (`gasoline_motorbike`…), `category`, `routing_profile` (osrm), `avg_speed_kmh`,
  `base_fare`, `cost_per_km`, `co2_per_km_g`, `avg_wait_min`,
  `accessibility_score`, `convenience_score`, `is_active`, `sort_order`
  (4 cột cuối là mở rộng app cho MCDM/UI — ghi nhận deviation).
- **`transportation_locations`** — bến xe/metro/BRT: `location_type`, `lat/lng` (số thực tiện tra cứu),
  `geometry` GEOMETRY(POINT,4326) — DB FINAL, `source`, `status`; FK mode (bus_stop → bus).

### policy (4)

- **`lez_zones`** — `study_area_id` FK, `geometry`
  GEOMETRY(MULTIPOLYGON,4326) **nguồn chuẩn theo DB FINAL** (+ GIST index),
  `effective_from/to`, `status` (`active`/`inactive`). API vẫn trả `coordinates`
  `[[lat,lng]…]` — backend suy ra từ geometry qua `ST_AsGeoJSON` (xem §5).
- **`lez_rules`** — quy định theo vùng: `rule_name`, `description`,
  `start_time`/`end_time` (TIME), `days_of_week` (`Mon,Tue,…`), `effective_from/to`,
  `status`.
- **`vehicle_types`** — taxonomy phương tiện: `code` UNIQUE, `fuel_type`,
  `emission_standard`, `emission_level` (0 = zero-emission, 1..6 = Euro),
  `transportation_mode_id` FK, `is_default`.
- **`vehicle_restrictions`** — phán quyết theo rule × loại xe:
  `restriction_type` (`banned` | `conditional`), `min_emission_level`,
  `restriction_reason`.

### trip (3)

- **`trips`** — mỗi lần phân tích + lựa chọn (nguồn liệu analytics):
  `origin_name/destination_name` + `origin`/`destination` GEOMETRY(POINT,4326)
  `origin_region_id/destination_region_id` FK, `origin_district`,
  `vehicle_type_id` FK (xe người dùng chọn), `chosen_vehicle_type_id` FK +
  `switched` (quyết định thực tế), `top_mode_id` FK + `top_score` (đề xuất
  hàng đầu — mở rộng app cho pandas), `travel_time`, `departure_hour`,
  `trip_purpose`, `preferences` JSONB, `distance_km`, `duration_min`,
  `lez_affected`, `avg_cost_vnd`, `avg_time_min`. Index: `created_at`,
  `trip_purpose`, `origin_district`.
- **`trip_routes`** — tuyến OSRM đã lưu: `routing_profile`, `route_index`,
  `provider` (osrm/estimate), `distance_m`, `duration_sec`, `geometry`
  (GeoJSON LineString).
- **`trip_lez_analyses`** — phân tích tuyến × vùng: `intersects`,
  `intersection_length_m`, `intersection_percentage`, `route_lez_status`
  (outside/partial/within), `applicable_lez_rule_id`, `compliance_status`,
  `compliance_reason`, `analyzed_at`.

### decision (7)

- **`recommendation_criteria`** — 7 tiêu chí TOPSIS (admin sửa được, tổng = 100):
  `code` UNIQUE ∈ {`travelTime`, `cost`, `lezCompliance`, `accessibility`,
  `convenience`, `environment`, `trend`}, `criteria_type` (`COST`/`BENEFIT`),
  `default_weight` (seed: 25/20/20/10/10/10/5).
- **`recommendation_runs`** — mỗi lần chạy TOPSIS: `algorithm` (TOPSIS),
  `status`, `duration_ms`, `completed_at`.
- **`recommendation_scores`** — ma trận điểm mode × tiêu chí: `raw_value`,
  `normalized_value`, `weight`, `weighted_score`, `final_score`, `rank_position`;
  UNIQUE(run, mode, criteria). 49 dòng mỗi lần phân tích (7×7).
- **`impact_assessments`** — so sánh phương tiện hiện tại ↔ phương án thay thế:
  time/cost/compliance/score của cả hai + 3 cột chênh lệch.
- **`air_quality_observations`** — cache AQI: `cache_key` UNIQUE =
  `'{lat}:{lng}'` (2 số thập phân), cột `aqi/pm25/pm10` (promoted) +
  `raw_data` JSONB (payload đầy đủ), `observed_at`; TTL 30'.
- **`vehicle_survey_responses`** — 25.586 dòng khảo sát thật (Kaggle "Vehicle at
  Ha Noi Dataset", 25.590 dòng gốc): `source_row` (rowid), `region_id` (30/31
  quận huyện — 100% dòng được map), `area_label`, `trip_purpose`,
  `current_mode_id`, `trip_distance_km`, `trip_time_min`, `raw_data` JSONB
  (đủ 58 cột gốc của dòng CSV).
- **`dataset_trends`** — aggregate feed tiêu chí `trend` của TOPSIS + dashboard:
  UNIQUE(mode, month), `share` (0..1), `trend_index` (0..1), `sample_count`.

---

## 5. PostGIS geometry (NFR-02)

```
app/db.py
├── geom_write(multi)  ← INSERT/UPDATE: GeoJSON → ST_SetSRID(ST_GeomFromGeoJSON(…),4326)
├── geom_read(col)     ← SELECT: ST_AsGeoJSON(col) (GeoJSON trên wire, không hex EWKB)
└── postgis_available() ← /health hiển thị trạng thái PostGIS
```

- **10 cột hình học là GEOMETRY thật (PostGIS bắt buộc)** — schema.sql định nghĩa
  trực tiếp `GEOMETRY(MULTIPOLYGON/LINESTRING/POINT,4326)` + 10 GIST index
  (đúng DB FINAL workflow "Import into PostGIS → Create spatial indexes").
- **Volume cũ layout TEXT được upgrade in-place** bởi khối cuối schema.sql:
  `lez_zones.coordinates` JSON → `geometry` (SET NOT NULL khi đủ ring, DROP
  `coordinates`), 9 cột TEXT còn lại ALTER TYPE với `ST_GeomFromGeoJSON` —
  exception-guarded từng cột, không mất dữ liệu, không cần re-seed.
- Chạy trên PostgreSQL thường (không PostGIS) → schema.sql từ chối boot với
  thông báo rõ ràng; phân tích outside/partial/within vẫn chạy Shapely trong
  `services/geo.py` (đọc GeoJSON từ DB, kết quả like-for-like).

## 6. Seed data (idempotent, `app/seed.py`)

1 study area (Hà Nội) · 1 admin (`admin`/`admin123`) · 7 modes · 7 vehicle
types · 1 LEZ zone (Vành đai 1, hiệu lực 01/07/2026 theo Chỉ thị 20/CT-TTg) ·
2 rules + 2 vehicle restrictions · 7 weights · 12 transportation locations ·
31 administrative regions (30 quận/huyện khớp cột `oridist` của khảo sát +
"Central Hanoi") · 140 demo trips (RNG seed 48).

## 7. Dataset pipeline → Deliverable #11 (đÃ ĐÓNG KÍN)

```
data/dataHN.csv ──(app/services/trend.py — pandas, nhánh cohort)──► data/processed/
              │        ├── processed_trips.csv  (25.586 dòng cleaned)
              │        ├── mode_trend.csv       (6 nhóm tuổi × 7 mode)
              │        └── mode_stats.csv       (features theo mode)
              ├──► decision.vehicle_survey_responses (25.586 dòng thật, raw_data JSONB 58 cột)
              ├──► decision.dataset_trends  (42 dòng = 6 nhóm tuổi × 7 mode)
              └──► core.dataset_runs (audit, notes ghi periodKind=cohort)

fallback: data/vehicle_at_hanoi.csv (scaffold 2.400 dòng theo tháng) hoặc
scaffold do tools/make_dataset.py sinh — dùng khi dataHN.csv không có mặt.
```

✅ **Đã dùng dữ liệu thật.** Kaggle "Vehicle at Ha Noi Dataset" 25.590 dòng ×
58 cột nằm tại `backend/data/dataHN.csv` (9,1MB, commit trực tiếp trong repo).
Bộ khảo sát không có cột ngày → trục xu hướng là **6 nhóm tuổi**
(`0-17 · 18-25 · 26-35 · 36-55 · 56-75 · 75+`); growth = −polyfit (mode được
người trẻ dùng nhiều = hướng tương lai), trend_index = 0.6×adoption +
0.4×growth. Thị phần thực đo: xe máy xăng 57,4% · ô tô 26,9% · xe máy điện
5,7% · xe đạp 5,0% · đi bộ 2,1% · buýt 1,6% · taxi 1,3%.
Dashboard admin tự nhận biết `periodKind=cohort` và hiển thị thị phần toàn mẫu.
GET `/api/dataset/summary` là read-only (aggregate từ DB, không chạy lại pipeline).

## 8. Legacy

- Họ bảng camelCase Prisma (`AdminUser`, `TripRecord`, …) — **đã xoá hoàn toàn**
  khỏi DB (schema.sql tự DROP) và khỏi code; frontend không giữ ORM nào.
- Các layout cũ (`public.admin_user`, `trip.trip_record`, tên số ít…) — tự
  migrate sang 24 bảng mới bởi `seed.py::migrate_legacy()` rồi bị DROP.
- `db/custom.db` (SQLite) — backup thời kỳ đầu, không còn được đọc.

## 9. Đối chiếu tài liệu chính thức v1.0 (Task 23) & mapping US → bảng

> Đối chiếu với bộ tài liệu chính thức: **Proposal v1.0**, **Project Plan v1.0**,
> **Product Backlog v1.0** (35 PBI), **User Story v1.0** (35 US + acceptance criteria).
> Kết luận: **schema khớp 100%** với mọi data source ghi trong Product Backlog
> (cột Notes của từng PBI).

| User Story (v1.0) | Data source trong backlog | Bảng/cột trong schema |
|---|---|---|
| US-01, US-14, US-15 | — (frontend) | trips.origin_*/destination_* + trip_routes (persist) |
| US-02, US-03 | — (OSRM + frontend) | trips.distance_km, duration_min + trip_routes.distance_m, duration_sec |
| US-04, US-22, US-31 | LezZone (admin-managed) | `lez_zones` (geometry MULTIPOLYGON PostGIS + GIST, status) |
| US-05, US-17 | PolicyRule | `lez_rules` (start_time, end_time, days_of_week) |
| US-06, US-24 | PolicyRule/vehicle-restriction | `vehicle_restrictions` + `vehicle_types` (restriction_type, min_emission_level) |
| US-08, US-19 | AirQualityCache | `air_quality_observations` (aqi/pm25/pm10 + raw_data JSONB, observed_at) |
| US-10, US-34 | CriteriaWeight | `recommendation_criteria` (7 tiêu chí, tổng 100%) |
| US-13 | TransportationLocation | `transportation_locations` (bus_stop/metro/brt, status) |
| US-16, US-33 | TransportMode | `transportation_modes` (is_active, thông số vận hành) |
| US-25–US-29, US-35 | TripRecord (originDistrict, purpose, switched, createdAt) | `trips` |
| US-25 (survey source) | processed dataset (Deliverable #11) | `vehicle_survey_responses`, `dataset_trends`, `dataset_runs` |
| US-21, US-30 | AdminUser / AdminSession | `admins`, `admin_sessions` (token, expires_at 8h) |
| US-27, US-28, US-29 (MCDM persist) | RecommendationRun/Score/Impact | `recommendation_runs`, `recommendation_scores`, `impact_assessments` |
| US-36 (địa lý) | AdministrativeRegion | `administrative_regions` (origin_region_id) |
| US (audit) | SystemLog | `system_logs` (LOGIN, ZONE_*, RULE_*, DATASET_REPROCESS…) |

**Các thay đổi hành vi sau đối chiếu:** US-08 gắn nhãn ngữ cảnh địa lý cho dữ
liệu AQ; US-19 trạng thái `unavailable` thay cho số liệu ước lượng khi không có
cache; US-25 dashboard bổ sung thẻ "Survey dataset" và nút Reprocess; US-22
thêm validate phạm vi lat/lng; US-29/35 bỏ LIMIT 500 khi tổng hợp.

**Export DDL:** `docs/db-schema.sql` (bản export chuẩn của `app/schema.sql`).
