"""RideShift FastAPI backend — configuration (12-factor, env-driven)."""
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

# External services (proposal: OpenStreetMap + OSRM + Open-Meteo)
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
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
DATA_DIR = BASE_DIR / "data"
DATASET_CSV = DATA_DIR / "vehicle_at_hanoi.csv"
PROCESSED_DIR = DATA_DIR / "processed"
