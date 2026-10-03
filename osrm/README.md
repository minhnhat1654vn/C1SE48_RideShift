# osrm/ — Tự host OSRM cho RideShift

Backend RideShift hiện dùng các **OSRM provider công cộng** (xem `backend/app/config.py`):

```python
OSRM_PROVIDERS_DRIVING  = ["https://routing.openstreetmap.de/routed-car", "https://router.project-osrm.org"]
OSRM_PROVIDERS_CYCLING  = ["https://routing.openstreetmap.de/routed-bike"]
OSRM_PROVIDERS_WALKING  = ["https://routing.openstreetmap.de/routed-foot"]
```

Nếu muốn **tự host** (độc lập mạng, tốc độ, không giới hạn rate) — làm theo 3 bước.

## 1) Tải bản trích xuất OSM

```bash
./scripts/download.sh          # Geofabrik Việt Nam (~700 MB) → osrm/data/vietnam-latest.osm.pbf
```

> Muốn dùng bản nhỏ hơn (chỉ Hà Nội) thì thay URL trong `scripts/download.sh`
> bằng extract từ https://extract.bbbike.org hoặc https://download.geofabrik.de.

## 2) Build chỉ số định tuyến

```bash
./scripts/build.sh car         # car | bike | foot  (mỗi profile build một lần)
```

Script chạy `osrm-extract` + `osrm-contract` trong container `osrm/osrm-backend`,
đọc/ghi trực tiếp `osrm/data/`. Ảnh trích xuất Việt Nam mất vài phút–hơn chục phút.

## 3) Chạy service

**Cách A — dùng docker-compose (khuyên dùng):** bỏ comment service `osrm` trong
`docker-compose.yml` (repo gốc) rồi `docker compose up -d osrm`.

**Cách B — chạy riêng:**

```bash
./scripts/serve.sh             # osrm-routed trên :5000
curl "http://localhost:5000/route/v1/driving/105.85,21.03;105.834,21.028?overview=full"
```

## 4) Trỏ backend tới OSRM riêng

Sửa `backend/app/config.py` — thêm provider nội bộ vào **đầu** danh sách (giữ provider
công cộng làm dự phòng):

```python
OSRM_PROVIDERS_DRIVING = ["http://osrm:5000",
                          "https://routing.openstreetmap.de/routed-car",
                          "https://router.project-osrm.org"]
```

- `http://osrm:5000` khi chạy cùng docker-compose (tên service).
- `http://localhost:5000` khi backend chạy ngoài Docker.

## Ghi chú

- `osrm/data/` bị **gitignore** — file pbf/processed quá lớn, luôn sinh bằng script.
- Backend gọi OSRM theo `/route/v1/{profile}/...` với profile `driving|cycling|walking`
  (xem `backend/app/services/external.py`) và có cache 30 phút + fallback tuyến ước tính.
