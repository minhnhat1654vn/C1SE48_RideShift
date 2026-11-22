# RideShift — Database Design (đối chiếu proposal C1SE.48)

> Viết lại từ đầu, đối chiếu trực tiếp proposal gốc: §10 Technology Stack
> (PostgreSQL + PostGIS), Objective 3 (spatial qua PostgreSQL/PostGIS),
> NFR-02 (PostGIS indexes), Deliverable #10 (PostgreSQL + PostGIS Database),
> Deliverable #11 (Processed Survey Dataset), Deliverable #12 (Database design + ERD).
> Sơ đồ CSDL: **`public/docs/db-erd.svg`** — ERD 25 bảng · 6 schema + `public.City` sinh TỰ ĐỘNG từ `app/schema.sql` (chạy `python3 scripts/gen_erd_svg.py` — luôn đồng bộ DB thật), theo thiết kế DB FINAL **v1.1** — điều chỉnh đa thành phố
> + ERD nhóm trên dbdiagram.

---

## 1. Kết luận audit database vs proposal

| Yêu cầu proposal | Thực tế trong code | Trạng thái |
|---|---|---|
| §10: Database = **PostgreSQL** | PostgreSQL 18.4 user-space (sandbox) / PostgreSQL 16 (Docker compose); DB `rideshift`; schema do FastAPI sở hữu duy nhất | ✅ |
| §10 + Deliverable #10: **PostGIS** spatial database | `postgis/postgis:16-3.4` trong docker-compose; `app/db.py` tự `CREATE EXTENSION postgis` + nâng cột `lez_zones.geometry` thành `GEOMETRY(MULTIPOLYGON,4326)` đúng DB FINAL (luôn có ở dạng GeoJSON TEXT trên sandbox) | ✅ deploy / ⚠️ sandbox fallback Shapely (không có root để cài extension — hạn chế môi trường) |
| NFR-02: **PostGIS indexes** cho spatial query | `CREATE INDEX lez_zones_geometry_gist ON lez_zones USING gist (geometry)` tự tạo khi PostGIS bật | ✅ deploy / ⚠️ sandbox |
| Objective 3: outside / partial / within bằng PostgreSQL/PostGIS | Dual-mode: PostGIS path (geom sync + DB-level) hoặc Shapely trong `services/geo.py` — cùng kết quả 3 trạng thái | ✅ |
| Deliverable #10: DB chứa structured + spatial data | **25 bảng / 6 schema + `public.City`** theo DB FINAL v1.1; spatial = `lez_zones.geometry` (GEOMETRY(MULTIPOLYGON,4326) khi PostGIS / GeoJSON TEXT portable) + tọa độ GeoJSON trips/locations/regions | ✅ |
| Deliverable #11: processed survey dataset | Bảng `decision.vehicle_survey_responses` (25.586 dòng thật đã làm sạch) + `decision.dataset_trends` (42 dòng) + `core.dataset_runs` + 3 CSV trong `data/processed/` | ✅ chạy trên bộ dữ liệu thật Kaggle "Vehicle at Ha Noi Dataset" (xem §7) |
| Deliverable #12: Database design + ERD | 25 bảng (21 bảng DB FINAL gốc − users/vehicles + 6 bảng điều chỉnh v1.1 — xem mục "Điều chỉnh DB FINAL v1.1"; 3 bảng US-45/47 đã gỡ khỏi phạm vi sản phẩm), tên bảng số nhiều + PK `BIGSERIAL` khớp ERD nhóm | ✅ |

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

## 3. Sơ đồ ERD — 25 bảng · 6 schema + public.City

Xem **`public/docs/db-erd.svg`** (trong app: tab Tài liệu → Sơ đồ ERD) — sinh tự động từ `app/schema.sql` bằng `scripts/gen_erd_svg.py`. Thiết kế theo **DB FINAL.pdf + ERD nhóm (dbdiagram)**
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

## 4. Bảng dữ liệu (25 bảng, 6 schema + public.City, snake_case số nhiều)

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
- **`transportation_locations`** — bến xe/metro/BRT: `location_type`, `lat/lng`,
  `geometry` (GeoJSON Point), `source`, `status`; FK mode (bus_stop → bus).

### policy (4)

- **`lez_zones`** — `study_area_id` FK, **`geometry`** — ranh giới LEZ đúng DB
  FINAL: `GEOMETRY(MULTIPOLYGON,4326)` khi PostGIS bật (bản Docker), GeoJSON
  MultiPolygon TEXT trên sandbox (không cài được extension — cùng dữ liệu, cùng
  kết quả phân tích qua lớp Shapely). `city_id` (đa thành phố) + 4 cột vòng đời
  văn bản cho tab Chính sách (`decision_no`, `issued_by`, `published_at`,
  `created_by`); `effective_from/to`, `status` (`active`/`inactive`).
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
  `origin_name/destination_name` + GeoJSON `origin/destination`,
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

### public (1)

- **`City`** — cổng chọn thành phố (DB FINAL v1.1): `id` (`hanoi`/`danang`/`hcm`),
  `name`, `studyAreaId` (liên kết `core.study_areas`), `bbox`, `centerLat/Lng`,
  `defaultZoom`, `sortOrder`, `active`. Phường/xã đọc từ
  `gis.administrative_regions` (1 nguồn duy nhất sau khi gộp bảng `Ward` cũ).

---

## 5. PostGIS dual-mode (NFR-02)

```
app/db.py
├── enable_postgis_if_available()
│     CREATE EXTENSION IF NOT EXISTS postgis          ← thất bại → return False (sandbox)
│     ALTER TABLE lez_zones ALTER COLUMN geometry TYPE geometry(MultiPolygon,4326)
│       USING ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(geometry),4326))
│     CREATE INDEX lez_zones_geometry_gist USING gist(geometry)   ← NFR-02
├── _migrate_lez_zone_geometry() ← volume cũ (coordinates/geom) tự chuyển
│                                   dữ liệu sang geometry rồi DROP cột mirror
├── sync_zone_geometry()  ← dual-mode TEXT/PostGIS cho mọi lệnh ghi vùng
└── postgis_available() ← routers/services rẽ nhánh Shapely khi False
```

- **Docker/deploy**: PostGIS bật → spatial query chạy trong DB (đúng chữ "PostGIS
  Spatial Query" của proposal §12) với GIST index.
- **Sandbox**: PG user-space không kèm extension → `services/geo.py` dùng Shapely
  trong app layer; outside/partial/within cho kết quả like-for-like.
  Đây là rẽ nhánh tự động, không cần cấu hình tay.

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
  migrate sang 25 bảng mới bởi `seed.py::migrate_legacy()` rồi bị DROP.
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
| US-04, US-22, US-31 | LezZone (admin-managed) | `lez_zones` (geometry DB FINAL — GeoJSON/PostGIS, status) |
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

---

## 10. Điều chỉnh DB FINAL v1.1 (rà soát đối chiếu 4 tài liệu gốc)

Đối chiếu **Proposal v1.0 · Project Plan v1.0 · User Story v1.0/v2.0 · DB FINAL
(PDF gốc)** với triển khai thực tế — mọi khác biệt đều được ghi nhận tại đây:

### Khớp DB FINAL gốc (21 bảng — bảng "Tổng hợp" cuối PDF đánh số 1–21)

`core` (4) · `gis` (3) · `transportation` (2) · `policy` (4) · `trip` (3) ·
`decision` (5) — đúng tên bảng, đúng schema, PK `BIGSERIAL` (sequence
`nextval()`), snake_case số nhiều, FK đúng hướng ERD.
`policy.lez_zones.geometry` đúng kiểu `GEOMETRY(MULTIPOLYGON,4326)` khi triển
khai PostGIS (docker-compose `postgis/postgis:16-3.4` + GIST index — NFR-02).

### Thay thế / bỏ 2 bảng gốc

| DB FINAL v1.0 | Xử lý | Lý do |
|---|---|---|
| `core.users` | → `core.admins` + `core.admin_sessions` | Chính DB FINAL ghi chú trên bảng users: *"Xem lại có nên không, vì hiện tại đang publish"* — app publish/guest không lưu thông tin cá nhân; users thu nhỏ thành admins phục vụ tab Quản trị (chức năng 30–41) |
| `core.vehicles` | bỏ | Guest không đăng ký xe — loại xe chọn trực tiếp từ `policy.vehicle_types` khi kiểm tra tuân thủ LEZ (hàm năng 11–13) |

### Điều chỉnh có chủ đích (+6 bảng = 25)

| Thêm | Lý do (tính năng đã được duyệt) |
|---|---|
| `public.City` + cột `city_id` (lez_zones, transportation_locations) | Đa thành phố Hà Nội / Đà Nẵng / TP.HCM — mở rộng được duyệt; 422 phường/xã đọc từ `gis.administrative_regions` (1 nguồn) |
| `core.admins` + `core.admin_sessions` | Thay `core.users` (xem bảng trên) — đăng nhập tab Quản trị, cookie httpOnly 8h |
| `decision.vehicle_survey_responses` | US khảo sát nhanh phương tiện đang dùng để kiểm tra tuân thủ LEZ |
| `core.dataset_runs` + `decision.dataset_trends` | Audit pipeline Kaggle 25.586 chuyến + xu hướng cho tab Quản trị (chức năng 35–41) |
| 4 cột `lez_zones`: `decision_no`, `issued_by`, `published_at`, `created_by` | Vòng đời văn bản cho tab Chính sách (6 thành phần) |

Số học: **21 (gốc) − 2 (users, vehicles) + 6 (mới) = 25 bảng** — 3 bảng của
US-45/47 (`user_feedback`, `notification_prefs`, `user_notifications`) đã
gỡ khỏi phạm vi sản phẩm (PR #16/#17) và bị DROP khỏi schema.

Cột `lez_zones.geometry` trên sandbox lưu GeoJSON TEXT (không cài được
extension PostGIS — hạn chế môi trường, đã ghi rõ §5); bản Docker nâng đúng
kiểu GEOMETRY của DB FINAL.

### So sánh cột chi tiết 19 bảng chung (so DB FINAL v1.0)

Khác biệt "môi trường" (không phải thiết kế):

- `BIGSERIAL` ↔ `BIGINT`: information_schema hiển thị BIGINT, thực tế 26/26
  cột PK đều có default `nextval()` ≡ BIGSERIAL.
- `TIMESTAMP` ↔ `TIMESTAMP WITH TIME ZONE`: app dùng timestamptz (best
  practice, dữ liệu AQI đa múi giờ).
- `GEOMETRY(...)` ↔ `TEXT` GeoJSON: sandbox không cài extension PostGIS;
  bản Docker nâng `lez_zones.geometry` đúng `GEOMETRY(MULTIPOLYGON,4326)` +
  GIST. Các cột không gian khác (trips.origin/destination,
  trip_routes.geometry, administrative_regions.geometry…) lưu GeoJSON TEXT
  portable — đọc/ghi thống nhất qua `geojson_utils`.

Khác biệt cột thật, theo bảng:

| Bảng | Khác so với DB FINAL v1.0 |
|---|---|
| `core.study_areas`, `gis.road_segments`, `gis.points_of_interest` | **Giữ nguyên 100% cột** |
| `core.system_logs` | `user_id` → `admin_id` (app guest); + `level`, `created_at` |
| `decision.air_quality_observations` | + `cache_key`, `lat`, `lng` (cache 30 phút cho trạm AQI thật + nội suy IDW) |
| `decision.recommendation_criteria` | + `default_weight` |
| `decision.recommendation_runs` | + `duration_ms`, `completed_at` |
| `decision.recommendation_scores` | + `rank_position` |
| `decision.impact_assessments` | `current/alternative_compliance` BOOLEAN → `*_compliance_status` VARCHAR(30) (4 trạng thái `permitted`/`not_permitted`/`partial`/`unknown` thay vì true/false); + `recommendation_run_id`, `current_score`, `alternative_score` |
| `gis.administrative_regions` | + `boundary_simple`, `area_km2`, `population`, `density_km2`, `merged_from` (tooltip phường/xã + hiệu năng render) |
| `policy.lez_rules` | + `created_at`, `updated_at` |
| `policy.lez_zones` | + `decision_no`, `issued_by`, `published_at`, `created_by`, `city_id` |
| `policy.vehicle_restrictions` | `min_emission_standard` VARCHAR(50) → `min_emission_level` SMALLINT (bậc số so sánh được thay vì chuỗi); `allowed` BOOLEAN → `restriction_type` VARCHAR(20) (`banned`/`conditional` — mọi dòng đều là hạn chế, cột `allowed` luôn FALSE là dư) |
| `policy.vehicle_types` | + `emission_level` (bậc số), `transportation_mode_id` (liên kết modes), `is_default` |
| `transportation.transportation_modes` | + 12 cột MCDM/UI: `code`, `icon`, `routing_profile`, `speed_factor`, `avg_speed_kmh`, `base_fare`, `cost_per_km`, `co2_per_km_g`, `avg_wait_min`, `accessibility_score`, `convenience_score`, `sort_order` |
| `transportation.transportation_locations` | + `lat`, `lng` (mirror số cho truy vấn khoảng cách nhanh), `city_id` |
| `trip.trips` | − `user_id` (guest); + 18 cột phân tích + phục hồi Kaggle: `origin_lat/lng`, `dest_lat/lng`, `origin_region_id`, `destination_region_id`, `origin_district`, `chosen_vehicle_type_id`, `switched`, `top_mode_id`, `top_score`, `departure_hour`, `distance_km`, `duration_min`, `lez_affected`, `avg_cost_vnd`, `avg_time_min`, `origin_ward_code`, `destination_ward_code` |
| `trip.trip_routes` | + `routing_profile` (OSRM profile từng phương thức), `route_index` |
| `trip.trip_lez_analyses` | + `vehicle_type_id`, `applicable_lez_rule_id`, `route_lez_status`, `compliance_status`, `compliance_reason` (kết quả tuân thủ chi tiết thay vì chỉ boolean `intersects`) |

### Đã dỡ (đưa về đúng tài liệu)

- **8 bảng governance/audit** (core.audit_details, core.data_source_checks,
  core.dataset_snapshots, core.report_runs, core.warning_tasks,
  decision.weight_presets, policy.lez_exemptions, policy.lez_zone_wards) —
  không có trong DB FINAL/ERD, không endpoint giao diện nào sử dụng; schema tự
  DROP khi boot để dọn cả volume cũ.
- Bảng `public.Ward` (đã gộp vào `gis.administrative_regions` — phương án A′).
