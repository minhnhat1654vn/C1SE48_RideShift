"""RideShift FastAPI backend — configuration (12-factor, env-driven)."""
# Geocode chain: Goong (VN house numbers, optional key) → Nominatim → local
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# PostgreSQL connection (proposal: PostgreSQL; docker-compose uses postgis image).
# The sandbox platform may inject DATABASE_URL=file:...custom.db (SQLite legacy) —
# anything that is not a postgres DSN is rejected in favour of the local server.
_ENV_DATABASE_URL = os.getenv("DATABASE_URL", "")
DATABASE_URL = (
    _ENV_DATABASE_URL
    if _ENV_DATABASE_URL.startswith(("postgres://", "postgresql://"))
    else "postgresql://postgres@127.0.0.1:5432/rideshift"
)

# HTTP port for this service (frontend reaches it through the gateway with
# ?XTransformPort=8000, or directly on port 8000 in a standard deployment)
PORT = int(os.getenv("BACKEND_PORT", "8000"))

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
#
# Chain implemented in services/external.py:
#   1) Place AutoComplete  — VN text search WITH house numbers (best match for
#      partial/fuzzy input like "120 yên") → returns place_id predictions
#   2) Place Detail        — resolves each prediction to exact coordinates
#   1b) Geocoding API      — classic full-address geocoder, kept as fallback
# All *_URL variables are env-overridable so mirrors/proxies/self-signed test
# servers can be pointed at without touching code.
GOONG_API_KEY = os.getenv("GOONG_API_KEY", "")
GOONG_GEOCODE_URL = (
    os.getenv("GOONG_GEOCODE_URL") or "https://rsapi.goong.io/geocode"
)
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
KAGGLE_CSV = DATA_DIR / "dataHN.csv"
DATASET_CSV = DATA_DIR / "vehicle_at_hanoi.csv"
PROCESSED_DIR = DATA_DIR / "processed"
