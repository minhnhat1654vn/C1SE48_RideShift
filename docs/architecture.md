# RideShift — System Architecture (đối chiếu proposal C1SE.48)

> C1SE.48 Capstone Project 1 — Smart Transport Transition Advisor
> Tài liệu này viết lại từ đầu, đối chiếu **trực tiếp với văn bản proposal gốc**
> (`C1SE48_ProposalDocument_v1.0`, mục §10 Technology Stack, §12 System Architecture
> Overview, §13 Risks, §14 Deliverables, Objective 3/10, NFR-02, Scope #18).

---

## 1. Kết luận audit nhanh

| Phạm vi | Kết luận |
|---|---|
| **Kiến trúc tổng thể** (§12: 5 actor + luồng dữ liệu) | ✅ **Khớp** — đủ 5 actor: User, Admin, Map & Routing (OSM+OSRM), Air Quality (Open-Meteo), hệ thống trung tâm RideShift |
| **Backend** (§10: Python + FastAPI) | ✅ **Khớp** — FastAPI/UVicorn port 8000, 25 REST endpoints, Swagger tự sinh tại `/docs` |
| **Database** (§10 + Deliverable #10 + NFR-02) | ✅ **Khớp** — PostgreSQL + PostGIS dual-mode (xem `database.md`) |
| **Frontend** (§10: ReactJS / HTML5-CSS3-JS) | ✅ React 19 (Next.js App Router) / ➕ mở rộng: TypeScript + Tailwind + shadcn/ui |
| **MCDM** (§10: MCDM/TOPSIS) | ✅ TOPSIS (Hwang & Yoon) trên numpy, 7 tiêu chí, trọng số admin cấu hình được |
| **Docker** (Scope #18) | ✅ docker-compose.yml + 2 Dockerfile hoàn chỉnh / ⚠️ sandbox không có Docker daemon để chạy thử |
| **Deliverable #11 — Processed Survey Dataset** | ⚠️ **LỖI HỢP cần khắc phục**: pipeline pandas hoạt động đủ 4 sản phẩm (cleaned/transformed/analysis/features) nhưng **file nguồn hiện là scaffold 2.400 dòng**, không phải Kaggle "Vehicle at Ha Noi Dataset" 25.590 dòng (bản tích hợp thật đã mất khi sandbox reset — xem §8) |

Chi tiết từng dòng: `docs/tech-stack.md` (15/15 dòng của bảng §10).

---

## 2. Kiến trúc hiện tại (logical view)

```
┌────────────────────────────────────────────────────────────────────┐
│                            Browser                                 │
│      React 19 UI (Next.js App Router) + Leaflet map + shadcn/ui    │
│      src/app/page.tsx + src/components/rideshift/*                 │
└───────────────┬────────────────────────────────────────────────────┘
                │  fetch('/api/...?XTransformPort=8000')   (JSON + cookie)
                │  (src/lib/api.ts — gateway helper)
                ▼
┌────────────────────────────────────────────────────────────────────┐
│                   FastAPI backend — Python 3.12                    │
│  mini-services/fastapi-backend/main.py  (UVicorn, port 8000)       │
│                                                                    │
│  routers/public (7)      routers/trip (2)         routers/admin (16)│
│   /health                 POST /api/trip/analyze   login/logout/me  │
│   GET /api/zones          POST /api/trips/{id}/    zones CRUD        │
│   GET /api/modes               /choice             rules CRUD        │
│   GET /api/locations                                modes PUT         │
│   GET /api/geocode        services/                 weights GET/PUT   │
│   GET /api/airquality      geo.py        Shapely    analytics (pandas)│
│   GET /api/dataset/summary external.py   OSRM/       dataset reprocess │
│                            │            Nominatim/AQI                │
│                            mcdm.py       TOPSIS                     │
│                            airquality.py cache 30'                  │
│                            trend.py      pandas pipeline            │
└───────┬───────────────────────────────────────┬────────────────────┘
        │ psycopg 3 (connection-per-request)    │ httpx (IPv4-pinned + UA)
        ▼                                       ▼
┌───────────────────────┐        ┌──────────────────────────────────┐
│  PostgreSQL           │        │  External services (per §12)     │
│  18.4 user-space      │        │   Nominatim — geocoding (OSM)    │
│  (sandbox) /          │        │   OSRM FOSSGIS — road routing    │
│  postgis:16-3.4       │        │   Open-Meteo — air quality       │
│  (docker-compose)     │        │   OSM raster tiles — Leaflet     │
│  11 tables            │        └──────────────────────────────────┘
│  app/schema.sql       │
│  + seed.py            │
└───────────────────────┘
```

Next.js là **presentation layer thuần**: `src/app/api/**` đã xóa, Prisma không còn
chạy tại runtime (chỉ còn `prisma/schema.prisma` làm tư liệu tham chiếu).
Toàn bộ business logic nằm ở Python — đúng vai trò "REST API and business logic"
mà §10 của proposal giao cho FastAPI.

---

## 3. Đối chiếu System Context Diagram (proposal §12)

Proposal mô tả hệ thống trung tâm + 4 actor bên ngoài. Bảng dưới ánh xạ từng
actor → thành phần thật trong code:

| Actor trong proposal §12 | Đưa vào hệ thống gì | Nhận lại gì | Cài đặt ở đâu |
|---|---|---|---|
| **Individual User** | Origin, Destination, Vehicle type, Travel time, Trip purpose, Preferences | Route, Distance, Travel time, LEZ status, Vehicle compliance, Air quality, Recommendations, Option comparison | Form trong `planner.tsx` gửi đúng 6 trường này → `POST /api/trip/analyze` trả về đủ 8 nhóm thông tin (route geometry, distance/duration, LEZ status outside/partial/within, compliance per mode, AQI, ranked recommendations, comparison, impact) |
| **System Administrator** | LEZ areas, Policy rules, Vehicle restrictions | Transportation trends, Regional analytics, Switching patterns, Policy analytics | `admin-dashboard.tsx`: LEZ Zones CRUD + Policy Rules CRUD + Modes & Weights → `routers/admin.py`; 4 nhóm analytics đọc từ `GET /api/admin/analytics` (trend theo mode, phân bổ theo quận, switching rate, KPI chính sách) |
| **Map & Routing Service** | Origin, Destination, routing options | Route geometry, Distance, Estimated time, map data | Nominatim (geocode) + OSRM FOSSGIS/demo (route) qua `services/external.py`; cache RAM 30' + fallback ước lượng (đúng mitigation "Map/routing API unavailable" của §13) |
| **Air Quality Service** | Location/coordinates, time range | AQI, pollutant info, measurement time, status | Open-Meteo Air Quality qua `services/airquality.py`; cache DB 30' + hiển thị update time + mô phỏng dự phòng (đúng mitigation "Air quality API failure" của §13) |

Điểm proposal nhấn mạnh — *"OSRM only performs route calculation. The determination
of whether a route intersects with an LEZ is handled separately by RideShift through
a PostGIS Spatial Query within the system's internal architecture"* — được cài đúng:
OSRM chỉ trả polyline; việc outside/partial/within được quyết định bởi lớp không gian
nội bộ (`services/geo.py`): Shapely trong sandbox, PostGIS trong deployment Docker.

---

## 4. Luồng xử lý chính — `POST /api/trip/analyze`

1. **Geocode** origin/destination (Nominatim + fallback local list).
2. **Route** (OSRM): distance, duration, polyline ~370 điểm; cache RAM 30 phút;
   nếu cả 2 provider hỏng → synthetic route + cờ `source: 'estimated'`.
3. **LEZ spatial**: dựng polygon từng `lez_zone` từ `coordinates` (JSON [lat,lng]),
   so route vs zone → `outside | partial | within` + % chiều dài trong zone.
   - Có PostGIS: đồng bộ `lez_zone.geom` (GIST) phục vụ truy vấn DB-level.
   - Không PostGIS (sandbox): Shapely `ParallelOffset/sampling` trong app layer — kết quả như nhau.
4. **Compliance**: quét `policy_rule` theo zone×mode (banned/conditional, giờ, ngày trong tuần, điều kiện Euro standard).
5. **Air quality**: AQI theo tọa độ (cache bảng `air_quality_cache`, TTL 30').
6. **Trend criterion**: bảng `dataset_trend` do pipeline pandas tạo (fallback `TREND_PRIOR`).
7. **TOPSIS** (`mcdm.py` trên numpy): 7 tiêu chí × 7 mode, trọng số từ `criteria_weight`
   (25 travelTime / 20 cost / 20 lezCompliance / 10 accessibility / 10 convenience / 10 environment / 5 trend);
   cost-type criteria (`travelTime`, `cost`) đảo chiều benefit chuẩn TOPSIS.
8. **Persist** `trip_record` (top mode, score, LEZ flag, chi phí/thời gian trung bình).
9. `POST /api/trips/{id}/choice` ghi `chosen_mode_id` + `switched` → nguồn liệu
   cho KPI "switching intention" của admin.

## 5. Sơ đồ deployment (Docker — Scope #18)

```yaml
docker-compose.yml
├── db        : postgis/postgis:16-3.4 (healthcheck pg_isready) — volume pgdata
├── backend   : build ./mini-services/fastapi-backend (python:3.12-slim + uvicorn)
│               DATABASE_URL=postgresql://postgres:postgres@db:5432/rideshift
└── frontend  : build Dockerfile gốc (bun build → standalone), NEXT_PUBLIC_API_BASE build-arg
```

- `db` khởi tạo extension PostGIS sẵn trong image → `app/db.py::enable_postgis_if_available()`
  thành công, tạo `lez_zone.geom geometry(Polygon,4326)` + GIST index (NFR-02) và
  backfill từ `coordinates` JSON mỗi lần boot.
- Sandbox dev KHÔNG có Docker/root: PostgreSQL chạy user-space (embedded-postgres 18.4,
  `scripts/postgres.ts start`), PostGIS fallback Shapely — đây là **hạn chế môi trường**,
  không phải hạn chế thiết kế.

## 6. Vận hành trong sandbox (runbook)

| Thành phần | Lệnh | Port |
|---|---|---|
| PostgreSQL | `bun run db:pg:start` (auto-init `db/pgdata`, user postgres, trust) | 5432 |
| FastAPI | `cd mini-services/fastapi-backend && bun run dev` (uvicorn --reload) | 8000 |
| Next.js | `bun run dev` | 3000 |
| Gateway | Caddy tự quản (platform) | 81 |

- Browser gọi API qua gateway: `/api/...?XTransformPort=8000` (`src/lib/api.ts` tự chèn).
- Lưu ý reset: DATABASE_URL do platform inject có thể trỏ `file:...custom.db` —
  `app/config.py` tự về `postgresql://postgres@127.0.0.1:5432/rideshift` khi URL không phải postgres.
- Quan sát: `dev.log` (Next), `mini-services/fastapi-backend/fastapi.log`.

## 7. Rủi ro §13 → biện pháp đã cài trong kiến trúc

| Rủi ro (proposal §13) | Mitigation trong code |
|---|---|
| Map/routing API unavailable (High) | Provider chain FOSSGIS → OSRM demo → synthetic; cache RAM 30'; cờ `estimated` trên UI |
| Air quality API failure (Medium) | Cache DB TTL 30' + hiển thị `fetchedAt` + mô phỏng dự phòng |
| LEZ policy changes (High) | LEZ zones/rules CRUD runtime qua admin API, không cần redeploy |
| Recommendation inaccuracy (Medium) | Trọng số 7 tiêu chí chỉnh được + sum=100 validation; top-k + breakdown từng tiêu chí |
| Spatial data processing errors (Medium) | 3 trạng thái outside/partial/within test được; dual-mode PostGIS/Shapely |
| External API changes (Medium) | External services gói trong `services/external.py` (một lớp duy nhất) |
| Security vulnerabilities (Medium) | sha256+salt, session 8h httpOnly cookie, 401/400 envelope, input validation Pydantic |
| Poor system performance (Medium) | GIST index (PostGIS mode), index `trip_record(created_at, purpose)`, cache route + AQI |

## 8. Khoảng trống đang mở (quan trọng)

**Deliverable #11 — nguồn dữ liệu khảo sát đã bị cuộn lùi.** Lần reset sandbox gần nhất
(trước phiên này) đã khôi phục project về snapshot Task-16:

- `data/vehicle_at_hanoi.csv` hiện là **scaffold 2.400 dòng** do `tools/make_dataset.py`
  sinh ra (deterministic, đúng schema cột) — KHÔNG phải Kaggle "Vehicle at Ha Noi
  Dataset" 25.590 dòng × 58 cột mà proposal trích ("a survey dataset of over 25,000 samples").
- `app/services/trend.py` hiện là bản pipeline theo **tháng** (2.400 dòng) — bản
  cohort-based cho Kaggle (period 6 độ tuổi, growth = −polyfit, trend_index =
  0.6×adoption + 0.4×growth) đã mất.
- `data/district_data.csv` (30 quận × 6 đặc trưng) và `data/processed/district_features.csv` cũng không còn.

Cơ chế pipeline + bảng `dataset_trend`/`dataset_run` + 4 processed CSV vẫn nguyên vẹn —
chỉ cần tải lại CSV Kaggle và port lại phần đọc/feature-engineering là đóng kín gap.
Kiến trúc và database **không** bị ảnh hưởng bởi khoảng trống này.

## 9. Đối chiếu bộ tài liệu chính thức v1.0 (Task 23)

So sánh toàn bộ hệ thống với 4 tài liệu chính thức: **Proposal v1.0**,
**Project Plan v1.0**, **Product Backlog v1.0** (35 PBI), **User Story v1.0**
(35 US, acceptance criteria chi tiết).

### 9.1 Kết quả đối chiếu 35 User Story

| Nhóm | Kết quả trước khi sửa | Ghi chú |
|---|---|---|
| US-01…US-20 (Individual User) | 13 FULL · 7 PARTIAL | 0 MISSING |
| US-21…US-35 (System Administrator) | 12 FULL · 3 PARTIAL | 0 MISSING |

**Các điểm lệch đã phát hiện và đã sửa xong (Task 23-c/d/e):**

| US | Lệch so với acceptance criteria | Đã sửa |
|---|---|---|
| US-01 | Thiếu chọn điểm bằng click trên map | Nút "Pick on map" cho origin/destination + hint + Esc cancel |
| US-03 | Nhãn "Baseline time" | Đổi thành "Estimated travel time" |
| US-05 | Không liệt kê trạng thái từng vùng LEZ | Thẻ "LEZ zone check" liệt kê MỌI vùng active: Outside / Partially intersects / Completely inside + % inside |
| US-08 | Thiếu ngữ cảnh địa lý của dữ liệu AQ | `locationLabel` = "Route midpoint: {origin} → {destination}" |
| US-11 | Thiếu dòng Distance trong bảng so sánh | Thêm "Travel distance" |
| US-15 | Swap chưa tính lại lộ trình | Swap tự động re-analyze khi đã có kết quả |
| US-16 | Mặc định giờ đi = now+5' | Mặc định = hiện tại |
| US-18 | Không báo khi địa điểm ngoài khu vực | Hint "No match inside Hanoi — the supported area is Hanoi only." |
| US-19 | Không có cache → hiển thị số ước lượng | Trả trạng thái `unavailable` + thông báo đúng AC3 |
| US-25 | Dashboard chỉ tổng hợp trip_record | Thêm thẻ "Survey dataset" (dataset_run/dataset_trend) + nút Reprocess |
| US-22 | Chưa validate phạm vi tọa độ | Validate lat∈[-90,90], lng∈[-180,180] server-side |
| US-29/35 | LIMIT 500 khi tổng hợp analytics | Đã bỏ, tổng hợp toàn bộ khoảng ngày |
| US-32 | Vô hiệu hóa không có xác nhận | AlertDialog xác nhận cho zone/rule |
| US-33 | Chưa có UI thêm/sửa mode | Dialog Add/Edit mode (upsert PUT /api/admin/modes) |

### 9.2 Verdict cuối

- **User Story v1.0:** 35/35 acceptance criteria đạt sau khi sửa (không còn PARTIAL/MISSING).
- **Product Backlog v1.0:** 35/35 PBI khớp — status Approved, sprint mapping đúng Project Plan.
- **Project Plan v1.0:** architecture + DB khớp baseline (Agile Scrum, Docker, deliverables 1–16 trừ khoảng trống dataset Kaggle đã ghi ở §8).
- **Proposal v1.0:** MATCH 15/15 dòng tech stack (audit Task 21), System Context 5/5 actor, FR-01…FR-15 + NFR đề cập đều được thỏa.

Còn mở duy nhất: nguồn CSV Kaggle 25.590 dòng (Deliverable #11) — xem §8.
