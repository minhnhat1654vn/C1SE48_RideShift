"""RideShift FastAPI backend — configuration (12-factor, env-driven)."""
# Geocode chain: Goong (VN house numbers, optional key) → Nominatim → local
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Phiên bản build (ngày đóng gói) — đồng bộ với tag image trong docker-compose.yml
# (rideshift/backend:<APP_VERSION>) và hiển thị ở /health. Giúp xác minh chắc
# chắn container đang chạy code MỚI (chống tái dùng image cũ khi
# `docker compose up` quên --build — nguyên nhân gốc của lỗi "chỉ có Hà Nội").
APP_VERSION = "2026.11.22"

# PostgreSQL connection (proposal: PostgreSQL; docker-compose uses postgis image).
# The sandbox platform may inject DATABASE_URL=file:...custom.db (SQLite legacy) —
# anything that is not a postgres DSN is rejected in favour of the local server.
_ENV_DATABASE_URL = os.getenv("DATABASE_URL", "")
DATABASE_URL = (
    _ENV_DATABASE_URL
    if _ENV_DATABASE_URL.startswith(("postgres://", "postgresql://"))
    else "postgresql://postgres@127.0.0.1:5432/rideshift"
)

# Admin auth (identical scheme to the original implementation so existing
# credentials keep working: SALT$sha256(SALT:password))
SALT = os.getenv("RIDESHIFT_SALT", "rideshift-c1se48")
SESSION_COOKIE = "rs_admin_session"
SESSION_TTL_SECONDS = 8 * 60 * 60  # 8 hours

# CORS — the browser calls this backend directly when the frontend is built
# with NEXT_PUBLIC_API_BASE (docker deployment). Cross-origin fetches only
# carry/receive the admin session cookie when the exact origin is echoed
# back, so list them explicitly (comma-separated env, no trailing slashes).
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if o.strip()
]

# External services (proposal: OpenStreetMap + OSRM + Open-Meteo)
# Override NOMINATIM_URL to point at a mirror / self-hosted Nominatim if the
# public instance is unreachable or rate-limited from your network.
NOMINATIM_URL = (
    os.getenv("NOMINATIM_URL") or "https://nominatim.openstreetmap.org/search"
)

# Goong.io — Vietnam-first geocoding with HOUSE NUMBERS ("120 Yên Lãng"),
# far better coverage for VN addresses than OSM. Optional: enabled only when
# GOONG_API_KEY is set (register at goong.io — free tier). When present it is
# the first choice of the geocode chain, before Nominatim.
# GOONG_GEOCODE_URL is env-overridable so mirrors/proxies/self-signed test
# servers can be pointed at without touching code.
GOONG_API_KEY = os.getenv("GOONG_API_KEY", "")
GOONG_GEOCODE_URL = (
    os.getenv("GOONG_GEOCODE_URL") or "https://rsapi.goong.io/geocode"
)
# Task 65 — chuỗi Goong 2 bước: AutoComplete (input mời có số nhà) → Place Detail
GOONG_AUTOCOMPLETE_URL = (
    os.getenv("GOONG_AUTOCOMPLETE_URL")
    or "https://rsapi.goong.io/Place/AutoComplete"
)
GOONG_PLACE_DETAIL_URL = (
    os.getenv("GOONG_PLACE_DETAIL_URL") or "https://rsapi.goong.io/Place/Detail"
)

# Geocode result cache — in-memory on purpose (NO database table): geocoding
# is a stateless lookup, a TTL cache only saves provider quota.
GEOCODE_CACHE_TTL_SECONDS = 30 * 60
GEOCODE_CACHE_MAX = 300

OSRM_PROVIDERS_DRIVING = [
    "https://routing.openstreetmap.de/routed-car",
    "https://router.project-osrm.org",
]
OSRM_PROVIDERS_CYCLING = ["https://routing.openstreetmap.de/routed-bike"]
OSRM_PROVIDERS_WALKING = ["https://routing.openstreetmap.de/routed-foot"]
OPEN_METEO_AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

TIMEOUT_GEOCODE = 5.0
TIMEOUT_ROUTE = 8.0
TIMEOUT_AIR = 6.0

# Caches
AQ_CACHE_TTL_SECONDS = 30 * 60
ROUTE_CACHE_TTL_SECONDS = 30 * 60
ROUTE_CACHE_MAX = 200

USER_AGENT = "RideShift/1.0 (C1SE.48 Capstone; Python-FastAPI backend)"

# Survey dataset ("Vehicle at Ha Noi Dataset" — Deliverable #11)
# KAGGLE_CSV  : the REAL Kaggle export (25,590 responses × 58 columns),
#               processed on the age-cohort axis (the survey has no date).
# DATASET_CSV : monthly scaffold fallback (generated when both are missing).
DATA_DIR = BASE_DIR / "data"
CITIES_GEO_DIR = DATA_DIR / "cities"  # Task 65 — geojson phường/xã 3 thành phố → gis.administrative_regions
KAGGLE_CSV = DATA_DIR / "dataHN.csv"
DATASET_CSV = DATA_DIR / "vehicle_at_hanoi.csv"
PROCESSED_DIR = DATA_DIR / "processed"

# ---------------------------------------------------------------------------
# Task 63 — Trạm đo chất lượng không khí THẬT (multi-city + WAQI + Sở NN&MT)
# ---------------------------------------------------------------------------
# Nguồn A: moitruongthudo.vn/api/site — 4 trạm tự động Chi cục BVMT Hà Nội
#          (Sở Nông nghiệp & Môi trường) — JSON mở, không token, chỉ Hà Nội.
# Nguồn B: api.waqi.info — WAQI (token người dùng cấp) — US Embassy, UNIS,
#          mirror trạm Sở; phủ cả TP.HCM & Đà Nẵng.
# Nguồn C (services/airquality.py): Open-Meteo CAMS — mô hình lấp lỗ.
# WAQI token (aqicn.org) — ưu tiên biến môi trường WAQI_TOKEN; giá trị dưới
# đây chỉ là token demo miễn phí để bản zip chạy được ngay sau khi giải nén.
WAQI_TOKEN = os.getenv("WAQI_TOKEN", "").strip() or "3276c89c06f3366e1ea057cc3cb4cb657cc778ec"
WAQI_BOUNDS_URL = "https://api.waqi.info/map/bounds/"
WAQI_SEARCH_URL = "https://api.waqi.info/search/"
WAQI_FEED_GEO_URL = "https://api.waqi.info/feed/geo:{lat};{lng}/"
MOITRUONGTHUDO_SITE_URL = "https://moitruongthudo.vn/api/site"
# Task 99 — lịch sử AQI theo giờ của trạm Sở (portal của họ dùng đúng endpoint
# này cho biểu đồ "Lịch sử AQI"); hiện trả [] cho mọi trạm (mạng 35 trạm cũ
# ngừng hoạt động 12/2025) → fallback mô hình CAMS, nhưng khi Sở khôi phục
# dữ liệu lịch sử thì panel tự dùng số đo thật, không cần sửa code.
MOITRUONGTHUDO_HOURLY_URL = "https://moitruongthudo.vn/api/hourlyaqi/{site_id}"
STATIONS_CACHE_TTL_SECONDS = 30 * 60
STATION_RADIUS_KM = 50          # bán kính trạm tối đa tính từ tâm thành phố
STATION_NEAR_KM = 6             # AQI điểm đơn: trạm trong bán kính này → dùng trực tiếp
STATION_IDW_KM = 25             # nội suy IDW từ trạm trong bán kính này (≥2 trạm)
STATION_IDW_MIN = 2             # số trạm tối thiểu để nội suy
# timeout/UA dùng chung của external.http()

# ---------------------------------------------------------------------------
# Ward (phường/xã) boundaries — Task 63
# ---------------------------------------------------------------------------
# Ward (phường/xã) boundaries — bộ máy 2025, dùng để ghép ranh giới LEZ theo
# cụm phường chính thức và gán phường cho điểm xuất phát/đến của chuyến đi.
WARD_GEOJSON = DATA_DIR / "hanoi-wards.geojson"
