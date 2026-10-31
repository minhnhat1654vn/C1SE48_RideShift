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
from . import airquality_sources, external


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
        "source": "open-meteo",
        "notice": "Mô hình CAMS (Open-Meteo) — không có trạm đo thật trong 25 km.",
        "locationLabel": "Open-Meteo Air Quality (mô hình)",
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



def _persist_point(cache_key: str, lat: float, lng: float, now, info: dict, source: str) -> None:
    """Lưu 1 điểm AQI (trạm/nội suy) vào bảng cache — raw_data giữ nguyên payload."""
    try:
        with db.get_conn() as conn:
            study = db.study_area_id(conn)
            conn.execute(
                """
                INSERT INTO decision.air_quality_observations
                    (cache_key, study_area_id, source, lat, lng, location,
                     observed_at, aqi, raw_data)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (cache_key) DO UPDATE
                SET raw_data = EXCLUDED.raw_data, observed_at = EXCLUDED.observed_at,
                    aqi = EXCLUDED.aqi, source = EXCLUDED.source
                """,
                (
                    cache_key, study, source, lat, lng,
                    json.dumps({"type": "Point", "coordinates": [lng, lat]}),
                    now, info.get("aqi"), json.dumps(info, ensure_ascii=False),
                ),
            )
    except Exception:
        pass  # cache lỗi không được làm chết phản hồi


def get_air_quality(lat: float, lng: float) -> dict:
    cache_key = f"{lat:.2f}:{lng:.2f}"
    now = datetime.now(timezone.utc)

    # 1) TRẠM ĐO THẬT gần nhất (≤ 6 km) — ưu tiên tuyệt đối, gắn nguồn minh bạch
    try:
        near = airquality_sources.nearest_stations(lat, lng, config.STATION_NEAR_KM, 1)
        if near:
            st = near[0]
            info = {
                "aqi": st["aqi"],
                "pm25": None,
                "pm10": None,
                "measuredAt": st["measuredAt"],
                "source": "station",
                "notice": None,
                "locationLabel": f"{st['name']} · {st['sourceLabel']}",
            }
            _persist_point(cache_key, lat, lng, now, info, "station")
            return info
    except Exception:
        pass  # nguồn trạm chết → nội suy → mô hình

    # 2) NỘI SUY IDW (p=2) từ 2–4 trạm thật trong 25 km
    try:
        around = airquality_sources.nearest_stations(lat, lng, config.STATION_IDW_KM, 4)
        if len(around) >= config.STATION_IDW_MIN:
            w_sum = 0.0
            v_sum = 0.0
            for st in around:
                d = max(0.3, airquality_sources.haversine_km(lat, lng, st["lat"], st["lng"]))
                w = 1.0 / (d * d)
                w_sum += w
                v_sum += w * st["aqi"]
            names = ", ".join(st["name"] for st in around[:2])
            info = {
                "aqi": round(v_sum / w_sum),
                "pm25": None,
                "pm10": None,
                "measuredAt": now.isoformat(),
                "source": "interpolated",
                "notice": (
                    f"Nội suy từ {len(around)} trạm đo thật gần nhất (không có trạm trong "
                    f"{config.STATION_NEAR_KM:.0f} km)."
                ),
                "locationLabel": f"Nội suy từ trạm đo · {names}",
            }
            _persist_point(cache_key, lat, lng, now, info, "interpolated")
            return info
    except Exception:
        pass  # nội suy lỗi → mô hình

    with db.get_conn() as conn:
        cached = conn.execute(
            "SELECT raw_data, observed_at FROM decision.air_quality_observations WHERE cache_key = %s",
            (cache_key,),
        ).fetchone()

    fresh = cached and (now - cached["observed_at"]) < timedelta(seconds=config.AQ_CACHE_TTL_SECONDS)
    if fresh and cached:
        payload = _payload_of(cached["raw_data"])
        if payload:
            return payload  # fresh cache giữ nguyên source của dữ liệu gốc

    info = _fetch_open_meteo(lat, lng)
    if info:
        with db.get_conn() as conn:
            study = db.study_area_id(conn)
            conn.execute(
                """
                INSERT INTO decision.air_quality_observations
                    (cache_key, study_area_id, source, lat, lng, location,
                     observed_at, aqi, pm25, pm10, no2, o3, raw_data)
                VALUES (%s, %s, 'open-meteo', %s, %s, %s, %s, %s, %s, %s, NULL, NULL, %s)
                ON CONFLICT (cache_key) DO UPDATE
                SET raw_data = EXCLUDED.raw_data, observed_at = EXCLUDED.observed_at,
                    aqi = EXCLUDED.aqi, pm25 = EXCLUDED.pm25, pm10 = EXCLUDED.pm10
                """,
                (
                    cache_key, study, lat, lng,
                    json.dumps({"type": "Point", "coordinates": [lng, lat]}),
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
