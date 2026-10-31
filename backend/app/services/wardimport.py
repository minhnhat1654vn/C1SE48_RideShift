"""Ward (phường/xã) import + point-in-ward helpers.

Nguồn dữ liệu: data/hanoi-wards.geojson (126 phường/xã bộ máy 2025 — đồng bộ
với public/data/hanoi-wards.geojson phía frontend). Dữ liệu được nạp 1 lần vào
gis.administrative_regions với region_type='WARD' để:

  * ghép ranh giới LEZ theo cụm phường chính thức (policy.lez_zone_wards);
  * gán origin_ward_code / destination_ward_code cho trip.trips (thống kê theo
    phường ở dashboard quản trị).

Không PostGIS? Vẫn chạy được: phép giao điểm-đa giác dùng Shapely trong Python
(backend vốn dùng Shapely theo đề cương).
"""
import json
import logging
from pathlib import Path

from shapely.geometry import shape
from shapely.prepared import prep

from .. import config, db

log = logging.getLogger("rideshift.wardimport")

# module-level cache: list of {code, name, geom (shapely), prep}
_ward_cache: list[dict] | None = None


def _load_geojson_features() -> list[dict]:
    """Read the ward GeoJSON; fall back to the frontend copy when missing."""
    candidates = [config.WARD_GEOJSON, config.BASE_DIR.parent.parent / "public" / "data" / "hanoi-wards.geojson"]
    for path in candidates:
        p = Path(path)
        if p.exists():
            with p.open(encoding="utf-8") as f:
                geo = json.load(f)
            feats = geo.get("features", [])
            log.info("wardimport: loaded %d wards from %s", len(feats), p.name)
            return feats
    log.warning("wardimport: no ward GeoJSON found (looked at %s)", [str(c) for c in candidates])
    return []


def ensure_wards(conn) -> int:
    """Import wards into gis.administrative_regions (idempotent).

    Re-runs are cheap: only ward codes missing from the DB get inserted, so a
    partially-imported file (vd. trùng tên quận/huyện ở lần chạy cũ) tự lành.
    Returns the number of WARD rows available after the call.
    """
    feats = _load_geojson_features()
    if not feats:
        return 0
    study_id = db.study_area_id(conn, "HN")
    if not study_id:
        return 0
    existing = {
        r["code"]
        for r in conn.execute(
            "SELECT code FROM gis.administrative_regions WHERE region_type = 'WARD' AND study_area_id = %s",
            (study_id,),
        ).fetchall()
    }
    inserted = 0
    for feat in feats:
        props = feat.get("properties", {})
        code = str(props.get("ma_xa") or "").strip()
        name = str(props.get("ten_xa") or "").strip()
        geom = feat.get("geometry")
        if not code or not name or not geom or code in existing:
            continue
        try:
            conn.execute(
                """
                INSERT INTO gis.administrative_regions
                    (study_area_id, code, name, region_type, geometry, source, status)
                VALUES (%s, %s, %s, 'WARD', %s, 'hanoi-wards.geojson', 'active')
                ON CONFLICT (study_area_id, name, region_type) DO NOTHING
                """,
                (study_id, code, name, json.dumps(geom)),
            )
            inserted += 1
        except Exception:  # noqa: BLE001 — one bad polygon must not break boot
            continue
    count = conn.execute(
        "SELECT count(*) AS c FROM gis.administrative_regions WHERE region_type = 'WARD'"
    ).fetchone()["c"]
    if inserted:
        invalidate_cache()
        log.info("wardimport: inserted %d missing wards (total=%d)", inserted, int(count))
    return int(count)


def _build_cache() -> list[dict]:
    """Load ward polygons from DB into shapely prepared geometries."""
    global _ward_cache
    if _ward_cache is not None:
        return _ward_cache
    wards: list[dict] = []
    try:
        with db.get_conn() as conn:
            rows = conn.execute(
                """
                SELECT code, name, geometry FROM gis.administrative_regions
                WHERE region_type = 'WARD' AND status = 'active'
                """
            ).fetchall()
        for r in rows:
            try:
                geom_json = r["geometry"]
                if not geom_json:
                    continue
                geom = shape(json.loads(geom_json) if isinstance(geom_json, str) else geom_json)
                wards.append({"code": r["code"], "name": r["name"], "geom": geom, "prep": prep(geom)})
            except Exception:  # noqa: BLE001
                continue
    except Exception as exc:  # noqa: BLE001
        log.warning("wardimport: cannot load ward cache: %r", exc)
    _ward_cache = wards
    return wards


def invalidate_cache() -> None:
    global _ward_cache
    _ward_cache = None


def ward_of_point(lat: float, lng: float) -> dict | None:
    """Return {'code','name'} of the ward containing the point, or None."""
    wards = _build_cache()
    if not wards:
        return None
    from shapely.geometry import Point

    pt = Point(float(lng), float(lat))  # shapely: x=lng, y=lat
    for w in wards:
        try:
            if w["prep"].contains(pt) or w["prep"].intersects(pt):
                return {"code": w["code"], "name": w["name"]}
        except Exception:  # noqa: BLE001
            continue
    return None


def backfill_trip_wards(conn, limit: int = 500) -> int:
    """Fill origin/destination ward codes for trips missing them (best-effort)."""
    rows = conn.execute(
        """
        SELECT trip_id, origin_lat, origin_lng, dest_lat, dest_lng
        FROM trip.trips
        WHERE origin_ward_code IS NULL AND origin_lat IS NOT NULL
        LIMIT %s
        """,
        (limit,),
    ).fetchall()
    updated = 0
    for r in rows:
        o = ward_of_point(r["origin_lat"], r["origin_lng"]) if r["origin_lat"] is not None else None
        d = ward_of_point(r["dest_lat"], r["dest_lng"]) if r.get("dest_lat") is not None else None
        conn.execute(
            "UPDATE trip.trips SET origin_ward_code = %s, destination_ward_code = %s WHERE trip_id = %s",
            (o["code"] if o else None, d["code"] if d else None, r["trip_id"]),
        )
        updated += 1
    if updated:
        log.info("wardimport: backfilled ward codes for %d trips", updated)
    return updated
