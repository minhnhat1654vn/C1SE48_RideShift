# 🚲 RideShift — Smart Transport Transition Advisor

> Đồ án **Capstone Project 1** — lớp **C1SE.48**
> Nền tảng hỗ trợ quyết định chuyển đổi phương tiện xanh cho **Vùng phát thải thấp (LEZ)** tại Hà Nội.

RideShift giúp người dân tra cứu hành trình, kiểm tra **tuân thủ quy định LEZ** (Vành đai 1 & vùng thí điểm), nhận **gợi ý phương tiện đa tiêu chí (TOPSIS)**, xem **chất lượng không khí** theo thời gian thực, và cung cấp cho quản trị viên công cụ cấu hình vùng/quy định/trọng số cùng **phân tích hành vi chuyển đổi phương tiện**.

---

## ✨ Tính năng chính

**Người dùng (Bảng lập kế hoạch chuyến đi)**
- 🔎 Tra cứu điểm đi/đến với gợi ý địa chỉ (Nominatim) + "dùng vị trí của tôi"
- 🗺️ Bản đồ OSM: tuyến đường thực tế (OSRM), đa giác LEZ, dựng 3D 126 phường/xã
- 🚫 Kiểm tra LEZ: phương tiện của bạn luôn đứng đầu kèm kết quả **BỊ CẤM / Có thể bị hạn chế / Đạt**
- 🏆 Gợi ý phương tiện xếp hạng theo **TOPSIS 7 tiêu chí** (thời gian, chi phí, CO₂, tuân thủ LEZ, tiện nghi, khả năng tiếp cận, chất lượng không khí) — giải thích điểm số từng tiêu chí
- 🌫️ Chất lượng không khí (Open-Meteo, cache 30 phút, có phương án dự phòng mô phỏng)
- ⚖️ Cân nặng sở thích (4 thanh trượt) ảnh hưởng trực tiếp tới bảng xếp hạng
- 📊 So sánh phương án, ước tính tác động (thời gian/chi phí/CO₂/tuân thủ), ghi nhận ý định chuyển đổi

**Quản trị viên (Trang Quản trị)**
- 🗂️ Sidebar nhóm: Theo dõi / Cấu hình LEZ / Dữ liệu & mô hình (+ drawer mobile)
- 🩺 Tổng quan "Trung tâm chỉ huy": thẻ sức khỏe, cảnh báo tự sinh (Cần chú ý), KPI có so sánh kỳ trước ▲▼, xuất CSV, tìm kiếm chuyến
- 🗺️ Vùng LEZ: **wizard 3 bước** tạo vùng (vẽ đa giác → thông tin → xem lại có diện tích ước tính), bảng hiện đại (tìm kiếm/lọc/pill trạng thái/menu ⋯/form trượt Sheet/phân trang)
- 📜 Quy định: cấm / có điều kiện theo khung giờ + ngày trong tuần
- 🛵 Phương tiện & trọng số MCDM: bật/tắt phương tiện, chỉnh trọng số 7 tiêu chí (tổng = 100%)

---

## 🏗️ Kiến trúc

```
┌──────────────────┐   REST (JSON)   ┌─────────────────────┐   SQL   ┌──────────────────────────┐
│  Frontend        │ ──────────────► │  Backend            │ ──────► │  PostgreSQL 16 + PostGIS │
│  Next.js 16      │                 │  Python + FastAPI   │         │  rideshift               │
│  React 19        │ ◄────────────── │  pandas + Shapely   │ ◄────── │  (geometry GIST khi có   │
│  Tailwind+shadcn │                 │  uvicorn :8000      │         │   PostGIS, JSON polyline │
│  Leaflet :3000   │                 └─────────────────────┘         │   là nguồn chuẩn)        │
└──────────────────┘                                                 └──────────────────────────┘
        │  ▲
        │  │  Dịch vụ bên ngoài (public): OSM tiles · Nominatim (geocode)
        └──┘  OSRM (routing) · Open-Meteo (air quality)
```

- Trình duyệt gọi **trực tiếp** backend FastAPI qua `NEXT_PUBLIC_API_BASE` (chế độ gateway dùng tham số `XTransformPort` — xem `frontend/src/lib/api.ts`).
- Backend **sở hữu schema**: `backend/app/schema.sql` (idempotent) + seed tự động + pipeline xử lý dataset khảo sát khi khởi động lần đầu.

## 🧰 Công nghệ (đối chiếu đề xuất)

| Thành phần | Đề xuất | Hiện thực |
|---|---|---|
| Frontend | ReactJS | Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui |
| Bản đồ | Leaflet / OpenStreetMap | Leaflet 1.9.4 + react-leaflet 5, tile OSM, dựng 3D phường/xã |
| Routing | OSRM | OSRM công cộng (routed-car/bike/foot) — có hướng dẫn tự host tại `osrm/` |
| Geocoding | Nominatim | Nominatim + bộ địa danh Hà Nội dự phòng |
| Backend | Python + FastAPI | FastAPI + uvicorn + pandas + numpy + Shapely + httpx |
| Database | PostgreSQL + PostGIS | PostgreSQL 16 (image `postgis/postgis:16-3.4`), psycopg 3 |
| MCDM | TOPSIS | TOPSIS 7 tiêu chí — `backend/app/services/mcdm.py` |
| Chất lượng không khí | Open-Meteo | Open-Meteo Air-Quality + cache 30' + mô phỏng dự phòng |

## 📁 Cấu trúc thư mục

```
C1SE48_RideShift/
│
├── frontend/               # Next.js 16 — toàn bộ giao diện (chạy :3000)
├── backend/                # FastAPI — REST API, MCDM, dịch vụ ngoài (chạy :8000)
├── postgres/               # Tài sản database
│   ├── init/01_schema.sql  #   schema tạo tự động khi khởi tạo container (idempotent)
│   └── snapshot/           #   ảnh dữ liệu mẫu (restore nhanh cho demo)
├── osrm/                   # Hướng dẫn + script tự host OSRM (tải/build/chạy)
├── docs/                   # Kiến trúc, ERD, tài liệu DB, tài liệu đồ án, dữ liệu nguồn
│
├── .gitignore
├── .env.example
├── README.md
├── AGENTS.md               # Hướng dẫn cho AI agent tham gia phát triển
└── docker-compose.yml      # db + backend + frontend (+ osrm tuỳ chọn)
```

## 💻 Yêu cầu môi trường

Để chạy dự án bằng Docker, máy cần cài:

- Git
- Docker Desktop
- Docker Compose v2

Kiểm tra:

```bash
git --version
docker --version
docker compose version
```

## ⚡ Quick Start

```bash
git clone <REPOSITORY_URL>
cd C1SE48_RideShift

cp .env.example .env

docker compose up --build
```

## 🚀 Chạy bằng Docker (khuyên dùng)

```bash
cp .env.example .env
docker compose up --build
```

| Dịch vụ | Địa chỉ |
|---|---|
| Giao diện | http://localhost:3000 |
| API + Swagger | http://localhost:8000/docs |
| PostGIS | localhost:5432 (db `rideshift`) |

Lần đầu khởi động: backend tự tạo schema, tự seed dữ liệu mẫu (7 phương tiện, vùng LEZ Vành đai 1 + phố cổ, quy định, trọng số, địa điểm, chuyến đi demo) và chạy pipeline xử lý dataset khảo sát.

## 🔧 Chạy thủ công (không Docker)

**1. PostgreSQL + PostGIS** — tạo database `rideshift`, schema sẽ do backend tự đảm bảo (hoặc chạy `postgres/init/01_schema.sql`):

```bash
psql "postgresql://postgres:postgres@localhost:5432/rideshift" -f postgres/init/01_schema.sql
```

**2. Backend (Python 3.12+):**

```bash
cd backend
pip install -r requirements.txt
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rideshift
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
```

**3. Frontend (Bun):**

```bash
cd frontend
bun install
NEXT_PUBLIC_API_BASE=http://localhost:8000 bun run dev   # → http://localhost:3000
```

**Tải dữ liệu mẫu có sẵn (tuỳ chọn):** xem `postgres/README.md`.

## 🔐 Biến môi trường

| Biến | Dùng bởi | Mặc định | Mô tả |
|---|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | db | `postgres` / `postgres` / `rideshift` | Khởi tạo container PostgreSQL |
| `DATABASE_URL` | backend | `postgresql://postgres@127.0.0.1:5432/rideshift` | DSN PostgreSQL |
| `RIDESHIFT_SALT` | backend | `rideshift-c1se48` | Pepper mã hoá mật khẩu quản trị |
| `BACKEND_PORT` | backend | `8000` | Cổng HTTP backend |
| `NEXT_PUBLIC_API_BASE` | frontend | *(rỗng = chế độ gateway)* | Origin backend trình duyệt gọi trực tiếp |

## 👤 Tài khoản quản trị mẫu

```
Tên đăng nhập: admin
Mật khẩu:      admin123
```

> Chỉ dùng cho môi trường demo — đổi mật khẩu khi triển khai thực tế.

## 📚 Tài liệu

- `docs/architecture.md` — kiến trúc chi tiết
- `docs/db.md`, `docs/db-schema.sql`, `docs/db-erd.png` — mô hình dữ liệu & ERD
- `docs/tech-stack.md` — đối chiếu công nghệ với đề xuất
- `docs/project-documents/` — Đề xuất, Kế hoạch dự án, Product Backlog, User Story
- `docs/data-sources/` — quy định Vành đai 1 (TXT), ranh giới 34 phường/xã Hà Nội (GeoJSON)
- Swagger API: http://localhost:8000/docs

## 🗺️ Dữ liệu & nguồn bên ngoài

- Bản đồ & dữ liệu địa lý: **OpenStreetMap** (+ contributors), ranh giới phường/xã Hà Nội (34 đơn vị mới)
- Tuyến đường: **OSRM** (public providers, có thể tự host — `osrm/README.md`)
- Chất lượng không khí: **Open-Meteo Air-Quality API**
- Dataset khảo sát phương tiện Hà Nội: `backend/data/vehicle_at_hanoi.csv` (Deliverable #11)

---

© 2026 — Nhóm C1SE.48 · Capstone Project 1 · RideShift
