# Implementation Plan: Gap Closure — RideShift (spec ↔ codebase)

> ⚠️ **Đã được thay thế bởi kế hoạch 6 Sprint chi tiết (có lịch ngày, deliverable, checkpoint):**
> [docs/superpowers/plans/2026-10-04-rideshift-gap-closure-6-sprints.md](../docs/superpowers/plans/2026-10-04-rideshift-gap-closure-6-sprints.md).
> File này giữ làm bản audit gốc; mapping task cũ → GC-sprint mới: T1→GC-S1, T2/T3/T4/T5→GC-S2+GC-S3, T6→GC-S5, T7→GC-S4, T8→(cắt), T9→GC-S3, T10→GC-S5, T11→GC-S6, T12→GC-S4+GC-S6.

## Overview

Đối chiếu `docs/TECHNICAL_SPEC.md` (chuyển hóa từ Proposal v1.0) với codebase ngày 04/10/2026.
Kết quả: **12/12 nhóm tính năng (F1–F12) đã có trong code** trừ hai ngoại lệ lớn —
bộ kiểm thử (In-Scope #17, Deliverable #13) chưa tồn tại, và dataset khảo sát chỉ ~2.400 mẫu
vs cam kết ">25.000 mẫu". Kế hoạch này chia phần việc còn lại thành các task dọc (vertical slice),
ưu tiên nền tảng kiểm thử trước vì nó bảo vệ mọi thay đổi sau đó.

## Audit Summary (đối chiếu spec ↔ code)

### ✅ Đã triển khai (điều tra trực tiếp trên code)

| Nhóm | Bằng chứng |
|---|---|
| F1 Bản đồ + AQ (FR-01…07) | `planner.tsx` geocode debounce + geolocation; `map-view.tsx:20-21` (polyline lộ trình, polygon LEZ, markers điểm đón); AQ Open-Meteo pm2.5/pm10/us_aqi + `measuredAt` + nhãn dự phòng; cache `air_quality_cache` |
| F2 Lộ trình (FR-08…10) | `config.py:27-35` OSRM providers (driving/cycling/walking) + fallback trong `external.py` |
| F3 Không gian LEZ (FR-11,12) | `geo.analyze_route_vs_zones` (outside/partial/within); PostGIS geom + GIST sync khi có extension |
| F4 Phương tiện & chính sách (FR-13…15) | `trip.py` tri-state theo khung giờ + ngày; thẻ cảnh báo `results.tsx:217,576-579` |
| F5 TOPSIS 7 tiêu chí | `mcdm.py` thuần numpy, contributions giải trình; purpose + preferences + trend |
| F6 So sánh | `ComparisonTable (US-11)` `results.tsx:630` |
| F7 Impact Estimator | `results.tsx:700-775` "Ước lượng tác động" — delta thời gian/chi phí/CO₂ + badge tuân thủ |
| F8 Ghi nhận lựa chọn | `trip.py:374` INSERT khi analyze, `:439-452` record_choice + `switched` |
| F9 Quản trị chính sách | Zones/rules CRUD + wizard vẽ polygon (US-31), modes, weights tổng=100 |
| F10 Analytics KPI | `admin.py:464+` pandas: total, lezAffectedPct, switchingPct, byDistrict, byPurpose, switched-to; trend chart US-25 + reprocess |
| F11 Pipeline dataset | `trend.py` pandas, tự chạy khi trống; endpoint reprocess |
| F12 Nền tảng | Error envelope tập trung `main.py:65-103`; cookie phiên + pepper; UA+timeout+cache+fallback; Docker compose 3 dịch vụ |

### ⬜ / 🟡 Còn thiếu hoặc chưa hoàn thiện

1. **⬜ Bộ kiểm thử** — không có test nào trong repo (chỉ thư mục skills có test). Phủ: unit/integration/API/spatial/recommendation (In-Scope #17, Deliverable #13, Phase 6).
2. **🟡 Quy mô dataset** — `backend/data/vehicle_at_hanoi.csv` = 2.400 dòng vs proposal ">25.000 mẫu" (Deliverable #11).
3. **⬜ Đánh giá Phase 7** — đo hiệu năng API/spatial/recommendation, ranking consistency + sensitivity weights + so baseline, khảo sát SUS.
4. **🟡 Impact Estimator thiếu 3 trường** — đã có thời gian/chi phí/CO₂/tuân thủ; chưa có delta accessibility, convenience, điểm tổng (proposal Objective 8 liệt kê đủ 6).
5. **🟡 Hardening bảo mật (NFR-10)** — CORS `allow_origins=["*"]`, chưa có review bảo mật có chủ đích; input validation có (Pydantic) nhưng chưa audit.
6. **🟡 Nợ kỹ thuật frontend** — dead code (`lib/external.ts` import module không tồn tại, `topsis()`/hàm phân tích `lib/geo.ts` không ai gọi) được che bởi `ignoreBuildErrors: true` (mâu thuẫn NFR-17/18).
7. **⬜ Tài liệu kiểm thử** — test plan + test cases (Deliverable #13).
8. **⬜ Postman collection** — proposal chỉ định Postman cho API testing (có thể thay bằng pytest suite + ghi chú).

### ⚠️ Khác biệt thiết kế proposal ↔ code (đã là quyết định, không phải lỗi)

| # | Proposal | Code thực tế | Đánh giá |
|---|---|---|---|
| 1 | JWT cho admin (đơn đăng ký §8.1) | Cookie phiên `rs_admin_session` TTL 8h + hash `SALT$sha256(SALT:password)` | Giữ nguyên; ghi vào báo cáo |
| 2 | "Spatial operations via PostgreSQL/PostGIS" (Objective 3) | Shapely trong Python là đường chính; `geom` PostGIS là dẫn xuất được sync khi extension có | Kết quả tương đương 2 adapter; ghi chú kiến trúc |
| 3 | Trọng số theo user preferences (e.g., AHP) | Trọng số toàn cục do admin cấu hình + điều chỉnh theo preference từng request (4 preset) | Interpretation khác, hợp lý hơn cho prototype |
| 4 | Open-Meteo **hoặc** OpenAQ | Chỉ Open-Meteo (+ cache) | Đúng phạm vi lựa chọn |
| 5 | OSRM tự tính lộ trình | Dùng public OSRM endpoints; self-host là module tùy chọn `osrm/` | Khác biệt triển khai, không lệch mục tiêu |
| 6 | ReactJS + Leaflet/MapLibre | Next.js 16 + React 19 + Leaflet | Next.js thỏa "ReactJS" |
| 7 | "Real-time AQI" (form đăng ký) | AQ có cache + hiển thị `measuredAt` | Nhất quán Objective 5 (fallback/cache) |

## Task List

### Phase 1: Nền tảng chất lượng
- [ ] Task 1: Dọn dead code frontend + bật type-check (S)
- [ ] Task 2: Thiết lập pytest + test hợp đồng API (M)
- [ ] Task 3: Unit test TOPSIS — golden + sensitivity + bất biến (M)
- [ ] Task 4: Test phân tích không gian — 3 trạng thái (M)
- [ ] Task 5: Test pipeline dataset với CSV fixture (S)

### Checkpoint: Nền tảng
- [ ] `pytest` xanh; `bun run build` không lỗi type; app chạy E2E thủ công

### Phase 2: Dữ liệu & tính năng
- [ ] Task 6: Nạp dataset Kaggle đầy đủ (>25.000 mẫu) (M)
- [ ] Task 7: Bổ sung delta accessibility/convenience/điểm tổng vào Ước lượng tác động (S)
- [ ] Task 8: Xuất Postman collection / ghi chú pytest thay thế (S)

### Checkpoint: Dữ liệu & tính năng
- [ ] Dashboard hiển thị xu hướng từ dataset thật; khối tác động đủ 6 trường

### Phase 3: Hoàn thiện
- [ ] Task 9: Hardening bảo mật — CORS cấu hình được + checklist review (M)
- [ ] Task 10: Đánh giá hiệu năng + báo cáo sensitivity (Phase 7) (M)
- [ ] Task 11: Viết Testing Documentation (S)
- [ ] Task 12: Cập nhật docs về dataset thật + deviation JWT/session (S)

### Checkpoint: Complete
- [ ] Đủ In-Scope #17; Deliverable #11 (quy mô) + #13 (tài liệu) đạt; sẵn sàng demo

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Dataset Kaggle đầy đủ cần tải ngoài / giấy phép | High | Kiểm tra nguồn sớm ở Task 6; nếu không tải được, ghi rõ giới hạn trong báo cáo |
| Bật type-check làm lộ nhiều lỗi cũ | Medium | Giới hạn phạm vi sửa trong `src/lib` + chỗ type-check chặn build; phần còn lại ghi follow-up |
| Test cần PostgreSQL | Medium | Chạy test trên disposable postgres (docker) hoặc fixture SQLite-incompatible → dùng compose service test |
| Dead code bị tái sử dụng ngầm | Low | Xóa hẳn thay vì comment; git history giữ lại |

## Open Questions

- SUS survey (Phase 7 usability) làm lúc nào, với ai? — cần con người quyết định.
- Có giữ chế độ Shapely-primary cho production hay chuyển PostGIS-query-primary khi deploy thật? — quyết định kiến trúc khi gần demo.
