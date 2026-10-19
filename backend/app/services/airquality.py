"""Air Quality Service — cache-first strategy (US-08, US-19).

Order: fresh DB cache (30 min TTL) -> Open-Meteo Air Quality API ->
stale cache with notice -> UNAVAILABLE (nulls — the spec forbids
fabricating values when no real measurement exists).

Observations persist in decision.air_quality_observations (DB FINAL):
promoted aqi/pm25/pm10 columns + the full upstream payload in raw_data.

Response contract (shared with the frontend):
  aqi/pm25/pm10/category/measuredAt are nullable, locationLabel/notice are
  strings-or-null, and source ∈ live | cache | estimate | unavailable.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from .. import config, db
from ..geojson import point_geojson
from . import external


def _fetch_open_meteo(lat: float, lng: float) -> Optional[dict]:
    url = (
        f"{config.OPEN_METEO_AQ_URL}?latitude={lat:.4f}&longitude={lng:.4f}"
        "&current=pm10,pm2_5,us_aqi&timezone=Asia%2FBangkok"
    )
    try:
        resp = external.http().get(url, timeout=config.TIMEOUT_AIR)
        cur = (resp.json() or {}).get("current")
    except Exception:
        return None
    if not cur or cur.get("us_aqi") is None:
        return None
    return {
        "aqi": round(cur["us_aqi"]),
        "pm25": round(cur["pm2_5"] * 10) / 10 if cur.get("pm2_5") is not None else None,
        "pm10": round(cur["pm10"] * 10) / 10 if cur.get("pm10") is not None else None,
        "measuredAt": cur.get("time") or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "live",
        "locationLabel": "Dịch vụ chất lượng không khí Open-Meteo",
    }


def _payload_of(raw) -> Optional[dict]:
    if raw is None:
        return None
    if isinstance(raw, dict):
        return dict(raw)
    try:
        return json.loads(raw)
    except Exception:
        return None


def get_air_quality(lat: float, lng: float) -> dict:
    cache_key = f"{lat:.2f}:{lng:.2f}"
    now = datetime.now(timezone.utc)

    with db.get_conn() as conn:
        cached = conn.execute(
            "SELECT raw_data, observed_at FROM decision.air_quality_observations WHERE cache_key = %s",
            (cache_key,),
        ).fetchone()

    fresh = cached and (now - cached["observed_at"]) < timedelta(seconds=config.AQ_CACHE_TTL_SECONDS)
    if fresh and cached:
        payload = _payload_of(cached["raw_data"])
        if payload:
            payload["source"] = "live"  # fresh cache == live-grade data
            return payload

    info = _fetch_open_meteo(lat, lng)
    if info:
        with db.get_conn() as conn:
            study = db.study_area_id(conn)
            conn.execute(
                f"""
                INSERT INTO decision.air_quality_observations
                    (cache_key, study_area_id, source, lat, lng, location,
                     observed_at, aqi, pm25, pm10, no2, o3, raw_data)
                VALUES (%s, %s, 'open-meteo', %s, %s, {db.geom_write()}, %s, %s, %s, %s, NULL, NULL, %s)
                ON CONFLICT (cache_key) DO UPDATE
                SET raw_data = EXCLUDED.raw_data, observed_at = EXCLUDED.observed_at,
                    aqi = EXCLUDED.aqi, pm25 = EXCLUDED.pm25, pm10 = EXCLUDED.pm10
                """,
                (
                    cache_key, study, lat, lng,
                    point_geojson(lat, lng),
                    now,
                    info.get("aqi"), info.get("pm25"), info.get("pm10"),
                    json.dumps(info),
                ),
            )
        return info

    if cached:
        payload = _payload_of(cached["raw_data"])
        if payload:
            payload["source"] = "cache"
            payload["notice"] = (
                "Dữ liệu chất lượng không khí tạm thời không cập nhật được — "
                "hiển thị dữ liệu cache gần nhất (hơn 30 phút)."
            )
            return payload

    # US-19 AC3: with neither live data nor any cached measurement we must
    # NOT fabricate values, so report the data as UNAVAILABLE (all nulls)
    # instead of estimating. external.simulate_air_quality() is kept for
    # reference/offline tooling but is intentionally no longer called here.
    return {
        "aqi": None,
        "pm25": None,
        "pm10": None,
        "category": None,
        "measuredAt": None,
        "source": "unavailable",
        "notice": "Dữ liệu chất lượng không khí hiện không khả dụng.",
        "locationLabel": None,
    }
