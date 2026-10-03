"""Air Quality Service — cache-first strategy (US-08, US-19).

Order: fresh DB cache (30 min TTL) -> Open-Meteo Air Quality API ->
stale cache with notice -> UNAVAILABLE (nulls — the spec forbids
fabricating values when no real measurement exists).

Response contract (shared with the frontend):
  aqi/pm25/pm10/category/measuredAt are nullable, locationLabel/notice are
  strings-or-null, and source ∈ live | cache | estimate | unavailable.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from .. import config, db
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


def get_air_quality(lat: float, lng: float) -> dict:
    cache_key = f"{lat:.2f}:{lng:.2f}"
    now = datetime.now(timezone.utc)

    with db.get_conn() as conn:
        cached = conn.execute(
            "SELECT payload, fetched_at FROM air_quality_cache WHERE cache_key = %s",
            (cache_key,),
        ).fetchone()

    fresh = cached and (now - cached["fetched_at"]) < timedelta(seconds=config.AQ_CACHE_TTL_SECONDS)
    if fresh and cached:
        try:
            payload = json.loads(cached["payload"])
            payload["source"] = "live"  # fresh cache == live-grade data
            return payload
        except Exception:
            pass

    info = _fetch_open_meteo(lat, lng)
    if info:
        with db.get_conn() as conn:
            conn.execute(
                """
                INSERT INTO air_quality_cache (id, cache_key, payload, fetched_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (cache_key) DO UPDATE
                SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at
                """,
                (uuid.uuid4().hex, cache_key, json.dumps(info), now),
            )
        return info

    if cached:
        try:
            payload = json.loads(cached["payload"])
            payload["source"] = "cache"
            payload["notice"] = (
                "Dữ liệu chất lượng không khí tạm thời không cập nhật được — "
                "hiển thị dữ liệu cache gần nhất (hơn 30 phút)."
            )
            return payload
        except Exception:
            pass

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
