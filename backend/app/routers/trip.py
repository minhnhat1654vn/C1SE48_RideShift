"""Trip analysis pipeline + switching-intention recording.

POST /api/trip/analyze — the full proposal pipeline in one call:
  Nominatim-resolved coordinates -> OSRM route -> LEZ spatial analysis
  (Shapely, outside/partial/within) -> policy-rule compliance per mode ->
  Open-Meteo air quality at route midpoint -> TOPSIS ranking with
  admin-configured weights + user preference adjustments + pandas-derived
  survey trend -> persist TripRecord for admin analytics.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..constants import (
    CRITERIA,
    CRITERION_LABELS,
    DAY_KEYS,
    PURPOSE_CONVENIENCE,
    clamp01,
    fmt_vi_vnd,
    guess_district,
)
from ..dto import iso_z
from ..services import airquality, external, geo, mcdm, trend

router = APIRouter()


class Point(BaseModel):
    lat: float
    lng: float
    name: Optional[str] = None


class Preferences(BaseModel):
    fastest: Optional[float] = Field(default=None, ge=0, le=100)
    cheapest: Optional[float] = Field(default=None, ge=0, le=100)
    eco: Optional[float] = Field(default=None, ge=0, le=100)
    comfort: Optional[float] = Field(default=None, ge=0, le=100)


class AnalyzeRequest(BaseModel):
    origin: Point
    destination: Point
    vehicleId: str
    purpose: str = Field(pattern="^(work|school|shopping|leisure|other)$")
    departureTime: Optional[str] = None
    preferences: Optional[Preferences] = None
    saveTrip: Optional[bool] = None


class ChoiceRequest(BaseModel):
    chosenModeId: Optional[str] = None


def _parse_hhmm(s: str) -> int:
    try:
        h, m = s.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return 0


def _display(criterion: str, v: float) -> str:
    if criterion == "travelTime":
        return f"{round(v)} phút"
    if criterion == "cost":
        return f"{fmt_vi_vnd(v)} VND"
    if criterion == "lezCompliance":
        return "Đạt hoàn toàn" if v >= 1 else ("Có điều kiện" if v >= 0.5 else "Bị hạn chế")
    if criterion in ("accessibility", "convenience", "trend"):
        return f"{round(v * 100)}%"
    if criterion == "environment":
        return "Không phát thải" if v == 0 else f"{round(v)} g CO₂/km"
    return str(v)


@router.post("/api/trip/analyze")
def analyze(body: AnalyzeRequest):
    origin = body.origin
    destination = body.destination

    if body.departureTime:
        try:
            departure = datetime.fromisoformat(body.departureTime.replace("Z", "+00:00"))
            if departure.tzinfo is None:
                departure = departure.replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status_code=400, detail="Thời gian khởi hành không hợp lệ.")
    else:
        departure = datetime.now(timezone.utc)

    try:
        # ---------- Load configuration ----------
        with db.get_conn() as conn:
            modes = conn.execute(
                "SELECT * FROM transport_mode WHERE enabled ORDER BY sort_order ASC"
            ).fetchall()
            weight_rows = conn.execute("SELECT * FROM criteria_weight").fetchall()
            zones = conn.execute(
                "SELECT * FROM lez_zone WHERE active ORDER BY created_at ASC"
            ).fetchall()
            locations = conn.execute(
                "SELECT * FROM transportation_location WHERE active"
            ).fetchall()

        if not any(m["id"] == body.vehicleId for m in modes):
            raise HTTPException(
                status_code=400,
                detail="Phương tiện đã chọn không được hỗ trợ hoặc đã bị tắt.",
            )

        # ---------- Route (Map & Routing Service: OSRM w/ fallback) ----------
        route = external.get_route(
            (origin.lat, origin.lng), (destination.lat, destination.lng)
        )

        # ---------- LEZ spatial analysis (outside / partial / within) ----------
        zone_polys = [
            {"id": z["id"], "name": z["name"], "polygon": json.loads(z["coordinates"])}
            for z in zones
        ]
        zone_checks = geo.analyze_route_vs_zones(route["coords"], zone_polys)
        affected_zones = [z for z in zone_checks if z["status"] != "outside"]
        affected_zone_ids = {z["zoneId"] for z in affected_zones}
        if not zone_checks:
            overall = "none"
        elif not affected_zones:
            overall = "outside"
        elif any(z["status"] == "within" for z in affected_zones):
            overall = "within"
        else:
            overall = "partial"

        # ---------- Vehicle & policy compliance per mode ----------
        dep_minutes = departure.hour * 60 + departure.minute
        # JS getDay(): 0=Sun..6=Sat — Python weekday(): 0=Mon..6=Sun
        dep_day = DAY_KEYS[(departure.weekday() + 1) % 7]

        compliance: dict = {}
        rules_by_mode = []
        if affected_zone_ids:
            with db.get_conn() as conn:
                rules_by_mode = conn.execute(
                    """
                    SELECT * FROM policy_rule
                    WHERE active AND zone_id = ANY(%s)
                    """,
                    (list(affected_zone_ids),),
                ).fetchall()

        zone_name = {z["id"]: z["name"] for z in zones}
        for m in modes:
            mid = m["id"]
            if not affected_zone_ids:
                compliance[mid] = {
                    "modeId": mid, "status": "compliant", "reason": None, "rules": []
                }
                continue
            relevant = [r for r in rules_by_mode if r["mode_id"] == mid]
            if not relevant:
                compliance[mid] = {
                    "modeId": mid,
                    "status": "compliant",
                    "reason": "Không có quy định hạn chế nào của vùng bạn đi qua áp dụng cho phương tiện này.",
                    "rules": [],
                }
                continue
            rule_dtos = [
                {
                    "zoneId": r["zone_id"],
                    "zoneName": zone_name.get(r["zone_id"], r["zone_id"]),
                    "modeId": r["mode_id"],
                    "modeName": m["name"],  # US-17: display name of the restricted mode
                    "restrictionType": r["restriction_type"],
                    "condition": r["condition"],
                    "startTime": r["start_time"],
                    "endTime": r["end_time"],
                    "days": r["days"],
                }
                for r in relevant
            ]
            active_at_departure = [
                r
                for r in relevant
                if dep_day in [d.strip() for d in r["days"].split(",")]
                and (
                    (
                        _parse_hhmm(r["start_time"]) <= _parse_hhmm(r["end_time"])
                        and _parse_hhmm(r["start_time"])
                        <= dep_minutes
                        <= _parse_hhmm(r["end_time"])
                    )
                    or (
                        _parse_hhmm(r["start_time"]) > _parse_hhmm(r["end_time"])
                        and (
                            dep_minutes >= _parse_hhmm(r["start_time"])
                            or dep_minutes <= _parse_hhmm(r["end_time"])
                        )
                    )
                )
            ]
            if not active_at_departure:
                compliance[mid] = {
                    "modeId": mid,
                    "status": "compliant",
                    "reason": (
                        f"Quy định hạn chế chỉ áp dụng trong khung giờ được cấu hình "
                        f"(ví dụ {rule_dtos[0]['startTime']}–{rule_dtos[0]['endTime']}, "
                        f"các ngày {rule_dtos[0]['days']}). Thời gian khởi hành của bạn "
                        "nằm ngoài khung giờ hạn chế."
                    ),
                    "rules": rule_dtos,
                }
            else:
                banned = next(
                    (r for r in active_at_departure if r["restriction_type"] == "banned"),
                    None,
                )
                if banned:
                    compliance[mid] = {
                        "modeId": mid,
                        "status": "not_permitted",
                        "reason": (
                            f"Không được phép vào {zone_name.get(banned['zone_id'], 'vùng LEZ')} "
                            "vào thời điểm khởi hành đã chọn."
                        ),
                        "rules": rule_dtos,
                    }
                else:
                    compliance[mid] = {
                        "modeId": mid,
                        "status": "conditionally_restricted",
                        "reason": active_at_departure[0]["condition"]
                        or "Quy định hạn chế có điều kiện áp dụng trong vùng phát thải thấp.",
                        "rules": rule_dtos,
                    }

        # ---------- Air quality at route midpoint ----------
        mid_point = route["coords"][len(route["coords"]) // 2]
        air = airquality.get_air_quality(mid_point[0], mid_point[1])
        # US-08: geographic context — label the reading with the trip's own
        # route midpoint instead of the upstream service name.
        _origin_label = origin.name or f"{origin.lat:.4f}, {origin.lng:.4f}"
        _dest_label = destination.name or f"{destination.lat:.4f}, {destination.lng:.4f}"
        air["locationLabel"] = f"Trung điểm tuyến: {_origin_label} → {_dest_label}"[:90]

        # ---------- Survey-derived trend (pandas pipeline + history) ----------
        history_since = datetime.now(timezone.utc) - timedelta(days=90)
        with db.get_conn() as conn:
            history = conn.execute(
                """
                SELECT top_mode_id, count(*) AS c FROM trip_record
                WHERE purpose = %s AND created_at >= %s
                GROUP BY top_mode_id
                """,
                (body.purpose, history_since),
            ).fetchall()
        hist_total = sum(r["c"] for r in history)
        hist_count = {r["top_mode_id"]: r["c"] for r in history}

        # ---------- Per-mode criterion vectors ----------
        origin_pt = (origin.lat, origin.lng)
        bus_stops = [l for l in locations if l["type"] == "bus_stop"]
        alternatives = []
        metas = {}
        for m in modes:
            mid = m["id"]
            travel_time_min = (route["distanceKm"] / m["avg_speed_kmh"]) * 60 + m["wait_minutes"]
            cost_vnd = m["base_cost_vnd"] + m["cost_per_km_vnd"] * route["distanceKm"]
            co2_kg = (m["co2_per_km_g"] * route["distanceKm"]) / 1000

            status = compliance[mid]["status"]
            lez_score = 1.0 if status == "compliant" else (0.5 if status == "conditionally_restricted" else 0.0)

            accessibility = m["base_accessibility"]
            if mid == "bus":
                d = geo.nearest_distance_km(origin_pt, bus_stops)
                accessibility = clamp01(m["base_accessibility"] * 0.6 + 0.4 * (1 - min(d, 2) / 2))

            purpose_mod = PURPOSE_CONVENIENCE.get(body.purpose, {}).get(mid, 0)
            convenience = clamp01(m["base_convenience"] + purpose_mod)

            dataset_trend = trend.trend_value(mid)
            empirical = (hist_count.get(mid, 0) / hist_total) if hist_total > 0 else 0.0
            trend_score = clamp01(dataset_trend * 0.6 + empirical * 0.4 * 3)

            travel_time_adj = travel_time_min
            if mid == "walking" and route["distanceKm"] > 5:
                travel_time_adj += (route["distanceKm"] - 5) * 30
            if mid == "bicycle" and route["distanceKm"] > 12:
                travel_time_adj += (route["distanceKm"] - 12) * 8

            alternatives.append(
                {
                    "id": mid,
                    "name": m["name"],
                    "icon": m["icon"],
                    "raw": {
                        "travelTime": travel_time_adj,
                        "cost": cost_vnd,
                        "lezCompliance": lez_score,
                        "accessibility": accessibility,
                        "convenience": convenience,
                        "environment": m["co2_per_km_g"],
                        "trend": trend_score,
                    },
                }
            )
            metas[mid] = {"travelTimeMin": travel_time_min, "costVnd": cost_vnd, "co2Kg": co2_kg}

        # ---------- Weights (admin-configured + user preference adjustments) ----------
        base_weights = {w["criterion"]: w["weight"] for w in weight_rows}
        prefs = body.preferences

        def adj(base: float, pref) -> float:
            p = pref if pref is not None else 50
            return base * (1 + ((p - 50) / 100) * 1.4)

        weights_used = {
            "travelTime": adj(base_weights.get("travelTime", 25), prefs.fastest if prefs else None),
            "cost": adj(base_weights.get("cost", 20), prefs.cheapest if prefs else None),
            "lezCompliance": base_weights.get("lezCompliance", 20),
            "accessibility": adj(base_weights.get("accessibility", 10), prefs.comfort if prefs else None),
            "convenience": adj(base_weights.get("convenience", 10), prefs.comfort if prefs else None),
            "environment": adj(base_weights.get("environment", 10), prefs.eco if prefs else None),
            "trend": base_weights.get("trend", 5),
        }

        scored = mcdm.topsis(alternatives, weights_used)

        recommendations = []
        for s in scored:
            alt = next(a for a in alternatives if a["id"] == s["id"])
            recommendations.append(
                {
                    "modeId": s["id"],
                    "modeName": s["name"],
                    "icon": alt["icon"],
                    "score": s["score"],
                    "rank": s["rank"],
                    "travelTimeMin": metas[s["id"]]["travelTimeMin"],
                    "costVnd": metas[s["id"]]["costVnd"],
                    "co2Kg": metas[s["id"]]["co2Kg"],
                    "compliance": compliance[s["id"]],
                    "criteria": [
                        {
                            "criterion": c,
                            "label": CRITERION_LABELS[c],
                            "raw": alt["raw"][c],
                            "normalized": s["normalized"][c],
                            "contribution": s["contributions"][c],
                            "weightPct": weights_used[c],
                            "display": _display(c, alt["raw"][c]),
                        }
                        for c in CRITERIA
                    ],
                }
            )

        # ---------- Persist trip for admin analytics ----------
        trip_id = None
        if body.saveTrip is not False:
            trip_id = uuid.uuid4().hex
            recs = recommendations
            with db.get_conn() as conn:
                conn.execute(
                    """
                    INSERT INTO trip_record (id, origin_name, dest_name, origin_district,
                        origin_lat, origin_lng, dest_lat, dest_lng, distance_km, duration_min,
                        vehicle_id, purpose, departure_hour, lez_affected, top_mode_id,
                        top_score, avg_cost_vnd, avg_time_min)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        trip_id,
                        origin.name or f"{origin.lat:.4f}, {origin.lng:.4f}",
                        destination.name or f"{destination.lat:.4f}, {destination.lng:.4f}",
                        guess_district(origin.name),
                        origin.lat,
                        origin.lng,
                        destination.lat,
                        destination.lng,
                        route["distanceKm"],
                        route["durationMin"],
                        body.vehicleId,
                        body.purpose,
                        departure.hour,
                        len(affected_zone_ids) > 0,
                        recs[0]["modeId"] if recs else body.vehicleId,
                        recs[0]["score"] if recs else 0.0,
                        (sum(r["costVnd"] for r in recs) / len(recs)) if recs else 0.0,
                        (sum(r["travelTimeMin"] for r in recs) / len(recs)) if recs else 0.0,
                    ),
                )

        return {
            "tripId": trip_id,
            "vehicleId": body.vehicleId,
            "route": {
                "coords": [[c[0], c[1]] for c in route["coords"]],
                "distanceKm": route["distanceKm"],
                "durationMin": route["durationMin"],
                "source": route["source"],
            },
            "origin": {
                "lat": origin.lat,
                "lng": origin.lng,
                "name": origin.name or f"{origin.lat:.4f}, {origin.lng:.4f}",
            },
            "destination": {
                "lat": destination.lat,
                "lng": destination.lng,
                "name": destination.name or f"{destination.lat:.4f}, {destination.lng:.4f}",
            },
            "lez": {
                "overall": overall,
                "zones": zone_checks,
                "affected": len(affected_zone_ids) > 0,
            },
            "compliance": compliance,
            "airQuality": air,
            "recommendations": recommendations,
            "weightsUsed": weights_used,
        }
    except HTTPException:
        raise
    except Exception as e:
        print("analyze error:", repr(e))
        raise HTTPException(status_code=500, detail="Phân tích tuyến đường thất bại. Vui lòng thử lại sau giây lát.")


@router.post("/api/trips/{trip_id}/choice")
def record_choice(trip_id: str, body: ChoiceRequest):
    """Record the user's transportation decision (switching intention)."""
    with db.get_conn() as conn:
        trip = conn.execute(
            "SELECT id, vehicle_id FROM trip_record WHERE id = %s", (trip_id,)
        ).fetchone()
        if not trip:
            raise HTTPException(status_code=404, detail="Không tìm thấy chuyến đi.")
        switched = body.chosenModeId is not None and body.chosenModeId != trip["vehicle_id"]
        conn.execute(
            "UPDATE trip_record SET chosen_mode_id = %s, switched = %s WHERE id = %s",
            (body.chosenModeId, switched, trip_id),
        )
    return {"ok": True, "trip": {"id": trip_id, "switched": switched}}
