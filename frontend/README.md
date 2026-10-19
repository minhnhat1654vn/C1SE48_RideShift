# RideShift — Frontend (Next.js)

Front-end của **RideShift — Smart Transport Transition Advisor**, đồ án Capstone Project 1 (lớp **C1SE.48**).

Nền tảng hỗ trợ quyết định cho **Vùng phát thải thấp (LEZ)** tại Hà Nội: tra cứu hành trình, kiểm tra tuân thủ LEZ, gợi ý phương tiện bằng MCDM/TOPSIS, theo dõi chất lượng không khí và trang quản trị (vùng LEZ, quy định, phương tiện, trọng số, phân tích).

> Toàn bộ REST API do **backend FastAPI** đảm nhiệm (xem `backend/` ở repo tổng `C1SE48_RideShift`). Frontend này là lớp React thuần — không chứa logic truy cập database.

## Công nghệ

- **Next.js 16** (App Router) + **React 19** + TypeScript
- **Tailwind CSS 4** + shadcn/ui (New York) + Lucide icons
- **Leaflet / react-leaflet** — bản đồ OSM, đa giác LEZ, dựng 3D phường/xã (SVG extrusion)
- recharts — biểu đồ phân tích
- Bun làm package manager / runtime

## Chạy dev

```bash
bun install

# Cần backend FastAPI chạy sẵn ở :8000 (xem repo tổng)
NEXT_PUBLIC_API_BASE=http://localhost:8000 bun run dev
# → http://localhost:3000
```

> **Chế độ gateway (sandbox):** để `NEXT_PUBLIC_API_BASE` **rỗng** — mọi đường `/api/*` sẽ được ghi thêm tham số `XTransformPort=8000` để đi qua gateway (xem `src/lib/api.ts`).

## Build production

```bash
bun run build
bun run start        # chạy bản standalone trên :3000
```

## Docker

```bash
docker build -t rideshift-frontend \
  --build-arg NEXT_PUBLIC_API_BASE=http://localhost:8000 .
docker run -p 3000:3000 rideshift-frontend
```

## Biến môi trường

| Biến | Bắt buộc | Mô tả |
|---|---|---|
| `NEXT_PUBLIC_API_BASE` | không | Origin của backend FastAPI mà trình duyệt gọi trực tiếp. Bỏ trống khi chạy sau gateway `XTransformPort`. |

## Cấu trúc chính

```
src/
├── app/                    # App Router: page.tsx (trang duy nhất), layout, api/backend-keepalive
├── components/
│   ├── rideshift/          # planner, results, map-view (3D wards), admin-dashboard, docs-viewer
│   │   └── admin/          # zones-tab, rules-modes-tabs (bảng hiện đại + wizard tạo vùng)
│   └── ui/                 # bộ shadcn/ui
├── lib/                    # api.ts (gateway helper), types.ts, geo.ts, mcdm.ts (tham chiếu), external.ts, utils.ts
├── hooks/                  # use-toast, use-mobile
public/
├── data/hanoi-wards.geojson# ranh giới 126 phường/xã Hà Nội (dựng 3D)
└── docs/                   # nội dung trình xem tài liệu trong app
```

## Ghi chú

- Frontend **không sở hữu bảng nào** trong PostgreSQL — là API consumer thuần của backend
  FastAPI (toàn bộ CRUD đi qua `src/lib/api.ts` với `credentials: 'include'` để cookie phiên
  hoạt động cả khi gọi cross-origin `localhost:3000 → localhost:8000` trong Docker). Sơ đồ
  schema xem `postgres/README.md` ở repo tổng.
- `scripts/` chứa công cụ dữ liệu dùng trong môi trường phát triển (quản lý PostgreSQL nhúng, xử lý dữ liệu Vành đai 1, dịch dữ liệu seed…).
- Giao diện **toàn bộ tiếng Việt**, hệ màu xanh lá (emerald) theo chủ đề "xanh hoá".
