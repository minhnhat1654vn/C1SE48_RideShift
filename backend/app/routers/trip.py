"""Trip analysis pipeline + switching-intention recording.

POST /api/trip/analyze — the full proposal pipeline in one call:
  Nominatim-resolved coordinates -> OSRM route -> LEZ spatial analysis
  (Shapely, outside/partial/within) -> policy compliance per mode
  (policy.lez_rules × policy.vehicle_restrictions × policy.vehicle_types) ->
  Open-Meteo air quality at route midpoint -> TOPSIS ranking with
  admin-configured weights + user preference adjustments + pandas-derived
  survey trend -> persists the full DB FINAL chain in one transaction:
  trip.trips -> trip.trip_routes -> trip.trip_lez_analyses ->
  decision.recommendation_runs -> decision.recommendation_scores ->
  decision.impact_assessments.
"""
import json
import time as _time
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
from ..dto import _hhmm, zone_pairs_from_row
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
        h, m = str(s).split(":")
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


def _load_active_restrictions(conn, zone_ids: list) -> list:
    """Joined policy rows: lez_rules × vehicle_restrictions × vehicle_types × modes."""
    return conn.execute(
        """
        SELECT lr.lez_rule_id, lr.lez_zone_id, lr.start_time, lr.end_time,
               lr.days_of_week, lr.description,
               vr.restriction_type, vr.restriction_reason,
               tm.code AS mode_code, tm.name AS mode_name
        FROM policy.lez_rules lr
        JOIN policy.vehicle_restrictions vr ON vr.lez_rule_id = lr.lez_rule_id
        JOIN policy.vehicle_types vt ON vt.vehicle_type_id = vr.vehicle_type_id
        JOIN transportation.transportation_modes tm
          ON tm.transportation_mode_id = vt.transportation_mode_id
        WHERE lr.status = 'active' AND lr.lez_zone_id = ANY(%s)
        """,
        (zone_ids,),
    ).fetchall()


@router.post("/api/trip/analyze")
def analyze(body: AnalyzeRequest):
    t0 = _time.perf_counter()
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
                """
                SELECT * FROM transportation.transportation_modes
                WHERE is_active ORDER BY sort_order ASC
                """
            ).fetchall()
            weight_rows = conn.execute(
                "SELECT code, default_weight FROM decision.recommendation_criteria"
            ).fetchall()
            zones = conn.execute(
                """
                SELECT * FROM policy.lez_zones
                WHERE status = 'active' ORDER BY created_at ASC
                """
            ).fetchall()
            locations = conn.execute(
                """
                SELECT * FROM transportation.transportation_locations WHERE status = 'active'
                """
            ).fetchall()

        if not any(m["code"] == body.vehicleId for m in modes):
            raise HTTPException(
                status_code=400,
                detail="Phương tiện đã chọn không được hỗ trợ hoặc đã bị tắt.",
            )

        # ---------- Route (Map & Routing Service: OSRM w/ fallback) ----------
        route = external.get_route(
            (origin.lat, origin.lng), (destination.lat, destination.lng)
        )

        # ---------- LEZ spatial analysis (outside / partial / within) ----------
        # Task 93 — zone_pairs_from_row: ưu tiên coordinates, fallback geometry
        # (volume cũ) — một dòng hỏng bị bỏ qua thay vì làm chết cả phân tích.
        zone_polys = []
        for z in zones:
            pairs = zone_pairs_from_row(z)
            if pairs:
                zone_polys.append(
                    {"id": z["lez_zone_id"], "name": z["name"], "polygon": pairs}
                )
        zone_checks = geo.analyze_route_vs_zones(route["coords"], zone_polys)
        affected_zones = [z for z in zone_checks if z["status"] != "outside"]
        affected_zone_ids = [z["zoneId"] for z in affected_zones]
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
        rules_rows = []
        if affected_zone_ids:
            with db.get_conn() as conn:
                rules_rows = _load_active_restrictions(conn, affected_zone_ids)

        zone_name = {z["lez_zone_id"]: z["name"] for z in zones}
        for m in modes:
            mid = m["code"]
            if not affected_zone_ids:
                compliance[mid] = {
                    "modeId": mid, "status": "compliant", "reason": None, "rules": []
                }
                continue
            relevant = [r for r in rules_rows if r["mode_code"] == mid]
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
                    "id": r["lez_rule_id"],
                    "zoneId": r["lez_zone_id"],
                    "zoneName": zone_name.get(r["lez_zone_id"], str(r["lez_zone_id"])),
                    "modeId": r["mode_code"],
                    "modeName": r["mode_name"],
                    "restrictionType": r["restriction_type"],
                    "condition": r["restriction_reason"] or r["description"],
                    "startTime": _hhmm(r["start_time"]),
                    "endTime": _hhmm(r["end_time"]),
                    "days": r["days_of_week"],
                }
                for r in relevant
            ]
            active_at_departure = [
                r
                for r in relevant
                if dep_day in [d.strip() for d in r["days_of_week"].split(",")]
                and (
                    (
                        _parse_hhmm(_hhmm(r["start_time"])) <= _parse_hhmm(_hhmm(r["end_time"]))
                        and _parse_hhmm(_hhmm(r["start_time"]))
                        <= dep_minutes
                        <= _parse_hhmm(_hhmm(r["end_time"]))
                    )
                    or (
                        _parse_hhmm(_hhmm(r["start_time"])) > _parse_hhmm(_hhmm(r["end_time"]))
                        and (
                            dep_minutes >= _parse_hhmm(_hhmm(r["start_time"]))
                            or dep_minutes <= _parse_hhmm(_hhmm(r["end_time"]))
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
                        f"(ví dụ {_hhmm(relevant[0]['start_time'])}–{_hhmm(relevant[0]['end_time'])}, "
                        f"các ngày {relevant[0]['days_of_week']}). Thời gian khởi hành của bạn "
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
                            f"Không được phép vào {zone_name.get(banned['lez_zone_id'], 'vùng LEZ')} "
                            "vào thời điểm khởi hành đã chọn."
                        ),
                        "rules": rule_dtos,
                    }
                else:
                    compliance[mid] = {
                        "modeId": mid,
                        "status": "conditionally_restricted",
                        "reason": active_at_departure[0]["restriction_reason"]
                        or active_at_departure[0]["description"]
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
                SELECT tm.code AS top_mode_id, count(*) AS c
                FROM trip.trips t
                JOIN transportation.transportation_modes tm
                  ON tm.transportation_mode_id = t.top_mode_id
                WHERE t.trip_purpose = %s AND t.created_at >= %s
                GROUP BY tm.code
                """,
                (body.purpose, history_since),
            ).fetchall()
        hist_total = sum(r["c"] for r in history)
        hist_count = {r["top_mode_id"]: r["c"] for r in history}

        # ---------- Per-mode criterion vectors ----------
        origin_pt = (origin.lat, origin.lng)
        bus_stops = [l for l in locations if l["location_type"] == "bus_stop"]
        alternatives = []
        metas = {}
        for m in modes:
            mid = m["code"]
            travel_time_min = (route["distanceKm"] / m["avg_speed_kmh"]) * 60 + m["avg_wait_min"]
            cost_vnd = float(m["base_fare"]) + float(m["cost_per_km"]) * route["distanceKm"]
            co2_kg = (m["co2_per_km_g"] * route["distanceKm"]) / 1000

            status = compliance[mid]["status"]
            lez_score = 1.0 if status == "compliant" else (0.5 if status == "conditionally_restricted" else 0.0)

            accessibility = m["accessibility_score"]
            if mid == "bus":
                d = geo.nearest_distance_km(origin_pt, bus_stops)
                accessibility = clamp01(m["accessibility_score"] * 0.6 + 0.4 * (1 - min(d, 2) / 2))

            purpose_mod = PURPOSE_CONVENIENCE.get(body.purpose, {}).get(mid, 0)
            convenience = clamp01(m["convenience_score"] + purpose_mod)

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
        base_weights = {w["code"]: float(w["default_weight"]) for w in weight_rows}
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

        # ---------- Persist the full DB FINAL chain (one transaction) ----------
        trip_id = None
        if body.saveTrip is not False:
            with db.tx() as conn:
                study_id = db.study_area_id(conn)
                mode_ids = {m["code"]: int(m["transportation_mode_id"]) for m in modes}
                vt_id = db.vehicle_type_id_by_mode_code(conn, body.vehicleId)
                origin_district = guess_district(origin.name)
                origin_region = db.region_id_by_name(conn, origin_district)
                dest_district = guess_district(destination.name)
                dest_region = db.region_id_by_name(conn, dest_district)

                preferences = body.preferences.model_dump() if body.preferences else {}
                recs = recommendations
                top_rec = recs[0] if recs else None

                trip_id = int(
                    conn.execute(
                        """
                        INSERT INTO trip.trips
                            (study_area_id, origin_name, destination_name, origin, destination,
                             origin_lat, origin_lng, dest_lat, dest_lng,
                             origin_region_id, destination_region_id, origin_district,
                             vehicle_type_id, switched, top_mode_id, top_score,
                             travel_time, departure_hour, trip_purpose, preferences,
                             distance_km, duration_min, lez_affected,
                             avg_cost_vnd, avg_time_min)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        RETURNING trip_id
                        """,
                        (
                            study_id,
                            origin.name or f"{origin.lat:.4f}, {origin.lng:.4f}",
                            destination.name or f"{destination.lat:.4f}, {destination.lng:.4f}",
                            json.dumps({"type": "Point", "coordinates": [origin.lng, origin.lat]}),
                            json.dumps({"type": "Point", "coordinates": [destination.lng, destination.lat]}),
                            origin.lat, origin.lng, destination.lat, destination.lng,
                            origin_region, dest_region, origin_district,
                            vt_id, False,
                            mode_ids.get(top_rec["modeId"]) if top_rec else mode_ids.get(body.vehicleId),
                            top_rec["score"] if top_rec else 0.0,
                            departure, departure.hour,
                            body.purpose, json.dumps(preferences),
                            route["distanceKm"], route["durationMin"],
                            len(affected_zone_ids) > 0,
                            (sum(r["costVnd"] for r in recs) / len(recs)) if recs else 0.0,
                            (sum(r["travelTimeMin"] for r in recs) / len(recs)) if recs else 0.0,
                        ),
                    ).fetchone()["trip_id"]
                )

                # governance pack: gán phường/xã (bộ máy 2025) cho điểm đi/đến —
                # best-effort, không bao giờ làm hỏng phân tích chính.
                try:
                    from ..services import wardimport as _wi

                    _ow = _wi.ward_of_point(origin.lat, origin.lng)
                    _dw = _wi.ward_of_point(destination.lat, destination.lng)
                    if _ow or _dw:
                        conn.execute(
                            """
                            UPDATE trip.trips
                            SET origin_ward_code = %s, destination_ward_code = %s
                            WHERE trip_id = %s
                            """,
                            (_ow["code"] if _ow else None, _dw["code"] if _dw else None, trip_id),
                        )
                except Exception:  # noqa: BLE001,S110
                    pass

                route_id = int(
                    conn.execute(
                        """
                        INSERT INTO trip.trip_routes
                            (trip_id, routing_profile, route_index, provider,
                             distance_m, duration_sec, geometry)
                        VALUES (%s, 'driving', 0, %s, %s, %s, %s)
                        RETURNING route_id
                        """,
                        (
                            trip_id,
                            "osrm" if route["source"] == "osrm" else "estimate",
                            round(route["distanceKm"] * 1000, 2),
                            round(route["durationMin"] * 60),
                            json.dumps(
                                {
                                    "type": "LineString",
                                    "coordinates": [[c[1], c[0]] for c in route["coords"]],
                                }
                            ),
                        ),
                    ).fetchone()["route_id"]
                )

                chosen_vt = vt_id
                for zc in zone_checks:
                    applicable_rule = None
                    for r in compliance.get(body.vehicleId, {}).get("rules", []):
                        if r["zoneId"] == zc["zoneId"]:
                            applicable_rule = r["id"]
                            break
                    conn.execute(
                        """
                        INSERT INTO trip.trip_lez_analyses
                            (route_id, lez_zone_id, vehicle_type_id, applicable_lez_rule_id,
                             intersects, intersection_length_m, intersection_percentage,
                             route_lez_status, compliance_status, compliance_reason)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            route_id, zc["zoneId"], chosen_vt, applicable_rule,
                            zc["status"] != "outside",
                            round(zc["insideRatio"] * route["distanceKm"] * 1000, 2),
                            round(zc["insideRatio"] * 100, 2),
                            zc["status"],
                            compliance.get(body.vehicleId, {}).get("status"),
                            compliance.get(body.vehicleId, {}).get("reason"),
                        ),
                    )

                run_id = int(
                    conn.execute(
                        """
                        INSERT INTO decision.recommendation_runs
                            (trip_id, algorithm, status, duration_ms, completed_at)
                        VALUES (%s, 'TOPSIS', 'completed', %s, now())
                        RETURNING recommendation_run_id
                        """,
                        (trip_id, int((_time.perf_counter() - t0) * 1000)),
                    ).fetchone()["recommendation_run_id"]
                )

                criteria_ids = {
                    r["code"]: int(r["criteria_id"])
                    for r in conn.execute(
                        "SELECT criteria_id, code FROM decision.recommendation_criteria"
                    ).fetchall()
                }
                score_rows = []
                for s in scored:
                    alt = next(a for a in alternatives if a["id"] == s["id"])
                    for c in CRITERIA:
                        score_rows.append(
                            (
                                run_id,
                                mode_ids.get(s["id"]),
                                criteria_ids.get(c),
                                alt["raw"][c],
                                s["normalized"][c],
                                weights_used[c],
                                s["contributions"][c],
                                s["score"],
                                s["rank"],
                            )
                        )
                with conn.cursor() as cur:
                    cur.executemany(
                        """
                        INSERT INTO decision.recommendation_scores
                            (recommendation_run_id, transportation_mode_id, criteria_id,
                             raw_value, normalized_value, weight, weighted_score,
                             final_score, rank_position)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        """,
                        score_rows,
                    )

                # impact assessment: current vehicle vs the top recommendation
                alt_mode = top_rec["modeId"] if top_rec else body.vehicleId
                if alt_mode != body.vehicleId:
                    cur_score = next(
                        (s["score"] for s in scored if s["id"] == body.vehicleId), 0.0
                    )
                    conn.execute(
                        """
                        INSERT INTO decision.impact_assessments
                            (trip_id, recommendation_run_id,
                             current_transportation_mode_id, alternative_transportation_mode_id,
                             current_time_min, alternative_time_min,
                             current_cost, alternative_cost,
                             current_compliance_status, alternative_compliance_status,
                             current_score, alternative_score,
                             time_difference, cost_difference, score_difference)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        """,
                        (
                            trip_id, run_id,
                            mode_ids.get(body.vehicleId), mode_ids.get(alt_mode),
                            metas[body.vehicleId]["travelTimeMin"], metas[alt_mode]["travelTimeMin"],
                            metas[body.vehicleId]["costVnd"], metas[alt_mode]["costVnd"],
                            compliance[body.vehicleId]["status"], compliance[alt_mode]["status"],
                            cur_score, top_rec["score"] if top_rec else 0.0,
                            metas[alt_mode]["travelTimeMin"] - metas[body.vehicleId]["travelTimeMin"],
                            metas[alt_mode]["costVnd"] - metas[body.vehicleId]["costVnd"],
                            (top_rec["score"] if top_rec else 0.0) - cur_score,
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
    try:
        tid = int(trip_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="Không tìm thấy chuyến đi.")
    with db.get_conn() as conn:
        trip = conn.execute(
            """
            SELECT t.trip_id, vt.code AS vehicle_code
            FROM trip.trips t
            JOIN policy.vehicle_types vt ON vt.vehicle_type_id = t.vehicle_type_id
            WHERE t.trip_id = %s
            """,
            (tid,),
        ).fetchone()
        if not trip:
            raise HTTPException(status_code=404, detail="Không tìm thấy chuyến đi.")
        switched = body.chosenModeId is not None and body.chosenModeId != trip["vehicle_code"]
        chosen_vt = (
            db.vehicle_type_id_by_mode_code(conn, body.chosenModeId)
            if body.chosenModeId
            else None
        )
        conn.execute(
            "UPDATE trip.trips SET chosen_vehicle_type_id = %s, switched = %s WHERE trip_id = %s",
            (chosen_vt, switched, tid),
        )
    return {"ok": True, "trip": {"id": tid, "switched": switched}}


# ---------------------------------------------------------------------------
# Task 99 — migrated từ routers/gov_ops.py (router gov đã xoá theo duyệt user
# 28/10). FE feedback-widget.tsx gọi endpoint này; path + response không đổi.
# ---------------------------------------------------------------------------

FEEDBACK_REASONS = ("cost", "time", "safety", "weather", "infrastructure", "habit", "other")


class FeedbackBody(BaseModel):
    userKey: Optional[str] = Field(default=None, max_length=64)
    tripId: Optional[int] = None
    topModeId: Optional[int] = None
    reason: str
    detail: Optional[str] = Field(default=None, max_length=1000)


@router.post("/api/trip/feedback")
def submit_feedback(body: FeedbackBody):
    """(Public) Ghi nhận phản hồi 'vì sao không chọn phương tiện được đề xuất'."""
    reason = (body.reason or "").strip().lower()
    if reason not in FEEDBACK_REASONS:
        raise HTTPException(status_code=400, detail="Lý do không hợp lệ.")
    try:
        with db.get_conn() as conn:
            conn.execute(
                """
                INSERT INTO decision.user_feedback (user_key, trip_id, top_mode_id, reason, detail)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (body.userKey or None, body.tripId, body.topModeId, reason, body.detail or None),
            )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Ghi nhận phản hồi thất bại. Vui lòng kiểm tra lại tripId/topModeId.",
        )
    return {"ok": True}
