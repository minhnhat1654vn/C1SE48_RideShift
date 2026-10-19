"""Public REST endpoints (no auth): zones, modes, locations, geocode,
air quality, dataset summary + health."""
import uuid

from fastapi import APIRouter, HTTPException, Query

from .. import db
from ..dto import location_dto, mode_dto, zone_dto
from ..services import airquality, external, trend

router = APIRouter()


@router.get("/health")
def health():
    try:
        with db.get_conn() as conn:
            conn.execute("SELECT 1")
        return {
            "status": "ok",
            "service": "rideshift-fastapi-backend",
            "database": db.db_name(),
            "postgis": db.postgis_available(),
        }
    except Exception as e:
        return {"status": "degraded", "error": str(e)}


@router.get("/api/zones")
def get_zones(all: str = Query(default="", alias="all")):
    include_inactive = all == "1"
    with db.get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT lez_zone_id, name, description, status, effective_from,
                   created_at, updated_at, {db.geom_read('geometry', 'geometry_json')}
            FROM policy.lez_zones
            WHERE (%s OR status = 'active')
            ORDER BY created_at ASC
            """,
            (include_inactive,),
        ).fetchall()
    return {"zones": [zone_dto(r, parsed_coordinates=True) for r in rows]}


@router.get("/api/modes")
def get_modes():
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM transportation.transportation_modes ORDER BY sort_order ASC"
        ).fetchall()
    return {"modes": [mode_dto(r) for r in rows]}


@router.get("/api/locations")
def get_locations():
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT transportation_location_id, name, location_type, lat, lng,
                   address, source, status
            FROM transportation.transportation_locations
            WHERE status = 'active' ORDER BY name
            """
        ).fetchall()
    return {"locations": [location_dto(r) for r in rows]}


@router.get("/api/geocode")
def geocode(q: str = ""):
    if len(q.strip()) < 2:
        return {"results": []}
    try:
        return {"results": external.geocode_address(q)}
    except Exception:
        raise HTTPException(status_code=500, detail="Tìm kiếm địa điểm thất bại.")


@router.get("/api/airquality")
def air(lat: float = Query(...), lng: float = Query(...)):
    return {"airQuality": airquality.get_air_quality(lat, lng)}


@router.get("/api/dataset/summary")
def dataset_summary():
    """Processed "Vehicle at Ha Noi Dataset" (Deliverable #11 — pandas)."""
    return trend.dataset_summary()


def _new_id() -> str:
    return uuid.uuid4().hex
