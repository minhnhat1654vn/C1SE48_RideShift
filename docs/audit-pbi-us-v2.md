# Audit 41 PBI (Product Backlog v2.0) — đối chiếu Demo my-project và Repo GitHub

| Mục | Giá trị |
|---|---|
| Phạm vi | 41 Product Backlog Item (PBI-01..PBI-41, ánh xạ 1-1 với US-01..US-41 v2.0) so với 2 codebase: demo `/home/z/my-project` (frontend `src/components/rideshift/*` + backend `mini-services/fastapi-backend/app/*` đã refactor trên DB v2 — 22 bảng/7 schema, PostGIS, pgserver socket `/home/z/rideshift-pgv2`) và clone repo nhóm `/home/z/rideshift-github` (monorepo `frontend/` + `backend/`, bản v2: `planner-v2.tsx`, `api-v2.ts`, `trip_v2.py`, `admin_v2.py`, `compliance_v2.py`, `recommendation_v2.py`) |
| Ngày audit | 17/10/2026 |
| Nguồn đối chiếu | `3_C1SE48_UserStory_v2.0.docx` + `2_C1SE48_ProductBacklog_v2.0.docx` (upload 01/10/2026) |
| Phương pháp | Đọc code thật (file:line), truy vấn SELECT DB v2, KHÔNG sửa code/docs ngoài file audit này |

**Thang mức:**

- ✅ **Đạt** — AC cốt lõi có trong code, có bằng chứng cụ thể.
- 🟡 **Một phần** — có nhưng thiếu một phần AC, hoặc đúng API nhưng thiếu UI (và ngược lại).
- ❌ **Chưa có** — không tìm thấy trong codebase.
- ➖ **N-A** — không áp dụng.

---

## 1. Bảng tổng hợp 41 PBI

Sprint: S1 = PBI-01..05, S2 = 06..08, S3 = 09..15, S4 = 16..26, S5 = 27..29, S6 = 30..41.

| PBI | Tên | Sprint | Demo my-project | Repo GitHub | Bằng chứng | Gap chính |
|---|---|---|---|---|---|---|
| 01 | View Interactive Map | S1 | ✅ | ❌ | Demo: map-view.tsx:72 (HANOI_CENTER 21.0278,105.8342), :759-767 (route polyline), :746+ (LEZ), planner.tsx:384-406 (geolocation), 521-523 (facilities), map-view.tsx:341+ (mây AQI). Repo: planner-v2.tsx chỉ là form 459 dòng, leaflet chỉ nằm ở package.json:63 — không component map nào | Repo không có bản đồ tương tác |
| 02 | Specify Origin | S1 | ✅ | 🟡 | Demo: planner.tsx:297-306 (geocode debounce), :352/:646 (click map pick), :384-406 (vị trí hiện tại), :452-457 (bắt buộc chọn trước khi phân tích). Repo: planner-v2.tsx:56-150 (GeoSearch debounce 300ms + listbox) — không có click map vì không có map | Repo chỉ được gõ địa chỉ |
| 03 | Specify Destination | S1 | ✅ | 🟡 | Demo: planner.tsx:729 (pick đích), :458-463 (validate). Repo: planner-v2.tsx:234-237 (GeoSearch đích) | Như PBI-02 |
| 04 | View LEZ Boundaries | S1 | 🟡 | ❌ | Demo: map-view.tsx:746+ (vẽ polygon LEZ từ `/api/zones`, public.py:31-45 lọc ACTIVE) + chú giải planner.tsx:1073; nhưng KHÔNG có công tắc bật/tắt lớp LEZ (chỉ toggle "Điểm giao thông" planner.tsx:1086 và AQI). Repo: chỉ text danh sách vùng đi qua (planner-v2.tsx:336-358) | Demo thiếu toggle lớp LEZ; repo không có lớp bản đồ |
| 05 | View Transportation Facilities | S1 | ✅ | ❌ | Demo: public.py:66-78 (`/api/locations` từ `transportation.transportation_locations`, 12 điểm ACTIVE), planner.tsx:521-523 marker kind=transport, :82-84 (bus_stop/metro/brt), :1086 toggle. Repo: không endpoint locations, không hiển thị facility | Repo thiếu hoàn toàn |
| 06 | Calculate Route | S2 | ✅ | ✅ | Demo: external.py:247-274 (`get_route` chuỗi OSRM theo profile + cache + fallback), trip.py:121-123, trả coords/distanceKm/durationMin (trip.py:443-448). Repo: services/external.py cùng chuỗi OSRM; trip_v2.py:106-128 tính route theo từng routing_profile | Demo/repo dùng OSRM public server, có fallback ước tính khi offline |
| 07 | View Calculated Route | S2 | ✅ | 🟡 | Demo: map-view.tsx:759-767 (2 lớp polyline viền+thân), results.tsx:130-150 (km/phút/nguồn). Repo: planner-v2.tsx:327-333 chỉ text "km / phút (xe hơi) / nguồn" | Repo không vẽ tuyến |
| 08 | Recalculate Route | S2 | ✅ | 🟡 | Demo: planner.tsx:409-420 (swap đảo chiều + tự phân tích lại), :445-495 (đổi điểm → analyze lại). Repo: chỉ sửa form rồi bấm "Phân tích chuyến đi" lại (planner-v2.tsx:177-199), không có swap | Repo thiếu đảo chiều nhanh |
| 09 | Check Route LEZ Intersection | S3 | ✅ | ✅ | Demo: geo.py:83-105 `analyze_route_vs_zones` (Shapely, sample 200 điểm, outside/partial/within ≥95%), lưu `trip.trip_lez_analysis` trip.py:421-438. Repo: trip_v2.py:160-188 dùng PostGIS thật `ST_Intersects`/`ST_Intersection`/`ST_Length(::geography)` — đúng notes hơn demo | Demo dùng Shapely thay PostGIS (vẫn lưu kết quả vào DB v2) |
| 10 | Determine Applicable LEZ Policy | S3 | ✅ | ✅ | Demo: trip.py:143-147 (lọc rule theo zone đi qua), rule DTO start/end/days (164-177); DB `policy.lez_rules`. Repo: compliance_v2.py:23-42 `rule_applies_at` (ACTIVE + ngày ISO + khung giờ qua đêm + effective_from/to) | — |
| 11 | Select Vehicle Type | S3 | ✅ | ✅ | Demo: planner.tsx:782 (Select vehicleId), nguồn `/api/modes` (public.py:48-63 từ `transportation.transportation_modes`), validate 400 trip.py:114-118. Repo: planner-v2.tsx:239-254 (dropdown `vehicle_types`), trip_v2.py:44-58 `/api/v2/vehicle-types` | — |
| 12 | Enter Travel Time | S3 | ✅ | ✅ | Demo: planner.tsx:797-801 (input "Giờ xuất phát"), gửi `departureTime` (476), dùng khi đánh giá rule: trip.py:89-97, 139-140 (dep_minutes + isoweekday). Repo: planner-v2.tsx:268-274 (datetime-local), trip_v2.py:272-282 (+07:00 cho giờ VN) | — |
| 13 | Check Vehicle Compliance | S3 | ✅ | ✅ | Demo: seed_v2.py:96-119 `evaluate_compliance` (compliant / conditionally_restricted / not_permitted theo giờ + ngày), trip.py:148-184. Repo: compliance_v2.py:45-105 (thêm CONDITIONAL theo min_emission_level — sâu hơn demo) | — |
| 14 | Display Applicable Conditions | S3 | ✅ | 🟡 | Demo: trip.py:164-177 (rules DTO: zoneName, modeName, restrictionType, condition, start/end, days) → results.tsx:190-260 (ComplianceCard + danh sách quy định). Repo: planner-v2.tsx:371-377 chỉ hiện reason text | Repo không liệt kê rule/khung giờ/khu vực chi tiết |
| 15 | Receive Restriction Warning | S3 | ✅ | ✅ | Demo: results.tsx:214-226 (Alert đỏ "Cảnh báo: phương tiện không được phép đi trên tuyến này" / vàng có điều kiện). Repo: planner-v2.tsx:361-380 (role=alert ShieldAlert 2 mức) | — |
| 16 | View Air Quality Information | S4 | ✅ | ❌ | Demo: airquality.py:60-111 (Open-Meteo us_aqi/pm2.5/pm10), trip.py:186-193 (midpoint tuyến), results.tsx:316-322 (thẻ AQI + "Cập nhật"). Repo: không có service airquality, không endpoint `/api/airquality` — bảng `decision.air_quality_observations` có sẵn nhưng không code dùng | Repo thiếu toàn bộ AQI |
| 17 | Retrieve Air Quality Data | S4 | ✅ | ❌ | Demo: airquality.py:22-41 (Open-Meteo Air Quality API theo toạ độ; OpenAQ không dùng — đáp ứng "Open-Meteo/OpenAQ"), cache INSERT airquality.py:93-110. Repo: không có | — |
| 18 | Display Data Timestamp | S4 | ✅ | ❌ | Demo: results.tsx:320-322 `Cập nhật {measuredAt.toLocaleString('vi-VN')}`; measuredAt từ payload (airquality.py:38, 80). Repo: không có | — |
| 19 | Handle Air Quality API Failure | S4 | ✅ | ❌ | Demo: airquality.py:44-57 (cache `decision.air_quality_observations`, TTL 30 phút), :113-119 (stale cache + notice), :124-133 (UNAVAILABLE không bịa số — đúng US-19 AC3), fallback mô phỏng external.py:281-303. Repo: không có | — |
| 20 | Determine Transportation Alternatives | S4 | ✅ | ✅ | Demo: trip.py:219-267 (mọi mode ACTIVE → alternative). Repo: recommendation_v2.py:75-143 (modes ACTIVE, compliance theo vehicle_type is_default) | — |
| 21 | Collect Evaluation Criteria | S4 | ✅ | ✅ | Demo: trip.py:256-264 (7 raw: time 226, cost 227, LEZ 231, accessibility 233-236, convenience 238-239, environment 224, trend 241-243 từ survey + 90 ngày lịch sử 196-210). Repo: recommendation_v2.py:131-139 + trend on-the-fly từ `survey.vehicle_survey_responses` (29-46) | — |
| 22 | Normalize Criteria | S4 | ✅ | ✅ | Cả 2: services/mcdm.py:37-42 (vector normalization) — file giống nhau ở 2 codebase | — |
| 23 | Apply Criteria Weights | S4 | ✅ | ✅ | Demo: trip.py:269-285 (weights từ `decision.recommendation_criteria.default_weight` + nhân ưu tiên user), seed_v2.py:71. Repo: recommendation_v2.py:145-156, admin PUT weights admin_v2.py:356-367 | — |
| 24 | Calculate Alternative Scores | S4 | ✅ | ✅ | Cả 2: services/mcdm.py:22-73 TOPSIS đầy đủ (ideal best/worst, separation, closeness); demo gọi trip.py:287, repo gọi recommendation_v2.py:158 | — |
| 25 | Rank Alternatives | S4 | ✅ | ✅ | Demo: mcdm.py:54-56 (argsort + rank), results.tsx:582-597 (xếp hạng, banned đẩy cuối). Repo: mcdm.py như trên + planner-v2.tsx:414-424 (hạng + thanh điểm) | — |
| 26 | Receive Recommendation | S4 | ✅ | 🟡 | Demo: trip.py:289-316 (score + rank + criteria raw/normalized/contribution/weightPct) → results.tsx:530-532 "Vì sao có điểm này?" + danh sách phương án thay thế (574-581). Repo: API trả contributions/normalized (trip_v2.py:216) nhưng planner-v2.tsx:406-452 chỉ render score/reason/time/cost | Repo UI chưa hiển thị per-criterion |
| 27 | Compare Alternatives | S5 | ✅ | ❌ | Demo: results.tsx:630-693 ComparisonTable 8 tiêu chí × top-4 phương án (vượt spec "tối đa 2 phương án"). Repo: không có bảng so sánh | Repo thiếu hẳn |
| 28 | View Impact Estimator | S5 | 🟡 | 🟡 | Demo: results.tsx:697-782 (chênh time/cost/CO₂/compliance khi đổi xe) — thiếu chênh accessibility/convenience/overall score. Repo: impact_assessments GHI DB đủ (recommendation_v2.py:202-220) nhưng không có UI đọc lại | 2 bên mỗi bên thiếu một nửa |
| 29 | View Recommended Option | S5 | ✅ | 🟡 | Demo: results.tsx:495-535 (hàng #1 + mở rộng per-criterion "Vì sao có điểm này?"). Repo: planner-v2.tsx:406-452 chỉ overall score + reason | Repo thiếu per-criterion + alternatives detail |
| 30 | Manage LEZ Areas | S6 | ✅ | 🟡 | Demo: admin.py:149-282 (CRUD zones trên `policy.lez_zones` PostGIS ST_Multi) + deactivate (233-237) + UI zones-tab.tsx:526-532 (toggleActive) + dialog xóa :387. Repo: admin_v2.py:81-131 CRUD API; lib admin-v2.ts:100-117 có sẵn hàm nhưng admin-v2.tsx:481-526 chỉ có tab overview+weights (không UI); create cứng 'ACTIVE' (:100), PUT không đổi status (108-120) | Repo thiếu UI + thiếu deactivate |
| 31 | Manage LEZ Policy Rules | S6 | ✅ | 🟡 | Demo: admin.py:287-506 (CRUD rules: lez_rules + điều kiện + start/end + days) + UI rules-modes-tabs.tsx:383-417. Repo: admin_v2.py:179-251 CRUD API đầy đủ; NHƯNG bug PUT: admin_v2.py:224 `SET zone_id=%s` — sai tên cột (`lez_zone_id`) → PUT sẽ lỗi 500 runtime; không UI | Repo bug PUT rule + thiếu UI |
| 32 | Manage Vehicle Restrictions | S6 | ✅ | 🟡 | Demo: admin.py:329-357 (`vehicle_restrictions` ghi cho mọi vehicle_type của mode — link `lez_rules` × `transportation_modes` qua `vehicle_types`). Repo: admin_v2.py:136-141, 208-215, 233-241 (restrictions theo vehicle_type, đúng thiết kế v2 hơn); không UI | Repo thiếu UI |
| 33 | Manage Applicable Time Periods | S6 | 🟡 | 🟡 | Cả 2: khung giờ nằm trong `policy.lez_rules.start_time/end_time/days_of_week` (demo rules-modes-tabs.tsx:549, 586-589; repo admin_v2.py:146-149) — KHÔNG có bảng `policy.applicable_time_periods` riêng trong schema v2 (kiểm tra cả 2 schema_v2.sql + DB live: không tồn tại) | Thiếu cấu trúc time-period độc lập liên kết LEZ + rule + vehicle type |
| 34 | View Transportation Mode Distribution | S6 | 🟡 | 🟡 | Demo: admin.py:780-786 `modeDistribution` đếm theo `top_mode_id` (mode được ĐỀ XUẤT #1) chứ không phải theo lựa chọn cuối `chosen_mode_id` (chỉ có trong "switching" :808-816); UI admin-dashboard.tsx:783-786. Repo: admin_v2.py:392-402 `topRecommended` (rank 1) + `switchingTo` (417-423); UI admin-v2.tsx:249-266, 281-298 | Cả 2 chưa có "% lựa chọn mỗi mode" đúng nghĩa (theo chosen) |
| 35 | Analyze Transportation Trends | S6 | 🟡 | ❌ | Demo: dataset section admin.py:670-715 (share + trendIndex tháng mới nhất, nguồn `survey.vehicle_survey_responses` 2.400 dòng) + UI admin-dashboard.tsx:794-822, 1026+ — chỉ snapshot tháng mới nhất, không có chuỗi theo tháng dù DB có 24 tháng dữ liệu. Repo: chỉ total/valid/importedAt (admin_v2.py:428-431, 443-444) | Demo thiếu time-series; repo thiếu hẳn |
| 36 | Analyze Trends by Area | S6 | ✅ | 🟡 | Demo: admin.py:788-793 `byDistrict` (originDistrict từ view v1_trip_record, db.py:25) + UI admin-dashboard.tsx:787-788. Repo: backend có byDistrict (admin_v2.py:403-410 theo `origin_region_id` → `gis.administrative_regions`) nhưng UI admin-v2.tsx không render | Repo backend có, UI không render |
| 37 | Analyze Trends by Trip Purpose | S6 | ✅ | ✅ | Demo: admin.py:796-806 (byPurpose + top mode mỗi purpose) + UI admin-dashboard.tsx:788-792. Repo: admin_v2.py:411-416 + UI admin-v2.tsx:342-350 | — |
| 38 | Analyze Mode Switching | S6 | 🟡 | 🟡 | Demo: admin.py:808-816 (switching = mode ĐÍCH mà user chuyển tới, `chosen_mode_id` WHERE switched) + KPI switchingPct :828 + UI admin-dashboard.tsx:792, 919. Repo: admin_v2.py:417-423 switchingTo + UI :281-298. Cả 2 chưa nối cặp hiện tại→mong muốn (`vehicle_id` → `chosen_mode_id` cùng chuyến) | Thiếu biểu đồ chuyển đổi cặp from→to |
| 39 | View Time and Distance Statistics | S6 | 🟡 | ❌ | Demo: KPI avgTimeMin/avgCostVnd toàn cục (admin.py:826-827, view db.py:84-85) — không có trung bình + phân bố time/distance theo mode và theo khu vực. Repo: kpis không có avgTime (admin_v2.py:433-436) | Cả 2 thiếu breakdown theo mode/khu vực |
| 40 | Analyze LEZ Impact | S6 | 🟡 | 🟡 | Demo: KPI lezAffectedPct (admin.py:776, 825; view db.py:35-38) + UI admin-dashboard.tsx:717-720 — thiếu % xe bị cấm (compliance NOT_COMPLIANT), % không ảnh hưởng, phân bố mode trong các ca bị ảnh hưởng. Repo: lezAffectedPct (admin_v2.py:434) — cùng lỗ hổng | Thiếu các thành phần % còn lại của AC |
| 41 | View Recommendation Engine Statistics | S6 | ✅ | 🟡 | Demo: mostRecommended (admin.py:818, 829) + modeDistribution + byDistrict avgScore + byPurpose + KPI card admin-dashboard.tsx:745-746. Repo: topRecommended + recommendationStats runs/avgMs/maxMs (admin_v2.py:424-427, 441-442) + UI :317-330 — thiếu "xu hướng theo nhóm/khu vực" | Repo thiếu thành phần xu hướng |

---

## 2. Thống kê

| Codebase | ✅ Đạt | 🟡 Một phần | ❌ Chưa có | Tổng |
|---|---|---|---|---|
| **Demo my-project** (UI v1 trên DB v2) | **33** | **8** | **0** | 41 |
| **Repo GitHub** (bản v2 nhóm) | **14** | **17** | **10** | 41 |

Chi tiết demo: 🟡 = PBI-04, 28, 33, 34, 35, 38, 39, 40. ❌ = không có.
Chi tiết repo: ✅ = PBI-06, 09, 10, 11, 12, 13, 15, 20, 21, 22, 23, 24, 25, 37. ❌ = PBI-01, 04, 05, 16, 17, 18, 19, 27, 35, 39.

Nhận xét nhanh theo sprint (repo so với demo):

- S1 (01-05): mạnh nhất ở demo (map 2 lớp + facilities); repo gần như trắng trừ geocode.
- S2 (06-08): core pipeline OSRM + route đầy đủ cả 2; repo thiếu visualize.
- S3 (09-15): cả 2 đạt tốt — repo thậm chí dùng PostGIS thật + emission_level, demo mạnh hơn ở trình bày rule.
- S4 (16-26): MCDM/TOPSIS đủ cả 2; AQI (16-19) chỉ demo có; repo thiếu UI chi tiết tiêu chí.
- S5 (27-29): demo đủ/gần đủ; repo chỉ lưu impact vào DB, không hiển thị.
- S6 (30-41): demo đầy đủ CRUD + analytics; repo đủ API CRUD nhưng thiếu UI quản trị và nhiều mảng analytics.

---

## 3. Top 10 gap ưu tiên

Effort: 1 SP = 4-6h, 2 SP = 1 ngày, 3 SP = 1.5-2 ngày, 5 SP = 3-4 ngày.

| # | Gap | PBI liên quan | Sprint | Đề xuất xử lý | Effort |
|---|---|---|---|---|---|
| 1 | Repo không có bản đồ tương tác (map, LEZ layer, facilities, route trên bản đồ, click-chọn điểm) | 01, 04, 05, 07, (02/03 click map) | S1 | Port `map-view.tsx` + tích hợp vào `planner-v2.tsx` (leaflet đã có sẵn trong package.json:63; dữ liệu zones/locations cần mở lại public endpoints `/api/v2/zones`, `/api/v2/locations`) | 5 SP |
| 2 | Repo thiếu toàn bộ Air Quality: service, endpoint, UI, timestamp, cache/stale fallback | 16, 17, 18, 19 | S4 | Port `services/airquality.py` + `/api/airquality` + thẻ AQI trong `planner-v2.tsx` (bảng `decision.air_quality_observations` đã có sẵn trong schema) | 3 SP |
| 3 | Repo thiếu UI quản trị zones/rules/restrictions (API + lib client đã xong) và có bug PUT rule | 30, 31, 32 | S6 | Dựng tab "Vùng/Quy định" trong `admin-v2.tsx` dùng `admin-v2.ts:100-142`; fix `admin_v2.py:224` `SET zone_id=` → `SET lez_zone_id=` (đã gây 500 khi PUT) | 3 SP |
| 4 | Analytics thiếu: % lựa chọn theo mode (theo `chosen_mode_id`), trend theo thời gian (time-series 24 tháng), thống kê time/distance theo mode & khu vực, chi tiết LEZ impact (% bị cấm, phân bố mode ca ảnh hưởng), cặp switching from→to | 34, 35, 38, 39, 40, (41) | S6 | Mở rộng `/api/v2/admin/analytics` (demo đã có nửa: `v1_trip_record` view + pandas — port logic admin.py:776-837) + thêm chart | 5 SP |
| 5 | Demo thiếu bật/tắt lớp LEZ trên bản đồ | 04 | S1 | Thêm 1 Switch "Vùng LEZ" cạnh "Điểm giao thông" (planner.tsx:1082-1087) truyền `showZones` vào map-view | 1 SP |
| 6 | Repo không có bảng so sánh + impact estimator UI (dữ liệu impact đã ghi DB) | 27, 28, 29 | S5 | Port `ComparisonTable` + `ImpactEstimator` từ results.tsx:630-782 sang planner-v2 (đọc trực tiếp response, không cần API mới; có thể thêm GET impact từ `decision.impact_assessments`) | 2 SP |
| 7 | Demo ImpactEstimator thiếu chênh accessibility/convenience/overall score | 28 | S5 | Bổ sung 3 ô delta từ `criteria` có sẵn trong response (results.tsx:697-782) | 1 SP |
| 8 | Repo hiển thị reason nhưng không liệt kê quy định chi tiết (khung giờ, ngày, khu vực, loại xe cấm) | 14 | S3 | Trả kèm `rules` DTO trong compliance v2 (backend đã có `applied_rules` compliance_v2.py:87-105) và render bảng nhỏ trong planner-v2 | 1 SP |
| 9 | Repo không có per-criterion contributions/normalized trong UI dù API đã trả | 26, 29 | S4 | Render khối "Vì sao có điểm này?" (port results.tsx:530+) từ `contributions`/`normalized` có sẵn | 1 SP |
| 10 | Không có bảng `policy.applicable_time_periods` — khung giờ gắn trong `lez_rules` | 33 | S6 | 2 lựa chọn: (a) ghi nhận deviation trong backlog vì lez_rules.start/end/days + vehicle_restrictions đã thỏa chức năng; (b) ALTER schema thêm bảng (cần nhóm đồng thuận theo rules.md điều 3) | 0-2 SP |

Tổng effort nếu xử lý hết top 10: khoảng 21-25 SP (~5-6 tuần công cho 1 người, hoặc 1.5-2 sprint cho nhóm).

---

## 4. Ghi chú lệch phạm vi

### (a) Admin login so với "authentication-free policy management"

Backlog v2.0 §2.1 ghi "admin authentication-free policy management" và stakeholder "Individual User accesses as guest without logging in". Thực tế:

- Demo: `auth.py:16-28` bcrypt (hashpw rounds=10) + `core.admin_sessions` DB session + cookie HttpOnly; mọi endpoint admin đều `Depends(auth.require_admin)` (admin.py:150, 172, 205, 257, 322…).
- Repo: `auth_v2.py` bcrypt + rate-limit 5/15 phút + thu hồi phiên khi logout; `admin_v2.py` header ghi rõ "Mọi endpoint (trừ /login) yêu cầu phiên admin".

Đánh giá: **lệch có chủ đích, nên giữ login**. Phần "guest" của backlog thì ĐÚNG — planner demo và repo đều không yêu cầu guest đăng nhập. Phần admin authentication-free chỉ đúng nếu hiểu là "admin không cần tài khoản user thường", nhưng bỏ hẳn xác thực quản trị sẽ mất điểm rubric security và trái rules.md §7 (mật khẩu bắt buộc bcrypt/argon2). Khuyến nghị: cập nhật backlog/US v2.1 ghi nhận deviation này (kèm lý do bảo mật) thay vì nới lỏng code.

### (b) Routing: backlog nói OSRM — code đang chạy gì

- Demo: `config.py:35-40` chuỗi OSRM public server (driving/cycling/walking), `external.py:247-274` thử lần lượt + cache TTL + **fallback tuyến tổng hợp** (`synthetic_route`, source="estimated") khi offline; UI có cảnh báo "Tuyến hiển thị là ước lượng" (results.tsx:152-161) và provider ghi `ESTIMATED` vào `trip.trip_routes` (trip.py:372).
- Repo: cùng chuỗi (services/external.py), trip_v2.py:106-145 tính route theo từng profile và ghi provider OSRM/ESTIMATED.
- Repo có sẵn thư mục `osrm/` (scripts download/build/serve) cho OSRM tự host nhưng không chạy mặc định trong sandbox.

Kết luận: **đúng công nghệ OSRM như backlog**; cần ghi chú trong tài liệu rằng khi không mạng thì hệ thống tự suy giảm (graceful degradation) thay vì dừng — đây là thiết kế chủ đích, không phải gap.

### (c) Dataset: 2.400 dòng scaffold thay vì Kaggle ~24k

`tools/make_dataset.py:6-8, 68` tự sinh scaffold 2.400 respondent × 24 tháng (CSV 2.401 dòng) và `survey.vehicle_survey_responses` trong DB v2 hiện đúng **2.400 dòng**; chuyến đi thực `trip.trips` chỉ **148** (DEMO seed sinh bằng TOPSIS thật — seed_v2.py:173+). Ảnh hưởng PBI-34..41:

- Các biểu đồ phân phối/trend vẫn chạy nhưng cỡ mẫu nhỏ, trendIndex tính từ dữ liệu synthetic (make_dataset.py ghi rõ "realistic, deterministic scaffold") — không thể trình bày là insight thị trường thật.
- PBI-35 (trend theo thời gian) có đủ 24 tháng để vẽ time-series nếu nạp dataset thật.
- PBI-38/39 (switching, thống kê time/distance) số liệu mỏng vì 148 chuyến seed.

Khuyến nghị: nạp CSV Kaggle "Vehicle at Ha Noi" thật (~24k) vào `survey.vehicle_survey_responses` (pipeline `surveyimport.py` + `trend.py` không cần đổi code) và tăng chuyến demo nếu muốn dashboard thuyết phục trước hội đồng.

---

## 5. Kết luận

Pipeline lõi của RideShift v2.0 — định tuyến OSRM, phân tích LEZ, compliance theo khung giờ, MCDM/TOPSIS 7 tiêu chí, ghi vết đầy đủ vào DB v2 22 bảng/7 schema — đã **đạt ở cả 2 codebase** (PBI-06..13, 20..25), với repo mạnh hơn về đúng thiết kế v2 (PostGIS thật, emission_level, impact_assessments) và demo mạnh hơn về trải nghiệm (bản đồ 2 lớp, facilities, AQI, dashboard analytics). Khoảng cách lớn nhất nằm ở repo GitHub: thiếu hẳn bản đồ tương tác (S1) và khối Air Quality (S4) — hai cụm chiếm 7/10 điểm ❌ — cùng UI quản trị và nhiều mảng analytics chưa dựng dù API sẵn sàng; tổng effort khép gap ước 21-25 SP. Về demo my-project, chỉ còn 8 mục 🟡 (toggle LEZ, chi tiết impact, time-period độc lập, 4 chỉ số analytics chưa đủ sâu) — đều là mở rộng, không phải thiếu chức năng. Ba lệch phạm vi cần chốt với nhóm: giữ admin login bcrypt (cập nhật backlog thay vì nới lỏng), ghi nhận fallback routing ngoài OSRM, và quyết định nạp dataset Kaggle thật để PBI-34..41 có số liệu thuyết phục trước demo 06/12/2026.

## Cập nhật Task 52 (17/10/2026)

- **4(c) — dataset: ĐÃ XỬ LÝ.** File Kaggle thật `dataHN.csv` (25.590 dòng × 58 cột,
  thanhlamdev/vehicle-at-ha-noi, xuất bản 07/2025) đã được nạp vào
  `survey.vehicle_survey_responses` (25.589 dòng, valid 25.586) thay scaffold 2.400.
  Mapper mới trong `app/services/surveyimport.py` (2 format + replace); pipeline
  `trend.py` thích ứng dataset không có ngày (1 kỳ vintage 2025-07, `periodic=false`).
  Thị phần thật: xe máy 57,4% / ô tô 26,9% / xe đạp điện 5,7% — PBI-34..41 giờ
  chạy trên dữ liệu khảo sát thật.
- **Tra cứu số nhà Goong: ĐÃ LÀM** (khác khuyến nghị giữ Google — nhóm chọn Goong
  cho demo): `GET /api/geocode/suggest` (Goong Autocomplete V2, bias location 21.0285,105.8542
  + radius 25km + more_compound) → `GET /api/geocode/place` (Place Detail V2 → tọa độ
  số nhà). UI: dropdown 2 dòng trong planner v1. Khi chưa có `GOONG_API_KEY` tự hạ cấp
  Nominatim → local (E2E đã xác minh). Cache 10 phút tiết kiệm quota.
