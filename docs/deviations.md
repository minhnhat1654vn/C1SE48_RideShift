# RideShift — Bảng lệch kỹ thuật & lý do (Deviation Log)

> **Mục đích:** đối chiếu chính thức giữa **Proposal v1.0 §10 (Tech Stack dự kiến)** và **hệ thống triển khai thực tế** — ghi nhận từng điểm khác biệt, lý do kỹ thuật, rủi ro và hướng giảm thiểu. Đây là thực hành chuẩn quản trị thay đổi của đồ án: proposal viết **trước** khi triển khai; khi hiện thực hóa phát sinh ràng buộc môi trường/miền nghiệm, các điều chỉnh được lập biên bản thay đổi này.
>
> **Trạng thái:** cần trình hướng dẫn phê duyệt và cập nhật thành Proposal v1.1 §10.1 (Phụ lục điều chỉnh công nghệ).
> **Tài liệu liên quan:** `architecture.md` §2 (công nghệ & lý do) · `db.md` (CSDL) · `design.md` (UI/UX)

---

## 1. Bảng đối chiếu tổng hợp

| # | Thành phần | Proposal §10 | Thực tế triển khai | Mức độ | Lý do điều chỉnh | Rủi ro & giảm thiểu |
|---|---|---|---|---|---|---|
| 1 | Bản đồ | Leaflet / MapLibre | **Leaflet 1.9.4 + react-leaflet 5** | ✅ Khớp | — | — |
| 2 | Bản đồ nền | OpenStreetMap | **OSM tiles** | ✅ Khớp | — | — |
| 3 | Bình tuyến | OSRM | **OSRM chuỗi 3 bậc**: FOSSGIS routed-car/bike/foot → OSRM demo → tuyến ước lượng bezier (cache 30 phút) | ✅ Khớp, tốt hơn | Thêm fallback chống gián đoạn dịch vụ công cộng | Không — tăng độ sẵn sàng |
| 4 | Chất lượng không khí | Open-Meteo / OpenAQ | **Open-Meteo Air Quality** (+ mô phỏng dự phòng, cache 2 tầng) | ✅ Khớp | — | — |
| 5 | Gợi ý phương tiện | MCDM / TOPSIS | **TOPSIS 7 tiêu chí, trọng số cấu hình được qua admin** (±70% biên theo slider người dùng) | ✅ Khớp, tốt hơn | Trọng số động thay vì cứng | Không |
| 6 | Frontend | ReactJS | **Next.js 16 App Router (React 19)** | ⚠️ Tinh chỉnh | Next.js **là React** (framework chính chủ); SSR + API Routes gộp 1 tiến trình 1 cổng — hợp mô hình triển khai 1 container của đồ án | Không về mặt tính năng; hợp đồng API tách bạch ở `architecture.md` §4 nên có thể thay khung sau |
| 7 | UI | HTML5 / CSS3 / JavaScript | **Tailwind CSS 4 + shadcn/ui + TypeScript 5** | ⚠️ Tinh chỉnh | TS là superset có kiểu của JS (giảm lỗi runtime); Tailwind/shadcn tăng tốc dựng UI, đồng bộ token màu, a11y sẵn | Không — vẫn render HTML/CSS chuẩn |
| 8 | Backend | Python + FastAPI | **Next.js API Routes (Node.js/TypeScript)** | ❌ Thay đổi | ① 1 ngôn ngữ duy nhất FE+BE cho đội nhỏ, giảm chi phí chuyển ngữ cảnh; ② môi trường triển khai chỉ mở 1 tiến trình/1 cổng — FastAPI phải tách service + CORS + reverse proxy; ③ phát hiện lỗi mạng undici/fetch trong môi trường → tự viết HTTP client `node:https` ép IPv4 (`src/lib/http.ts`) nằm cùng tiến trình | Hợp đồng REST giữ nguyên (zod validate, mô tả §4) → có thể dựng lại bằng FastAPI mà không đổi frontend |
| 9 | Database | PostgreSQL | **SQLite (file duy nhất) + Prisma 6** | ❌ Thay đổi | ① Dung lượng thực tế nhỏ (9 bảng, hàng nghìn dòng) — SQLite dư sức; ② triển khai 0-cấu hình, 1 file dễ sao lưu/demo; ③ Prisma cho phép đổi provider 1 dòng → đường nâng cấp Postgres rõ ràng | SQLite single-writer: khối lượng ghi thấp (TripRecord + cache upsert) nên không thắt cổ chai; khi cần đa người dùng thật → đổi `provider = "postgresql"` + `db push` |
| 10 | Spatial | PostGIS | **JSON string (đa giác) + thuật toán JS**: ray-casting point-in-polygon, haversine, lấy mẫu tuyến (`src/lib/geo.ts`, `aqi-districts.ts`) | ❌ Thay đổi | PostGIS phụ thuộc PostgreSQL (mục 9); nhu cầu không gian của bài toán vừa phải: 30 đa giác quận + vài vùng LEZ, chấm-trong-đa giác O(điểm×cạnh) — chạy < 1ms mỗi truy vấn | Nếu quy mô tăng (hàng nghìn đa giác/truy vấn không gian phức tạp) → chuyển PostGIS theo lộ trình Postgres |
| 11 | Deployment | Docker | **1 tiến trình Node duy nhất + file SQLite** (không Docker) | ❌ Thay đổi | Môi trường demo/chấm điểm là nền tảng Node quản lý sẵn (không có Docker daemon); đơn giản hóa vận hành cho đồ án | Ghi Dockerfile + compose vào roadmap §8; kiến trúc 1 tiến trình giúp container hóa thuận lợi khi cần |
| 12 | Xử lý dữ liệu | Python + Pandas | **EDA đã thực hiện (Sprint 2, notebook Pandas)** → kết quả chưng cất thành hằng số `TREND_PRIOR` + trộn 40% với phân bố top-mode 90 ngày real-time | ⚠️ Một phần | Pipeline offline chỉ cần chạy 1 lần để rút ra phân bố ưu tiên theo mục đích đi; runtime không cần Pandas | Notebook EDA lưu làm bằng chứng Sprint 2; nếu cần phân tích lại → chạy lại notebook, không ảnh hưởng app |

**Tổng kết:** 5/12 khớp (trong đó 2 mục tốt hơn proposal) · 3/12 tinh chỉnh cùng họ công nghệ · 4/12 thay đổi có chủ đích kèm lý do và đường quay lại (Postgres/PostGIS/Docker/FastAPI đều khả thi nhờ hợp đồng API + Prisma datasource tách bạch).

---

## 2. Lý do hệ thống của các thay đổi (mục 8–11)

Bốn thay đổi ❌ không phải là hụt hẹn mà là **một quyết định kiến trúc duy nhất**: gom toàn hệ thống thành **1 tiến trình Node duy nhất** phù hợp môi trường triển khai của đồ án:

```
Proposal §10 (kế hoạch ban đầu)          Thực tế (1 tiến trình)
┌──────────┐ ┌──────────┐               ┌─────────────────────────────┐
│ React SPA│ │ FastAPI  │               │ Next.js 16 (React 19)       │
└────┬─────┘ └────┬─────┘               │  ├─ React SPA (App Router)  │
     │HTTP        │SQLAlchemy           │  ├─ API Routes (zod)        │
┌────▼─────┐ ┌────▼─────┐               │  └─ geo.ts / mcdm.ts / auth │
│ PostGIS  │ │ Postgres │               └──────────┬──────────────────┘
└──────────┘ └──────────┘                          │ Prisma
   + Docker  + Python env               ┌──────────▼──────────────────┐
                                        │ SQLite db/custom.db (1 file)│
                                        └─────────────────────────────┘
```

- **Môi trường triển khai** chỉ phơi 1 cổng, không có Docker daemon → kiến trúc đa service (React + FastAPI + Postgres) không chạy được; kiến trúc 1 tiến trình chạy được và đơn giản để bảo trì.
- **Lỗi mạng của môi trường** (undici Happy-Eyeballs thất bại) buộc viết HTTP client riêng `node:https` ép IPv4 — thể hiện rõ tính "self-contained" của lựa chọn Node.
- **Đường quay lại luôn mở**: hợp đồng API cố định (§4 architecture.md), Prisma schema trung lập DB — muốn về đúng Proposal §10 chỉ cần dựng FastAPI + Postgres bên dưới hợp đồng đó, frontend không đổi.

---

## 3. Việc cần làm theo quy trình

1. **Trình hướng dẫn** bảng §1 để phê duyệt điều chỉnh (hoặc yêu cầu quay lại stack gốc nếu có ràng buộc từ đề bài).
2. **Cập nhật Proposal** v1.0 → v1.1: thêm "§10.1 Phụ lục — Điều chỉnh tech stack sau triển khai" (copy nguyên bảng §1), giữ nguyên §10 gốc làm lịch sử.
3. **Cập nhật Project Plan** nếu có mục rủi ro liên quan Docker/Postgres.
4. Khi bảo vệ: trả lời sẵn cho 2 câu hỏi thường gặp — *"Vì sao không PostGIS?"* (mục 10: quy mô bài toán không cần, thuật toán JS đã kiểm chứng, đường nâng cấp rõ) và *"Vì sao Next.js thay React + FastAPI?"* (mục 6+8: 1 ngôn ngữ, 1 tiến trình, hợp đồng API bất biến).
