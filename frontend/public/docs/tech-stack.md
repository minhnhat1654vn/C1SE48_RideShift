# RideShift — Tech Stack Audit & Trạng thái đối chiếu proposal

> Nguồn đối chiếu: `C1SE48_ProposalDocument_v1.0` — mục 10. Technology Stack, Objective 3, NFR-02, Deliverables #10/#11, Scope #18.
> **Cập nhật (Task 16): toàn bộ 4 điểm lệch đã được đóng kín — app giờ chạy đúng theo proposal.**

---

## Trạng thái: 15/15 mục khớp proposal

| # | Proposal khai báo | Thực tế hiện tại | Trạng thái |
|---|---|---|---|
| 1 | Frontend: ReactJS | React 19 qua Next.js (App Router), TypeScript | ✅ |
| 2 | Backend: Python + FastAPI | **FastAPI (Python 3.12)** — `mini-services/fastapi-backend`, REST API (40 endpoint mounted = 17 admin + 20 public + 3 trip; frontend sử dụng 37: 33 fetch + 4 liên kết dữ liệu mở, cộng `/health` vận hành; 2 endpoint legacy giữ nguyên contract theo repo gốc: `GET /api/admin/zones`, `GET /api/dataset/summary`), UVicorn | ✅ (đã port từ Next.js API routes) |
| 3 | Database: PostgreSQL | PostgreSQL 18.4 (embedded trong sandbox) / 16 + PostGIS (Docker) | ✅ |
| 4 | PostgreSQL + PostGIS (Deliverable #10, NFR-02) | docker-compose dùng image **postgis/postgis:16-3.4**; `policy.lez_zones.geometry` đúng DB FINAL là `GEOMETRY(MULTIPOLYGON,4326)` + GIST; trong sandbox không có root → spatial chạy Shapely (fallback tự động, cùng kết quả) | ✅ deploy / ⚠️ sandbox (hạn chế môi trường) |
| 5 | Data processing: Python + Pandas | **pandas pipeline** `app/services/trend.py` xử lý "Vehicle at Ha Noi Dataset" → trend criterion + analytics aggregation + Deliverable #11 (processed CSV) | ✅ |
| 6 | "Vehicle at Ha Noi Dataset" | `data/dataHN.csv` — bộ Kaggle **thật** 25.590 dòng × 58 cột (9,1MB trong repo); trục cohort 6 nhóm tuổi; fallback scaffold monthly khi thiếu file | ✅ |
| 7 | Leaflet / MapLibre | Leaflet 1.9.4 dùng trực tiếp qua API JS (canvas layer tự viết cho trường AQI) — không cần lớp react-leaflet | ✅ |
| 8 | OpenStreetMap | OSM tiles + Nominatim geocoding | ✅ |
| 9 | OSRM routing | FOSSGIS OSRM chain + demo server + fallback ước lượng, cache 30' | ✅ |
| 10 | Open-Meteo Air Quality | Open-Meteo CAMS (**lớp nền** bản đồ khi không có trạm sống + **fallback lịch sử 24h** trong panel chi tiết trạm khi chuỗi giờ của Sở chưa có dữ liệu) + **trạm đo thật**: Sở NN&MT Hà Nội (moitruongthudo.vn) & WAQI (aqicn.org) — trạm còn số liệu đóng góp lớp AQI (nội suy IDW), trạm tạm ngừng hiển thị xám, không có lịch sử/min-max; DB cache 30' | ✅ |
| 11 | MCDM (AHP/TOPSIS) | TOPSIS (Hwang & Yoon) trên numpy, 7 tiêu chí, trọng số admin cấu hình được | ✅ |
| 12 | Git | Git | ✅ |
| 13 | RESTful APIs | FastAPI REST (`/docs` Swagger tự sinh) | ✅ |
| 14 | HTML5/CSS3/JS | TypeScript + Tailwind CSS 4 + shadcn/ui (render ra HTML/CSS chuẩn) | ✅ (mở rộng chấp nhận được) |
| 15 | Docker deployment (Scope #18) | **Dockerfile × 2 + docker-compose.yml** (frontend + backend + PostGIS) | ✅ (file hoàn chỉnh; sandbox không có Docker để chạy thử) |

## Hiện trạng kiến trúc sau chuyển đổi

```
Browser ──> Next.js (React UI, port 3000)
              │  fetch('/api/...?XTransformPort=8000')  — qua gateway
              ▼
           FastAPI backend (Python, port 8000)
              │  psycopg
              ▼
           PostgreSQL 18.4 (sandbox) / postgis:16 (Docker)
              │
              ├── Nominatim (geocode)      ├── OSRM (routing)
              ├── Open-Meteo (AQI)         └── pandas (survey pipeline)
```

- Toàn bộ business logic (analyze pipeline, TOPSIS, LEZ spatial, compliance, AQI cache, auth, admin CRUD, analytics) nằm ở **Python**.
- Next.js chỉ còn là presentation layer — **không còn** API routes (`src/app/api` đã xóa, chỉ còn `backend-keepalive` giữ backend sống trong sandbox demo), Prisma runtime + `prisma/` đã loại bỏ hoàn toàn (schema SQLite cũ đã xóa).

## Ghi chú kỹ thuật

- **Cookie auth xuyên gateway**: session cookie `rs_admin_session` (httpOnly, 8h, sha256+salt giống hệt bản cũ) được FastAPI set/reset; gateway giữ nguyên nên admin flow chạy như cũ.
- **Trend criterion**: trước đây dùng hằng số cứng `TREND_PRIOR`; giờ = 0.6×adoption + 0.4×growth tính bằng pandas từ dataset khảo sát (fallback về TREND_PRIOR nếu pipeline chưa chạy).
- **PostGIS dual-mode**: `app/db.py` tự dò `CREATE EXTENSION postgis`; có PostGIS → đồng bộ `lez_zone.geom` + GIST index phục vụ truy vấn không gian trong DB; không có → Shapely ở app layer. Kết quả outside/partial/within giống hệt nhau.
- **Vì sao sandbox ⚠️ ở dòng PostGIS**: PostgreSQL chạy user-space (embedded-postgres) không kèm extension PostGIS, và sandbox không có root/apt để cài. Đây là hạn chế môi trường, không phải hạn chế thiết kế — compose file đã dùng đúng image PostGIS.
