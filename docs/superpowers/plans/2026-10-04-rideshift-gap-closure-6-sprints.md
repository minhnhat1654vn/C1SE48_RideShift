# RideShift Gap Closure — Kế hoạch triển khai 6 Sprint

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan sprint-by-sprint. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng toàn bộ gap giữa Proposal v1.0 và codebase trước demo 06/12/2026 — đưa Gap Analysis từ 85% (46/54 ✅) lên ≥97% (chỉ còn mục đã được chấp nhận cắt giảm có ghi nhận).

**Architecture:** Không đổi kiến trúc. Tất cả công việc là: làm sạch (S1), phủ kiểm thử lên 4 seam sẵn có (S2–S3), hoàn thiện 1 tính năng UI (S4), thay nguồn dữ liệu giữ nguyên pipeline (S5), hoàn thiện hồ sơ nộp (S6). Mọi schema/API change nhỏ đều đi đúng recipe trong AGENTS.md.

**Tech Stack:** pytest (backend, mới thêm) · Bun/Next.js 16 + React 19 · FastAPI 0.128 trên Python 3.12 · PostgreSQL/PostGIS 16-3.4 · pandas/Shapely.

**Spec:** [docs/TECHNICAL_SPEC.md](../../TECHNICAL_SPEC.md) · [docs/GAP_ANALYSIS.md](../../GAP_ANALYSIS.md) (bảng Triage/Top-5-Critical là đầu vào trực tiếp của kế hoạch này) · [tasks/todo.md](../../../tasks/todo.md) (bản task chi tiết trước đây — kế hoạch này thay thế và map lại).

## Global Constraints (áp dụng cho mọi task)

- Backend pins tuyệt đối trong `requirements.txt` — không nâng version; pytest thêm vào `requirements-dev.txt` (file mới), không đụng runtime deps.
- Mọi schema change phải sync đủ 3 nơi: `backend/app/schema.sql` + `postgres/init/01_schema.sql` (verbatim) + seed nếu có hàng mới.
- Điểm TOPSIS chỉ tính ở backend (`mcdm.py`); frontend chỉ sắp lại hiển thị — không tái kích hoạt `topsis()` phía client (đã xóa ở S1).
- Mọi external call giữ User-Agent + timeout; không thêm provider mới mà không có fallback.
- UI copy tiếng Việt, bảng màu emerald, mobile-first; lỗi non-2xx luôn `{ "error": string }` tiếng Việt.
- Trọng số 7 tiêu chí luôn tổng 100 (PUT `/api/admin/weights` từ chối nếu lệch).
- Commit nhỏ theo task; mỗi task kết thúc bằng 1 commit chạy được.

## Review Focus (input classes dễ gây lỗi — mỗi dòng được pin bởi test của task sở hữu)

1. **Polygon tự giao / < 3 điểm khi admin vẽ zone** → kỳ vọng: bị từ chối bằng lỗi tiếng Việt, không crash, không lưu. *Pin: Task 3.3 (admin CRUD tests).*
2. **CSV nguồn có dòng rác / null / cột lạ** → kỳ vọng: pipeline không crash, `rows_clean < rows_in` được ghi `dataset_run`, dashboard vẫn render. *Pin: Task 3.2 (GC-S3).*
3. **`CORS_ORIGINS` env rỗng / sai định dạng** → kỳ vọng: fallback an toàn (chỉ same-origin + localhost:3000), không ai bị lock khỏi trang chính. *Pin: Task 3.4.*
4. **PUT weights giá trị âm / NaN / thiếu criterion** → kỳ vọng: 400 envelope `{error}` tiếng Việt, dữ liệu cũ giữ nguyên. *Pin: Task 1.6.*
5. **Khung giờ biên (đúng 06:00, 22:00) và ngày không trong `days` của rule** → kỳ vọng: compliance trả đúng trạng thái ở biên inclusive. *Pin: Task 3.1/3.3.*

---

## GC-Sprint 1 — Nền sạch: prune + dead code + pytest skeleton
**Thời gian:** 05/10 → 11/10 (ước lượng 5 ngày làm việc) · **Gap đáp ứng:** Critical #4 (prune/dead code) + khởi động Critical #1 (testing)

**Mục tiêu:** Codebase sạch và có lưới an toàn tối thiểu — type-check bật lại, dependency chết biến mất, pytest chạy được với bộ test hợp đồng API đầu tiên.

| STT | Task | Chi tiết / AC |
|---|---|---|
| 1.1 | Xóa dead-value code `src/lib` | Xóa `lib/external.ts` (import `./http` không tồn tại); xóa `topsis()` khỏi `lib/mcdm.ts` và hàm phân tích không dùng khỏi `lib/geo.ts` (**giữ types** mà `types.ts` đang re-export). AC: `grep -r "from '@/lib/external'"` trả 0; `bun run build` xanh. |
| 1.2 | Prune dependency chết | Xóa ~40 dep 0-import khỏi `package.json` (next-auth, next-intl, prisma+@prisma/client, zustand, @tanstack/react-query+table, framer-motion, zod, uuid, date-fns, @dnd-kit×3, @mdxeditor, react-syntax-highlighter, react-day-picker, embla/vaul/input-otp nếu ui wrapper không còn dùng…) + devDep `embedded-postgres`, `z-ai-web-dev-sdk`. AC: `bun install && bun run build && bun run start` xanh; smoke 3 tab (planner/admin/docs) không lỗi console. |
| 1.3 | Bật type-check | `frontend/next.config.ts`: `typescript.ignoreBuildErrors: false`. AC: build pass (các lỗi lộ ra phải sửa trong cùng task, phạm vi chỉ `src/`). |
| 1.4 | Xử lý di tích `backend-keepalive` | Route TCP-probe `127.0.0.1:8000` sai trong topology Docker (backend ở hostname `backend`). Quyết định: **xóa route** (docker-compose không cần self-heal). AC: route biến mất, trang không còn ping lỗi. |
| 1.5 | pytest skeleton | Tạo `backend/requirements-dev.txt` (pytest, pytest-timeout); `backend/tests/conftest.py` (fixture DB disposable qua docker-compose service `db` — DSN test riêng, chạy `init_db()+seed()`); `pytest.ini`/config. AC: `cd backend && pytest` chạy xanh ≥1 smoke test (`GET /health` 200). |
| 1.6 | Test hợp đồng API đợt 1 | File `tests/test_api_contract.py`: envelope `{error}` cho 404/422/500 (mock), auth gate 401 khi chưa login, PUT weights tổng ≠100 → 400 giữ dữ liệu cũ, PUT weights giá trị âm/NaN → 400 (pin Review Focus #4), validation purpose sai pattern → 400. AC: ≥8 test xanh. |

**Deliverable:** commit "chore: prune deps + dead code + type-check on"; `backend/tests/` v1 (≥9 test xanh); `package.json` giảm ≥40 dep; `next.config.ts` type-check bật.

---

## GC-Sprint 2 — TOPSIS tests + quyết định PostGIS
**Thời gian:** 12/10 → 18/10 (4–5 ngày) · **Gap đáp ứng:** Critical #1 (thuật toán lõi) + mở khóa quyết định A6

**Mục tiêu:** Thuật toán chấm điểm — phần rủi ro nhất của demo — có bộ test vàng chứng minh tính đúng đắn, và câu hỏi kiến trúc PostGIS-vs-Shapely được chốt bằng văn bản.

| STT | Task | Chi tiết / AC |
|---|---|---|
| 2.1 | Golden tests `topsis()` | `tests/test_mcdm.py`: ≥5 ma trận tính tay (2–3 alternatives × 7 tiêu chí, giá trị đơn giản) → assert score/rank/contributions gần đúng (tolerance 1e-6). Bao gồm case cả 7 mode seed với trọng số mặc định 25/20/20/10/10/10/5. |
| 2.2 | Sensitivity tests | ≥3 test: tăng trọng số một tiêu chí làm rank của alternative mạnh ở tiêu chí đó tăng đúng chiều (pin "Recommendation Evaluation" của proposal). |
| 2.3 | Bất biến tests | Alternatives rỗng → `[]`; toàn trọng số 0 → không chia 0 (normalize theo `w_sum or 1.0`); cost-criteria (travelTime/cost) đảo chiều đúng; điểm luôn trong [0,1]. AC: ≥4 test. |
| 2.4 | Quyết định PostGIS (A6) — **ĐÃ CHỐT: giữ Shapely primary** | Ghi decision vào `docs/architecture.md` (mục "Quyết định không gian": Shapely là đường chính — kết quả like-for-like, một code path được test; PostGIS geom+GIST là hạ tầng dự phòng khi mở rộng) + cập nhật GAP_ANALYSIS A6 thành deviation được chấp nhận. ~~Task 2.5 DB-path: HỦY theo quyết định.~~ |
| 2.6 | Checkpoint sprint | Tag `gc-sprint2-checkpoint`; toàn bộ suite xanh. |

**Deliverable:** `tests/test_mcdm.py` ≥12 test; decision PostGIS ghi trong architecture.md + GAP_ANALYSIS.md cập nhật.

---

## GC-Sprint 3 — Test API/spatial/pipeline + Hardening bảo mật
**Thời gian:** 19/10 → 25/10 (5 ngày) · **Gap đáp ứng:** Critical #3 (security) + phần còn lại của Critical #1

**Mục tiêu:** Cả 4 seam của hệ thống có test, và cấu hình bảo mật quá rộng (CORS `*` + credentials) được thu hẹp có kiểm chứng.

| STT | Task | Chi tiết / AC |
|---|---|---|
| 3.1 | Spatial tests | `tests/test_geo.py` với polygon fixture tổng hợp: outside/partial/within; tuyến cắt đúng góc → partial; polygon <3 điểm / điểm trùng → lỗi có kiểm soát (pin Review Focus #1, #5). AC: ≥6 test. |
| 3.2 | Pipeline tests | `tests/test_trend.py` + CSV fixture nhỏ: chạy `run_pipeline()` → `dataset_trend` đúng số dòng/hệ số; CSV rỗng/cột lạ không crash. AC: ≥4 test. |
| 3.3 | Admin CRUD tests | `tests/test_admin_api.py`: zone create/update/deactivate + cascade xóa rule (pin Review Focus #1); rule CRUD; modes PUT; analytics trả đủ section KPI. AC: ≥8 test, tất cả qua login flow thật (cookie). |
| 3.4 | CORS allowlist | `main.py`: đọc `CORS_ORIGINS` (env, comma-separated; rỗng → mặc định `http://localhost:3000`); compose thêm env. **Bỏ cặp `allow_origins=["*"]` + `allow_credentials=True`**. AC: request từ origin lạ không có header CORS; localhost:3000 hoạt động; 2 test pin (Review Focus #3). |
| 3.5 | Security checklist | `docs/security-checklist.md` ≥10 mục có trạng thái: CORS, cookie flags (đã httponly/samesite), hash password (ghi note cân nhắc bcrypt — quyết định, không bắt buộc đổi), input validation, error disclosure, rate-limit (ghi nhận out-of-scope), dependency audit. |
| 3.6 | Checkpoint sprint | Suite ≥30 test xanh; smoke Docker compose end-to-end (compose up → analyze → choice). |

**Deliverable:** tests/ tổng ≥30 test; CORS hardened + test; `docs/security-checklist.md`.

---

## GC-Sprint 4 — Dọn nợ tài liệu
**Thời gian:** 26/10 → 01/11 (3–4 ngày) · **Gap đáp ứng:** drift tài liệu (Impact Estimator đã CHỐT giữ hiện trạng → task tính năng hủy)

**Mục tiêu:** Tài liệu nội bộ khớp layout repo thật và ghi nhận 2 accepted deviation đúng chỗ.

| STT | Task | Chi tiết / AC |
|---|---|---|
| 4.1 | Cập nhật spec/gap về Impact | `TECHNICAL_SPEC.md` F7 + `GAP_ANALYSIS.md` B8: ghi "✅ theo US-12 AC (vượt thêm CO₂); Objective 8 = accepted deviation 04/10". |
| 4.2 | Sửa path docs | `architecture.md` + `tech-stack.md`: `mini-services/fastapi-backend` → `backend`; `BACKUP.md` thêm header "HISTORICAL — sandbox layout, không còn tồn tại trong repo này"; thêm mục "Quyết định không gian" (Shapely primary) từ GC-S2. |
| 4.3 | ERD header + db-schema.sql | `docs/db-erd.html`: sửa caption path `mini-services/...` → `backend/app/schema.sql` (re-render PNG nếu có playwright, không thì ghi note); `docs/db-schema.sql` thêm header "GENERATED annotated export — không sửa tay, sync từ backend/app/schema.sql". AC: grep không còn `mini-services` trong docs sống. |
| 4.4 | Commit + checkpoint | Suite vẫn xanh; UI smoke khối tác động 3 scenario (xe hiện tại = best / ≠ best / banned) — chỉ xác nhận hiển thị, không sửa code. |

**Deliverable:** 4 file docs cập nhật + 2 deviation ghi nhận (Impact, PostGIS).

---

## GC-Sprint 5 — Dataset Kaggle >25k + regression + đo hiệu năng
**Thời gian:** 02/11 → 08/11 (5 ngày) · **Gap đáp ứng:** Deliverable #11 (Q4: LÀM — owner đã assign từ tuần 1) + Phase 7 evaluation

**Mục tiêu:** Deliverable #11 đạt chuẩn quy mô ">25,000 samples" và hệ thống được chứng minh ổn định + có số đo hiệu năng thật.

| STT | Task | Chi tiết / AC |
|---|---|---|
| 5.1 | Tải dataset *(owner đã assign từ tuần 1 — file phải có sẵn trước khi sprint bắt đầu)* | Kaggle "Vehicle at Ha Noi Dataset" (25.590 × 58 cột). Đặt `backend/data/vehicle_at_hanoi_kaggle.csv`; **giữ scaffold 2.400 dòng làm fixture test**. |
| 5.2 | Thích ứng pipeline | So 58 cột Kaggle với schema `trend.py` đọc; điều chỉnh phần load/feature **giữ aggregation theo tháng** (schema DB không đổi); xử lý null/cột lạ (Review Focus #2). AC: `run_pipeline()` xong, `dataset_run.rows_in ≥ 25.000`, không exception. |
| 5.3 | Verify dashboard | Compose up → admin Overview trend chart render từ dữ liệu thật; `GET /api/dataset/summary` đúng. |
| 5.4 | Full regression | Chạy toàn bộ suite (GC-S1–GC-S3) trên dữ liệu mới. AC: 100% xanh. |
| 5.5 | Đo hiệu năng | Script `backend/tools/bench.py`: time `/api/trip/analyze` (n=20), spatial check, `topsis()` (n=1000) → `docs/evaluation.md` (NFR-01). AC: có số p50/p95. |
| 5.6 | Sensitivity report | Từ test GC-S2: bảng trọng số→rank + so baseline → `docs/evaluation.md`. AC: có kết luận 2-3 câu. |

**Deliverable:** CSV Kaggle nạp + pipeline run mới; `docs/evaluation.md` (perf + sensitivity); regression xanh; GAP_ANALYSIS B10 → ✅.

---

## GC-Sprint 6 — Testing Documentation + báo cáo + code freeze
**Thời gian:** 09/11 → 15/11 (4–5 ngày) · **Gap đáp ứng:** Deliverable #13 + trạng thái nộp

**Mục tiêu:** Đóng Deliverable #13, cập nhật Gap Analysis cuối kỳ, và freeze code ở trạng thái demo-ready còn 3 tuần buffer.

| STT | Task | Chi tiết / AC |
|---|---|---|
| 6.1 | `docs/testing.md` | Test plan (phạm vi, môi trường, cách chạy) + bảng test case **map từng test → FR/NFR/US tương ứng** (Deliverable #13). AC: 100% test trong suite xuất hiện ≥1 dòng truy vết. |
| 6.2 | Gap Analysis cuối kỳ | Re-audit nhanh 54 mục → cập nhật `GAP_ANALYSIS.md` (cột trạng thái mới + % mới). Mục còn ⚠️/🟡 phải có ghi nhận "accepted deviation". AC: không còn mục 🔴 trừ khi có quyết định cắt rõ ràng. |
| 6.3 | 16 deliverable folders | Tạo skeleton đúng Project Plan §7 (Proposal, Project_Plan, …, Presentation) + README 1 dòng mỗi mục trỏ tới nguồn hiện có. AC: đủ 16 thư mục. |
| 6.4 | Deviation notes | Nhất quán 3 điểm vào `db.md`/`architecture.md`: cookie phiên thay JWT; Shapely-primary (kết quả 2.4); provenance dataset + đơn vị hành chính quận-cũ/phường-mới. |
| 6.5 | Code freeze + tag | Tag `v1.0-rc1`; compose up từ tag sạch; mọi PR sau đây chỉ bugfix. AC: tag tồn tại, stack xanh từ tag. |
| 6.6 | Demo checklist | `docs/demo-script.md`: kịch bản demo 10 phút (plan trip qua LEZ → cảnh báo → khuyến nghị → choice → dashboard KPI → dataset). AC: mỗi bước có URL + dữ liệu nhập cụ thể. |

**Deliverable:** `docs/testing.md`, `GAP_ANALYSIS.md` final, 16 folders, tag `v1.0-rc1`, `docs/demo-script.md`.

---

## Sau GC-Sprint 6 (không thuộc kế hoạch này)

- **16/11 → 03/12:** trùng Sprint 7 của Project Plan — dùng làm integration/regression + absorb trễ.
- **04–06/12:** finalization đúng Project Plan (báo cáo, slide, demo).

## Risks

| Rủi ro | Impact | Mitigation |
|---|---|---|
| Kaggle cần account/quyền tải | High (GC-S5 chặn) | **Q4: owner được assign trong tuần này**, tải xong trước 02/11; nếu bế tắc thật sự thì mới quay lại phương án dataset 2.400 dòng + deviation |
| Bật type-check lộ nhiều lỗi | Medium (GC-S1 trôi) | Giới hạn sửa trong `src/`; nếu >1 ngày → tạm suppress có ghi chú từng dòng, hoàn tất ở GC-S4 |
| Test cần DB làm CI chậm | Low | DB disposable qua compose; suite target < 3 phút |
| Sprint trùng lịch học | Medium | Mỗi sprint có 1 task "nice-to-have" đánh dấu rõ để drop trước |

## Open Questions → ĐÃ CHỐT (04/10/2026)

Bốn quyết định đã được Scrum Master chốt:

1. **Q1 — PostGIS:** giữ Shapely làm đường chính (PostGIS là hạ tầng dự phòng cho scale). GC-S2 task 2.5 **hủy**; decision được ghi vào architecture.md ở GC-S4.
2. **Q2 — Impact Estimator:** giữ 4 trường hiện có (thỏa US-12 AC, vượt thêm CO₂). GC-S4 task tính năng **hủy**; lệch với Objective 8 = *accepted deviation* trong báo cáo.
3. **Q3 — Alternative route suggestion:** **KHÔNG LÀM** — không FR/US nào yêu cầu → out of scope, ghi "future work", không tạo US.
4. **Q4 — Dataset Kaggle:** **LÀM** (đảo ngược quyết định "giữ 2.400 dòng" cùng ngày) — owner được assign trong tuần này, nạp **trước GC-Sprint 5** → GC-S5 task 5.1–5.3 **phục hoạt**; deviation Deliverable #11 được đóng khi nạp xong.

→ **Hệ quả:** sau 6 sprint dự kiến **51/54 ✅ (~94%)**; 3 deviation chính thức còn lại: A6 (PostGIS — Q1), B8 (Impact — Q2), D2 (GIST chưa dùng — hệ quả Q1). Q3 ghi future work. Deviation chỉ còn ở những mục **không thể/không nên đóng** — mọi mục closable đều có sprint sở hữu.
