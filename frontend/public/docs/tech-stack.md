# RideShift — Tech Stack Audit & Trạng thái đối chiếu proposal

> Nguồn đối chiếu: `C1SE48_ProposalDocument_v1.0` — mục 10. Technology Stack, Objective 3, NFR-02, Deliverables #10/#11, Scope #18.
> **Cập nhật (Task 16): toàn bộ 4 điểm lệch đã được đóng kín — app giờ chạy đúng theo proposal.**

---

## Trạng thái: 15/15 mục khớp proposal

| # | Proposal khai báo | Thực tế hiện tại | Trạng thái |
|---|---|---|---|
| 1 | Frontend: ReactJS | React 19 qua Next.js (App Router), TypeScript | ✅ |
| 2 | Backend: Python + FastAPI | **FastAPI (Python 3.12)** — `mini-services/fastapi-backend`, toàn bộ 16+ REST endpoints, UVicorn | ✅ (đã port từ Next.js API routes) |
| 3 | Database: PostgreSQL | PostgreSQL 18.4 (embedded trong sandbox) / 16 + PostGIS (Docker) | ✅ |
| 4 | PostgreSQL + PostGIS (Deliverable #10, NFR-02) | docker-compose dùng image **postgis/postgis:16-3.4**; schema sẵn cột `geometry(Polygon,4326)` + GIST; trong sandbox không có root → spatial chạy Shapely (fallback tự động) | ✅ deploy / ⚠️ sandbox (hạn chế môi trường) |
| 5 | Data processing: Python + Pandas | **pandas pipeline** `app/services/trend.py` xử lý "Vehicle at Ha Noi Dataset" → trend criterion + analytics aggregation + Deliverable #11 (processed CSV) | ✅ |
| 6 | "Vehicle at Ha Noi Dataset" | `data/vehicle_at_hanoi.csv` (2.400 khảo sát; thay bằng CSV Kaggle thật cùng cột là chạy lại ngay) | ✅ |
| 7 | Leaflet / MapLibre | Leaflet 1.9.4 + react-leaflet 5 | ✅ |
| 8 | OpenStreetMap | OSM tiles + Nominatim geocoding | ✅ |
| 9 | OSRM routing | FOSSGIS OSRM chain + demo server + fallback ước lượng, cache 30' | ✅ |
| 10 | Open-Meteo Air Quality | Open-Meteo + DB cache 30' + mô phỏng dự phòng | ✅ |
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
- Next.js chỉ còn là presentation layer — **không còn** API routes (`src/app/api` đã xóa), không còn Prisma runtime (`src/lib/db.ts` đã xóa; prisma/ chỉ còn lại dưới dạng tư liệu tham khảo, vô hiệu).

## Ghi chú kỹ thuật

- **Cookie auth xuyên gateway**: session cookie `rs_admin_session` (httpOnly, 8h, sha256+salt giống hệt bản cũ) được FastAPI set/reset; gateway giữ nguyên nên admin flow chạy như cũ.
- **Trend criterion**: trước đây dùng hằng số cứng `TREND_PRIOR`; giờ = 0.6×adoption + 0.4×growth tính bằng pandas từ dataset khảo sát (fallback về TREND_PRIOR nếu pipeline chưa chạy).
- **PostGIS dual-mode**: `app/db.py` tự dò `CREATE EXTENSION postgis`; có PostGIS → đồng bộ `lez_zone.geom` + GIST index phục vụ truy vấn không gian trong DB; không có → Shapely ở app layer. Kết quả outside/partial/within giống hệt nhau.
- **Vì sao sandbox ⚠️ ở dòng PostGIS**: PostgreSQL chạy user-space (embedded-postgres) không kèm extension PostGIS, và sandbox không có root/apt để cài. Đây là hạn chế môi trường, không phải hạn chế thiết kế — compose file đã dùng đúng image PostGIS.
