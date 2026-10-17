# Task List — Gap Closure (spec ↔ codebase)

> Kế hoạch đầy đủ: `tasks/plan.md`. Đánh dấu `[x]` khi hoàn thành + đã verify.

## Phase 1: Nền tảng chất lượng

### Task 1: Dọn dead code frontend + bật type-check [S]
**Mô tả:** Xóa `lib/external.ts` (import `./http` không tồn tại), phần value không dùng của `lib/mcdm.ts` (`topsis()` — giữ types) và hàm phân tích `lib/geo.ts` (giữ types + hàm format đang dùng); đặt `typescript.ignoreBuildErrors: false`.
- [ ] AC1: Không còn module/hàm không có caller trong `src/lib`
- [ ] AC2: `bun run build` (hoặc `next build`) pass với type-check bật
- [ ] AC3: App chạy: planner → analyze → results hiển thị bình thường
**Verify:** build command; manual smoke trên :3000
**Dependencies:** None · **Files:** `frontend/src/lib/*`, `frontend/next.config.ts`

### Task 2: Thiết lập pytest + test hợp đồng API [M]
**Mô tả:** pytest + FastAPI TestClient trên DB test disposable; test hợp đồng: error envelope `{error}` mọi non-2xx, chặn admin chưa xác thực, PUT weights ≠100 bị từ chối, cascade xóa vùng→quy định, tri-state cho scenario giả lập.
- [ ] AC1: `pytest` (backend) chạy được bằng 1 lệnh, pass
- [ ] AC2: ≥ 8 test hợp đồng xanh, phủ 5 nhóm trên
- [ ] AC3: Không phụ thuộc dịch vụ ngoài (mock OSRM/Nominatim/Open-Meteo)
**Verify:** `cd backend && pytest` — Dependencies: None · **Files:** `backend/tests/*`, có thể `backend/requirements-dev.txt`

### Task 3: Unit test TOPSIS [M]
**Mô tả:** Golden test (ma trận quen thuộc → score/rank kỳ vọng); sensitivity (đổi trọng số → thứ tự đổi đúng chiều); bất biến (all-zero weights không chia 0; alternatives rỗng → []).
- [ ] AC1: ≥ 10 test xanh trên `topsis()`
- [ ] AC2: Có 1 test sensitivity đúng nghĩa "đổi trọng số → đổi rank"
**Verify:** `pytest tests/test_mcdm.py` · Dependencies: Task 2 · **Files:** `backend/tests/test_mcdm.py`

### Task 4: Test phân tích không gian [M]
**Mô tả:** Polygon tổng hợp cho outside/partial/within; tọa độ lỗi/không đủ điểm không crash; tuyến cắt góc polygon → partial.
- [ ] AC1: ≥ 6 test xanh phủ 3 trạng thái + 2 trường hợp xấu
**Verify:** `pytest tests/test_geo.py` · Dependencies: Task 2 · **Files:** `backend/tests/test_geo.py`

### Task 5: Test pipeline dataset [S]
**Mô tả:** CSV fixture nhỏ → `run_pipeline()` → số dòng/hệ số `dataset_trend` kỳ vọng; CSV rác không crash.
- [ ] AC1: ≥ 4 test xanh; pipeline trống-CSV/rác xử lý duyên dáng
**Verify:** `pytest tests/test_trend.py` · Dependencies: Task 2 · **Files:** `backend/tests/test_trend.py`, fixture CSV

## ✅ Checkpoint: Nền tảng
- [ ] pytest xanh toàn bộ; build pass type-check; smoke E2E ok

## Phase 2: Dữ liệu & tính năng

### Task 6: Nạp dataset Kaggle đầy đủ (>25.000 mẫu) [M]
**Mô tả:** Tải "Vehicle at Ha Noi Dataset" (Kaggle) → thay `backend/data/vehicle_at_hanoi.csv` (2.400 dòng hiện tại) → chạy lại pipeline → cập nhật docs/db.md về quy mô thật.
- [ ] AC1: CSV ≥ 25.000 dòng hợp lệ; `run_pipeline()` xử lý xong không lỗi
- [ ] AC2: Dashboard trend chart hiển thị dữ liệu thật
- [ ] AC3: `dataset_run` ghi nhận lần chạy mới với rows_in/rows_clean đúng
**Verify:** SQL count + xem dashboard Overview · Dependencies: Task 5 · **Files:** `backend/data/`, `docs/db.md`

### Task 7: Bổ sung delta còn thiếu vào Ước lượng tác động [S]
**Mô tả:** Thêm 3 ô delta: tính tiếp cận, tính tiện lợi, điểm tổng (proposal Objective 8 đủ 6 trường; hiện có 4).
- [ ] AC1: Khối Ước lượng tác động hiển thị đủ: thời gian, chi phí, phát thải, tuân thủ, tiếp cận, tiện lợi, điểm tổng
- [ ] AC2: Nhãn tiếng Việt nhất quán, không phá layout mobile
**Verify:** manual check trên :3000 · Dependencies: None · **Files:** `frontend/src/components/rideshift/results.tsx`

### Task 8: Postman collection cho API testing [S]
**Mô tả:** Xuất collection từ OpenAPI (`/openapi.json`) vào `docs/postman/` + ghi chú rằng pytest suite là kiểm thực chính (thay thế theo In-Scope #17).
- [ ] AC1: Collection import được vào Postman, có môi trường baseUrl
**Verify:** import thử · Dependencies: None · **Files:** `docs/postman/*`

## ✅ Checkpoint: Dữ liệu & tính năng
- [ ] Trend chart từ dataset thật; khối tác động đủ 6 trường; collection import ok

## Phase 3: Hoàn thiện

### Task 9: Hardening bảo mật [M]
**Mô tả:** CORS chuyển sang allowlist cấu hình qua env (mặc định chặt); checklist review NFR-09/10 (input validation, header, lỗi không lộ chi tiết) lưu `docs/security-checklist.md`.
- [ ] AC1: CORS đọc từ env; deploy chuẩn không dùng `*`
- [ ] AC2: Checklist hoàn thành, không còn mục Critical/High mở
**Verify:** chạy stack + thử origin lạ · Dependencies: Task 2 · **Files:** `backend/main.py`, `docs/security-checklist.md`

### Task 10: Đánh giá hiệu năng + sensitivity report (Phase 7) [M]
**Mô tả:** Script đo thời gian phản hồi API / spatial query / TOPSIS; chạy sensitivity trọng số (đầu ra Task 3) → `docs/evaluation.md`.
- [ ] AC1: Bảng số liệu 3 chỉ số hiệu năng trong môi trường test
- [ ] AC2: Biểu đồ/bảng sensitivity + so với baseline (ví dụ sắp xếp 1 tiêu chí)
**Verify:** script chạy được, tài liệu có số · Dependencies: Tasks 3, 6 · **Files:** `docs/evaluation.md`, script đo

### Task 11: Testing Documentation [S]
**Mô tả:** `docs/testing.md` — test plan, danh sách test case map FR/NFR → test (Deliverable #13).
- [ ] AC1: Mọi test trong suite có dòng truy vết tới FR/NFR tương ứng
**Verify:** review tài liệu · Dependencies: Tasks 2–5 · **Files:** `docs/testing.md`

### Task 12: Cập nhật docs deviation + dataset [S]
**Mô tả:** Ghi vào `docs/db.md`/`docs/architecture.md`: quy mô dataset thật, quyết định cookie phiên thay JWT, cơ chế không gian hai chế độ — phục vụ báo cáo cuối.
- [ ] AC1: Ba điểm deviation có mặt trong docs, nhất quán với code hiện tại
**Verify:** review · Dependencies: Task 6 · **Files:** `docs/db.md`, `docs/architecture.md`

## ✅ Checkpoint: Complete
- [ ] In-Scope #17 đạt; Deliverable #11 (quy mô) + #13 (tài liệu) đạt; sẵn sàng cho demo cuối
