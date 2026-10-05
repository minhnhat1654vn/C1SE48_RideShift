# RideShift — Gap Analysis: Proposal ↔ Codebase

> Ngày phân tích: 04/10/2026. Nguồn: Proposal v1.0 (65tr) ↔ code (đọc trực tiếp).
> Quy ước: ✅ hoàn thành · 🟡 một phần · 🔴 chưa có · ⚠️ khác biệt. Mọi dòng có bằng chứng file:line.

## PHẦN A — Technology Stack (12 mục proposal §10)

| # | Hạng mục | Trạng thái | Bằng chứng trong code | Ghi chú |
|---|---|---|---|---|
| A1 | ReactJS | ✅ | `frontend/package.json`: react `^19.0.0` + next `^16.1.1` | Next.js App Router thỏa "ReactJS" |
| A2 | HTML5/CSS3/JS | ✅ | TypeScript `^5` + Tailwind `^4` + shadcn/ui; build ra HTML/CSS/JS chuẩn | TS là siêu tập của JS — tech-stack.md đánh giá "mở rộng chấp nhận được" |
| A3 | Leaflet/MapLibre | ✅ | leaflet `1.9.4` + react-leaflet `5.0.0`; `map-view.tsx` (polyline, polygon, markers, 3D wards) | Chọn Leaflet trong 2 lựa chọn của proposal |
| A4 | Python + FastAPI | ✅ | `requirements.txt`: fastapi `==0.128.0`, uvicorn `==0.40.0`; `backend/Dockerfile`: `python:3.12-slim` | 25 REST endpoints, Swagger `/docs` |
| A5 | PostgreSQL | ✅ | `docker-compose.yml:15`: image `postgis/postgis:16-3.4` | 11 bảng, schema do backend sở hữu |
| A6 | PostGIS | ⚠️ | `db.py:58-120`: `CREATE EXTENSION` + cột `geom geometry(Polygon,4326)` + GIST + backfill/sync. **Nhưng grep toàn backend: 0 câu truy vấn `ST_*` trong app** — phân tích outside/partial/within chạy Shapely (`geo.py`) | **Mâu thuẫn**: proposal Objective 3 ("spatial operations using PostgreSQL/PostGIS") + `docs/db.md` §5 claim "Docker: spatial query chạy trong DB" — **không đúng với code**. Kết quả nghiệp vụ tương đương; hạ tầng PostGIS có sẵn nếu muốn chuyển query xuống DB. **QUYẾT ĐỊNH 04/10: giữ Shapely làm đường chính** — accepted deviation, decision sẽ ghi vào architecture.md (GC-S4) |
| A7 | OpenStreetMap | ✅ | `config.py:28` Nominatim; OSM tiles trong map-view | |
| A8 | OSRM | ✅ | `config.py:29-34`: provider chain driving/cycling/walking; `external.py` + cache TTL + fallback synthetic | Self-host là module tùy chọn `osrm/` |
| A9 | Open-Meteo/OpenAQ | ✅ | `config.py:35`: air-quality-api.open-meteo.com; cache DB `air_quality_cache` | Proposal là "Open-Meteo **/ OpenAQ**" — dùng 1 nguồn là hợp lệ; OpenAQ không dùng |
| A10 | Python + Pandas | ✅ | pandas `==2.2.3` (+ numpy `==2.1.3`); `trend.py` pipeline; `admin.py` analytics | |
| A11 | MCDM/TOPSIS | ✅ | `mcdm.py` — TOPSIS (Hwang & Yoon 1981), 7 tiêu chí, vector normalization chuẩn | Proposal cho "TOPSIS hoặc method khác" — đã chọn TOPSIS |
| A12 | Docker | ✅ | `docker-compose.yml` 3 services + 2 Dockerfile (bun builder → standalone) | **Đã chạy thành công end-to-end** (stack up, seed OK) |

## PHẦN B — Objectives (10 mục)

| # | Hạng mục | Trạng thái | Bằng chứng trong code | Ghi chú |
|---|---|---|---|---|
| B1 | 1. Interactive Map | ✅ | `map-view.tsx` (LEZ polygons, route polyline :656, markers điểm đón); `planner.tsx` geocode debounce :306, pick-on-map; geolocation | |
| B2 | 2. Route Calculation | ✅ | `external.py` OSRM chain → geometry/distance/duration + fallback `source: estimated` | |
| B3 | 3. LEZ Spatial Analysis | ✅ | `geo.analyze_route_vs_zones` → outside/partial/within; % chiều dài trong zone | Kết quả đúng proposal; **cơ chế** xem ⚠️ A6 |
| B4 | 4. Vehicle & Policy Checking | ✅ | `trip.py:145-240`: tri-state theo vehicle × zone × giờ × ngày; `results.tsx:217,576-579` thẻ cảnh báo | |
| B5 | 5. Air Quality Integration | ✅ | `airquality.py` (Open-Meteo, pm2.5/pm10/us_aqi, `measuredAt`, nhãn dự phòng) + cache `air_quality_cache` (schema.sql:111); 4 component hiển thị AQ | Proposal form đăng ký ghi "real-time AQI" — cache là thiết kế Objective 5 cho phép |
| B6 | 6. Recommendation Engine | ✅ | `mcdm.py` TOPSIS + 7 tiêu chí (time/cost/lezCompliance/accessibility/convenience/environment/trend); purpose (`PURPOSE_CONVENIENCE`), preferences 0-100 (planner 4 preset), trend từ `dataset_trend`, contributions giải trình | |
| B7 | 7. Option Comparison | ✅ | `results.tsx:630` `ComparisonTable` — time/distance/cost/compliance + "Điểm tổng" :654 | |
| B8 | 8. Impact Estimator | 🟡 | `results.tsx:700-775` "Ước lượng tác động": delta time/cost/CO₂ + badge compliance, so current vs top (hoặc runner-up) | **Mâu thuẫn nội bộ proposal**: Objective 8 liệt kê 6 trường; US-12 AC chỉ yêu cầu 3 (time/cost/compliance). Code có 4 — **vượt AC, thiếu 3 trường so với Objective 8** (accessibility/convenience/overall). **QUYẾT ĐỊNH 04/10: giữ 4 trường hiện trạng** (chuẩn nghiệm thu = US-12 AC) — Objective 8 là accepted deviation |
| B9 | 9. Administrative Dashboard | ✅ | `admin.py`: zones/rules CRUD + modes PUT + weights (sum=100) + analytics pandas (total, lezAffectedPct, switchingPct, byDistrict, byPurpose, switched-to) + dataset card + reprocess | |
| B10 | 10. Data Processing (>25k survey) | 🟡 | `trend.py` pipeline pandas đầy đủ (clean→transform→trend) + auto-run khi trống + `dataset_run` audit log. **Nhưng nguồn = `vehicle_at_hanoi.csv` 2.400 dòng scaffold** | **Mâu thuẫn**: proposal cam kết ">25,000 samples" (Kaggle 25.590×58 cột); `architecture.md` §8 xác nhận bản tích hợp thật đã mất khi sandbox reset. **CẬP NHẬT Q4 (04/10): sẽ nạp dataset Kaggle trước GC-S5** — owner được assign trong tuần này → B10 là mục có thể đóng. (Quyết định trước đó "giữ 2.400 dòng" bị đảo ngược bởi Q4) |

## PHẦN C — Functional Requirements (FR-01…FR-15)

| # | Hạng mục | Trạng thái | Bằng chứng trong code | Ghi chú |
|---|---|---|---|---|
| C1 | FR-01 specify origin | ✅ | `planner.tsx` geocode debounce :306 + pick-on-map (`PICK_LABEL` :76) | |
| C2 | FR-02 specify destination | ✅ | như trên (pick origin/destination) | |
| C3 | FR-03 display route | ✅ | `map-view.tsx:656` route polyline từ `routeCoords` | |
| C4 | FR-04 display LEZ boundaries | ✅ | `map-view.tsx` polygon các `lez_zone` active | |
| C5 | FR-05 display transport locations | ✅ | `map-view.tsx:20-21` markers `transportation_location`; seed 12 điểm (bus/metro/BRT) | |
| C6 | FR-06 air quality info | ✅ | `/api/airquality` (`public.py:67`); 4 component dùng AQ (planner/map-view/results/admin) | |
| C7 | FR-07 AQ timestamp | ✅ | `measuredAt` (nullable) + `locationLabel` ngữ cảnh (`airquality.py:8`) | |
| C8 | FR-08 calculate route | ✅ | `external.get_route` OSRM chain + fallback | |
| C9 | FR-09 route distance | ✅ | `distance_km` (`trip_record` schema.sql:93) trả về cùng response | |
| C10 | FR-10 estimated travel time | ✅ | `duration_min` + per-mode `travelTimeMin` | |
| C11 | FR-11 route intersects LEZ | ✅ | `geo.analyze_route_vs_zones` → outside/partial/within | |
| C12 | FR-12 identify applicable rules | ✅ | `trip.py:148-155` query `policy_rule` theo zone bị đi qua | |
| C13 | FR-13 check vehicle vs restrictions | ✅ | `trip.py:158-240` compliance loop (vehicle × rule × dep_day × dep_minutes) | |
| C14 | FR-14 display applicable conditions | ✅ | `rule_dtos` (restrictionType/condition/startTime/endTime/days) hiển thị ở results (US-17) | |
| C15 | FR-15 warn on restriction/violation | ✅ | `results.tsx:217-224` cảnh báo; banned → thẻ riêng không có rank/nút chọn (:576-579) | |

## PHẦN D — Non-Functional Requirements (trọng tâm + tóm lược phần còn lại)

| # | Hạng mục | Trạng thái | Bằng chứng trong code | Ghi chú |
|---|---|---|---|---|
| D1 | NFR-01 Performance — response time | 🟡 | Cache 2 lớp: route in-memory TTL (`external.py:120-126`, TTL từ `config.ROUTE_CACHE_TTL_SECONDS`) + AQ DB cache; index `trip_record(created_at, purpose)` (schema.sql:108-109) | Có **cơ chế**, **chưa có phép đo nào** (không benchmark) — số liệu cụ thể: cần xác minh thêm |
| D2 | NFR-02 PostGIS indexes | 🟡 | GIST `lez_zone_geom_gist` được tạo khi PostGIS bật (`db.py:76-78`) — đúng chữ NFR-02 | Nhưng **không có spatial query nào chạy trong DB** để được tối ưu (xem ⚠️ A6) — index tồn tại, không được sử dụng |
| D3 | NFR-03 External API không chặn | ✅ | Mọi call ngoài có timeout + provider chain + fallback; handler sync chạy threadpool FastAPI | |
| D4 | NFR-07 Admin authentication | ✅ | Session cookie `rs_admin_session` **httponly, samesite=lax** TTL 8h (`auth.py:45-46`); hash `SALT$sha256(SALT:password)` | |
| D5 | NFR-08 Admin authorization | ✅ | Mọi handler admin `Depends(auth.require_admin)` (`admin.py` từng endpoint) | |
| D6 | NFR-09 Input validation | ✅ | Pydantic: `Point`, `purpose` pattern, `Preferences` ge/le 0-100 (`trip.py:34-56`); validate phạm vi lat/lng theo audit US-22 (docs) | Chi tiết US-22: cần xác minh thêm nếu cần trích dòng |
| D7 | NFR-10 Vulnerability protection | 🟡 | CORS `allow_origins=["*"]` **kèm** `allow_credentials=True` (`main.py:52-58`) — cấu hình quá rộng; hash sha256+salt (nhanh, không bcrypt/argon2); chưa có rate limit / security review | Input validation tốt (D6) nhưng tổng thể là 🟡 |
| D8 | NFR-11 Graceful external failure | ✅ | OSRM chain → synthetic route cờ `estimated`; AQ fallback labels; Nominatim local list | |
| D9 | NFR-12 Caching | ✅ | `air_quality_cache` DB (schema.sql:111-116) + route in-memory TTL (`external.py:120-126`) | |
| D10 | NFR-13 Errors logged, không lộ info | ✅ | `main.py:65-73`: catch-all → log server + message chung tiếng Việt; envelope tập trung | Logging bằng `print` — chưa structured (note nhỏ) |
| D11 | NFR-17 Backend modules | ✅ | routers/services/db tách rõ; TOPSIS/geo/external/airquality/trend độc lập I/O | Note: `analyze` ~350 dòng inline trong router (nợ cấu trúc) |
| D12 | NFR-18 Frontend reusable modules | 🟡 | Component hóa theo feature; NHƯNG `ignoreBuildErrors: true` (next.config), ~40/60 dep không import, dead code `src/lib`, component 1.9k dòng | |
| D13 | NFR-19 Standardized API | ✅ | Pydantic models + DTO camelCase (`dto.py`) + envelope `{error}` | |
| D14 | NFR-20 Git | ✅ | Repo + remote GitHub (`minhnhat1654vn/C1SE48_RideShift`) | |
| D15 | **Testing (In-Scope #17 + Deliverable #13)** | 🔴 | `find` toàn repo: **0 test file** (pytest/jest/CI đều không tồn tại) | Mục **đỏ duy nhất** của toàn bộ gap analysis |
| D16 | NFR-04…06 Usability | ✅ | UI tiếng Việt, nhãn rõ, cảnh báo 3 màu (xanh/vàng/đỏ), mobile-first | Tóm lược |
| D17 | NFR-14…16 Scalability/Configurable | ✅ | Vùng/quy định/phương tiện/trọng số là **dữ liệu** CRUD — thêm mode/khu vực không đổi code | Tóm lược |

## Tổng hợp

| Phần | ✅ | 🟡 | 🔴 | ⚠️ |
|---|---|---|---|---|
| A — Tech Stack (12) | 11 | 0 | 0 | 1 (A6 PostGIS) |
| B — Objectives (10) | 8 | 2 | 0 | 0 |
| C — FR (15) | 15 | 0 | 0 | 0 |
| D — NFR + Testing (17) | 12 | 4 | 1 (D15 Testing) | 0 |
| **Tổng (54)** | **46** | **6** | **1** | **1** |

- **% hoàn thành trọn vẹn:** 46/54 = **85%**
- **% hoàn thành có trọng số** (✅=1, 🟡=0.5): 49/54 ≈ **91%**

## Top 5 Critical trước demo 06/12/2026

> **Cập nhật 04/10 (sau khi Scrum Master chốt):** mục 5 phần Impact → **giữ hiện trạng, accepted deviation** (GC-S4 4.1); **mục 2 dataset Kaggle QUAY LẠI kế hoạch theo Q4** — owner được assign trong tuần này, nạp trước GC-S5. Bảng dưới giữ nguyên như bản audit gốc để đối chiếu.

1. **🔴 D15 — Dựng bộ kiểm thử + Testing Documentation** (Deliverable #13 là mục nộp bắt buộc). 4 seam sẵn sàng: HTTP contract, `topsis()`, spatial, pipeline. Ảnh hưởng: không có lưới an toàn cho mọi thay đổi trước demo + thiếu cả deliverable.
2. **🟡 B10 — Nạp dataset Kaggle >25.000 dòng** (Deliverable #11, Objective 10). Bằng chứng nhìn thấy được ngay trên dashboard; cần account Kaggle — phân công người sớm.
3. **🟡 D7 — Hardening security**: thu hẹp CORS (env-based allowlist), cân nhắc bcrypt, viết security checklist. Điểm dễ bị ban khảo sát chất vấn nhất trong demo.
4. **🟡 D12 — Prune ~40 dep chết + bật type-check + dọn dead code/di tích** (trước khi freeze code): loại rủi ro "bị hỏi code chết" và tái kích hoạt scoring phía client.
5. **🟡 B8 — Hoàn thiện Impact Estimator đủ 6 trường Objective 8 + mini-evaluation** (số đo performance + sensitivity trọng số): đóng nốt Objective 8 và có số liệu trả lời "chứng minh TOPSIS ổn định".

## Có thể cắt nếu không kịp (không phá deliverable nào)

- **PostGIS-first query path** (A6): giữ Shapely làm đường chính, ghi báo cáo như quyết định thiết kế có 2 adapter.
- **OpenAQ** làm nguồn AQ thứ hai (A9) — proposal chỉ yêu cầu một trong hai.
- **Self-host OSRM** (`osrm/`) — public chain + fallback đã đủ demo.
- **Postman collection** — pytest suite + tài liệu thay thế được (ghi chú vào báo cáo).
- **`restriction_type = fee_only`** cho ô tô cá nhân — giữ `conditional` hiện tại.
- **Impact delta đầy đủ** nếu theo US-12 AC thay vì Objective 8 (đang chờ chốt nguồn chuẩn nghiệm thu).

## Mâu thuẫn proposal ↔ code (tổng hợp)

1. **A6/B3**: Proposal + `db.md` nói spatial query chạy PostgreSQL/PostGIS — code chạy Shapely; PostGIS chỉ là hạ tầng được đồng bộ, không truy vấn.
2. **B10**: ">25,000 samples" vs 2.400 dòng scaffold.
3. **B8**: Objective 8 (6 trường) vs US-12 AC (3 trường) — code ở giữa (4 trường).
4. **B4/A6 note**: Ảnh minh họa proposal "06:00–22:00" vs Chỉ thị 20/CT-TTg + seed "24/7, từ 01/07/2026" (ngày hiệu lực không được mô hình hóa — chỉ nằm trong `condition` text).
5. **D4**: Form đăng ký ghi JWT vs code dùng cookie phiên (quyết định thiết kế đã ghi nhận).
6. **B5 note**: "Real-time AQI" (form đăng ký) vs cache 30' — nằm trong phạm vi Objective 5 cho phép.
