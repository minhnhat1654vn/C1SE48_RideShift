# RideShift — Backend (Python + FastAPI)

REST API của **RideShift — Smart Transport Transition Advisor** (C1SE.48 Capstone Project 1),
hiện thực đúng đề xuất: **Python + FastAPI + pandas + Shapely trên PostgreSQL (PostGIS)**.

## Trách nhiệm

- Toàn bộ REST API: tra cứu (geocode, địa điểm, phương tiện, chất lượng không khí), phân tích
  hành trình (OSRM + kiểm tra LEZ + TOPSIS 7 tiêu chí), ghi nhận lựa chọn, và nhóm API quản trị
  (đăng nhập, vùng LEZ, quy định, phương tiện, trọng số, phân tích thống kê).
- **Sở hữu schema** PostgreSQL: tự tạo (`app/schema.sql`, idempotent), tự seed (`app/seed.py`,
  bỏ qua nếu đã có dữ liệu), thêm cột hình học PostGIS khi khả dụng (`app/db.py`), và chạy
  pipeline xử lý dataset khảo sát lần đầu (`app/services/trend.py`).
- Tích hợp dịch vụ ngoài: **Goong.io (geocode số nhà VN — bật bằng `GOONG_API_KEY`, là lựa chọn đầu)** →
  Nominatim (geocode dự phòng) → địa danh local; OSRM (routing); Open-Meteo (air quality) —
  đều có timeout, User-Agent riêng, TTL cache in-memory và phương án dự phòng (không dùng bảng DB cho cache geocode).

## Chạy local

```bash
# 1. Cần PostgreSQL 16 chạy sẵn (PostGIS khuyến khích), database "rideshift"
createdb rideshift   # hoặc qua psql

# 2. Cài dependencies & chạy
pip install -r requirements.txt
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/rideshift
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

- Swagger UI: http://localhost:8000/docs
- Lần đầu khởi động: schema + seed + pipeline dataset tự chạy (in log `RideShift backend ready`).
- Chạy lại seed thủ công: `python3 -m app.seed` · pipeline dataset: `python3 -m app.services.trend`

## Biến môi trường

| Biến | Mặc định | Mô tả |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres@127.0.0.1:5432/rideshift` | DSN PostgreSQL (bất kỳ giá trị nào không phải postgres DSN sẽ bị bỏ qua — chống biến môi trường rác từ sandbox) |
| `BACKEND_PORT` | `8000` | Cổng HTTP |
| `RIDESHIFT_SALT` | `rideshift-c1se48` | Pepper mật khẩu quản trị: `SALT$sha256(SALT:password)` |

## Cấu trúc

```
app/
├── main.py→ FastAPI app, CORS, error handlers (envelope {error})
├── config.py          # env-driven config (DSN, salt, provider OSRM, cache TTL)
├── constants.py       # hằng số nghiệp vụ
├── schema.sql         # SCHEMA PostgreSQL (idempotent) — backend tự sở hữu, tự chạy khi boot
├── db.py              # psycopg pool, init_db, PostGIS geometry setup
├── seed.py            # seed idempotent (admin, phương tiện, vùng, quy định, trọng số…)
├── auth.py            # mật khẩu + phiên quản trị (cookie rs_admin_session, 8h)
├── dto.py             # Pydantic models cho request/response
├── routers/           # public.py · trip.py · admin.py
└── services/          # geo.py · mcdm.py (TOPSIS) · external.py · airquality.py · trend.py
data/                  # vehicle_at_hanoi.csv + dữ liệu processed (dataset khảo sát)
tools/                 # make_dataset.py
```

## Docker

Image build từ `Dockerfile` trong thư mục này (context = thư mục này):
`docker compose up --build` từ thư mục gốc repo tổng sẽ dựng backend cùng db + frontend.
