"""Seed cho schema v2 — chạy khi boot (idempotent), thay cho seed.py v1.

Task 51 (refactor DB v2): đảm bảo DB v2 có đủ dữ liệu demo:
  1. Admin mặc định (bcrypt, core.admins) — admin / admin123
  2. Study area HN (nếu thiếu)
  3. Import 126 phường/xã từ GeoJSON (gis.administrative_regions) nếu rỗng
  4. Import 2.400 dòng khảo sát Kaggle (survey.vehicle_survey_responses)
  5. 150 chuyến đi DEMO (trip.trips + trip_routes + recommendation_runs +
     recommendation_scores + trip_lez_analysis) — sinh bằng CÔNG THỨC THẬT
     của pipeline (tốc độ/chi phí/CO₂ theo bảng mode, TOPSIS với trọng số
     admin) trên tọa độ địa điểm thật; KHÔNG bịa số — chỉ dữ liệu đầu vào
     là ngẫu nhiên (như seed v1). Chỉ chạy khi trip.trips rỗng.
"""
import json
import random
import uuid
from datetime import datetime, timedelta, timezone

from . import auth, config, constants, db, v2map
from .services import geo, mcdm, trend

DEMO_TRIPS = 150


def ensure_study_area() -> None:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT study_area_id FROM core.study_areas WHERE code = 'HN'"
        ).fetchone()
        if not row:
            conn.execute(
                """
                INSERT INTO core.study_areas (code, name, area_type, description, status)
                VALUES ('HN', 'Hà Nội', 'CITY',
                        'Khu vực nghiên cứu RideShift (C1SE.48)', 'ACTIVE')
                """
            )


def load_mode_rows() -> list:
    with db.get_conn() as conn:
        return conn.execute(
            """
            SELECT m.*, vt.emission_level
            FROM transportation.transportation_modes m
            LEFT JOIN policy.vehicle_types vt
              ON vt.transportation_mode_id = m.transportation_mode_id AND vt.is_default
            ORDER BY m.transportation_mode_id
            """
        ).fetchall()


def load_zones_rings() -> list:
    """[{id, name, polygon:[[lat,lng],...]}] từ policy.lez_zones (PostGIS)."""
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT lez_zone_id, name, status,
                   ST_AsGeoJSON(geometry) AS geojson
            FROM policy.lez_zones WHERE status = 'ACTIVE'
            """
        ).fetchall()
    from .dto import ring_from_geojson

    return [
        {"id": r["lez_zone_id"], "name": r["name"], "polygon": ring_from_geojson(r["geojson"])}
        for r in rows
    ]


def load_weights_100() -> dict:
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT code, default_weight FROM decision.recommendation_criteria"
        ).fetchall()
    return {
        v2map.CRIT_V2_TO_V1.get(r["code"], r["code"].lower()): float(r["default_weight"] or 0) * 100
        for r in rows
    }


def find_region_id(conn, lat: float, lng: float):
    row = conn.execute(
        """
        SELECT region_id FROM gis.administrative_regions
        WHERE status = 'ACTIVE'
          AND ST_Contains(geometry, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
        ORDER BY ST_Area(geometry) ASC
        LIMIT 1
        """,
        (lng, lat),
    ).fetchone()
    return int(row["region_id"]) if row else None


def evaluate_compliance(mode_code: str, rules_for_zone: list, dep_minutes: int, dep_day_iso: int) -> tuple[str, str]:
    """Trả (trạng thái v1, lý do) — mirror logic compliance của trip.py."""
    relevant = [r for r in rules_for_zone if r["mode_code"] == mode_code]
    if not relevant:
        return "compliant", "Không có quy định hạn chế nào của vùng bạn đi qua áp dụng cho phương tiện này."
    r0 = relevant[0]
    day_ok = dep_day_iso in (r0["days"] or [])
    start, end = v2map.parse_hhmm(r0["start"]), v2map.parse_hhmm(r0["end"])
    if start <= end:
        time_ok = start <= dep_minutes <= end
    else:
        time_ok = dep_minutes >= start or dep_minutes <= end
    if not (day_ok and time_ok):
        return "compliant", (
            f"Quy định hạn chế chỉ áp dụng trong khung giờ được cấu hình "
            f"(ví dụ {v2map.hhmm(r0['start'])}–{v2map.hhmm(r0['end'])}, "
            f"các ngày {v2map.days_iso_to_v1(r0['days'])}). "
            "Thời gian khởi hành của bạn nằm ngoài khung giờ hạn chế."
        )
    if any(r["type"] == "PROHIBITED" for r in relevant):
        return "not_permitted", f"Không được phép vào {r0['zone_name']} vào thời điểm khởi hành đã chọn."
    return "conditionally_restricted", (
        r0["reason"] or "Quy định hạn chế có điều kiện áp dụng trong vùng phát thải thấp."
    )


def load_rule_rows() -> list:
    """Rule × mode đang ACTIVE (chỉ non-ALLOWED) — cho đánh giá compliance."""
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT lr.lez_rule_id, lr.lez_zone_id, lz.name AS zone_name,
                   lr.start_time::text AS start_t, lr.end_time::text AS end_t,
                   lr.days_of_week, lr.status,
                   vr.restriction_type, vr.restriction_reason,
                   tm.code AS mode_code
            FROM policy.lez_rules lr
            JOIN policy.lez_zones lz ON lz.lez_zone_id = lr.lez_zone_id
            JOIN policy.vehicle_restrictions vr ON vr.lez_rule_id = lr.lez_rule_id
            JOIN policy.vehicle_types vt ON vt.vehicle_type_id = vr.vehicle_type_id
            JOIN transportation.transportation_modes tm
              ON tm.transportation_mode_id = vt.transportation_mode_id
            WHERE lr.status = 'ACTIVE'
              AND vr.restriction_type IN ('PROHIBITED', 'CONDITIONAL')
            """
        ).fetchall()
    return [
        {
            "lez_rule_id": r["lez_rule_id"],
            "zone_id": r["lez_zone_id"],
            "zone_name": r["zone_name"],
            "start": v2map.hhmm(r["start_t"]),
            "end": v2map.hhmm(r["end_t"]),
            "days": list(r["days_of_week"] or []),
            "type": r["restriction_type"],
            "reason": r["restriction_reason"],
            "mode_code": r["mode_code"],
        }
        for r in rows
    ]


def default_vehicle_type_map() -> dict:
    """mode_code -> default vehicle_type_id."""
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT tm.code AS mode_code, vt.vehicle_type_id
            FROM policy.vehicle_types vt
            JOIN transportation.transportation_modes tm
              ON tm.transportation_mode_id = vt.transportation_mode_id
            WHERE vt.is_default AND vt.status = 'ACTIVE'
            """
        ).fetchall()
    return {r["mode_code"]: int(r["vehicle_type_id"]) for r in rows}


def seed_demo_trips() -> int:
    """Sinh chuyến đi DEMO qua công thức thật (bổ sung khi còn ít dữ liệu)."""
    with db.get_conn() as conn:
        n = conn.execute("SELECT count(*) AS c FROM trip.trips").fetchone()["c"]
    if n >= 20:
        return 0

    rng = random.Random(48)
    modes = [m for m in load_mode_rows() if m["is_active"]]
    if not modes:
        return 0
    mode_codes = [m["code"] for m in modes]
    vt_map = default_vehicle_type_map()

    with db.get_conn() as conn:
        loc_rows = conn.execute(
            """
            SELECT name, ST_Y(geometry) AS lat, ST_X(geometry) AS lng
            FROM transportation.transportation_locations WHERE status = 'ACTIVE'
            """
        ).fetchall()
    places = [(float(r["lat"]), float(r["lng"])) for r in loc_rows] or [(21.0287, 105.8524)]
    weights = load_weights_100() or {
        "travelTime": 25, "cost": 20, "lezCompliance": 20, "accessibility": 10,
        "convenience": 10, "environment": 10, "trend": 5,
    }
    zones = load_zones_rings()
    rules = load_rule_rows()
    trend_map = trend.latest_trend_map()
    purposes = ["work", "school", "shopping", "leisure", "other"]
    now = datetime.now(timezone.utc)
    written = 0

    for _ in range(DEMO_TRIPS):
        origin = rng.choice(places)
        dest = rng.choice(places)
        if origin == dest:
            continue
        departure = now - timedelta(days=rng.randint(0, 29), hours=rng.randint(0, 14),
                                    minutes=rng.randint(0, 59))
        purpose = rng.choice(purposes)
        vehicle = rng.choice(mode_codes)

        coords = external_synthetic(origin, dest)
        distance_km = geo.route_length_km(coords)
        if distance_km < 0.4:
            continue
        zone_checks = geo.analyze_route_vs_zones(
            coords, [{"id": z["id"], "name": z["name"], "polygon": z["polygon"]} for z in zones]
        )
        affected = [z for z in zone_checks if z["status"] != "outside"]
        dep_minutes = departure.hour * 60 + departure.minute
        dep_day_iso = departure.isoweekday()

        # compliance per mode (mirror trip.py)
        compliance = {}
        for code in mode_codes:
            if not affected:
                compliance[code] = "compliant"
            else:
                status, _ = evaluate_compliance(code, rules, dep_minutes, dep_day_iso)
                compliance[code] = status

        alternatives, metas = [], {}
        for m in modes:
            code = m["code"]
            speed = v2map.mode_avg_speed(m)
            co2 = v2map.mode_co2_per_km(code, m.get("emission_level"))
            wait = float(m["avg_wait_min"] or 0)
            travel_time = (distance_km / speed) * 60 + wait
            cost = float(m["base_fare"] or 0) + float(m["cost_per_km"] or 0) * distance_km
            lez_score = 1.0 if compliance[code] == "compliant" else (
                0.5 if compliance[code] == "conditionally_restricted" else 0.0
            )
            accessibility = float(m["accessibility_score"] or 3) / 5.0
            purpose_mod = constants.PURPOSE_CONVENIENCE.get(purpose, {}).get(code, 0)
            convenience = constants.clamp01(float(m["convenience_score"] or 3) / 5.0 + purpose_mod)
            t_adj = travel_time
            if code == "walking" and distance_km > 5:
                t_adj += (distance_km - 5) * 30
            if code == "bicycle" and distance_km > 12:
                t_adj += (distance_km - 12) * 8
            alternatives.append({
                "id": code,
                "name": m["name"],
                "raw": {
                    "travelTime": t_adj,
                    "cost": cost,
                    "lezCompliance": lez_score,
                    "accessibility": accessibility,
                    "convenience": convenience,
                    "environment": co2,
                    "trend": trend_map.get(code, 0.01),
                },
            })
            metas[code] = {"travelTimeMin": travel_time, "costVnd": cost}

        scored = mcdm.topsis(alternatives, weights)
        if not scored:
            continue
        top = scored[0]

        with db.tx() as conn:
            cur = conn.execute(
                """
                INSERT INTO trip.trips (study_area_id, origin, destination,
                    origin_region_id, destination_region_id, vehicle_type_id,
                    switched, travel_time, trip_purpose, preferences)
                VALUES (1,
                        ST_SnapToGrid(ST_SetSRID(ST_MakePoint(%s, %s), 4326), 0.001),
                        ST_SnapToGrid(ST_SetSRID(ST_MakePoint(%s, %s), 4326), 0.001),
                        (SELECT region_id FROM gis.administrative_regions
                          WHERE ST_Contains(geometry, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                          ORDER BY ST_Area(geometry) ASC LIMIT 1),
                        (SELECT region_id FROM gis.administrative_regions
                          WHERE ST_Contains(geometry, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                          ORDER BY ST_Area(geometry) ASC LIMIT 1),
                        %s, %s, %s, %s, '{"demo": true}'::jsonb)
                RETURNING trip_id
                """,
                (origin[1], origin[0], dest[1], dest[0],
                 origin[1], origin[0], dest[1], dest[0],
                 vt_map.get(vehicle), False, departure, purpose),
            )
            trip_id = int(cur.fetchone()["trip_id"])

            ring = [[p[1], p[0]] for p in coords]
            ring.append(ring[0])
            route_geojson = json.dumps({"type": "LineString", "coordinates": ring})
            cur = conn.execute(
                """
                INSERT INTO trip.trip_routes (trip_id, routing_profile, route_index,
                    provider, distance_m, duration_sec, geometry)
                VALUES (%s, 'car', 0, 'DEMO_SYNTHETIC', %s, %s,
                        ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
                RETURNING route_id
                """,
                (trip_id, round(distance_km * 1000, 2), int(metas[top["id"]]["travelTimeMin"] * 60),
                 route_geojson),
            )
            route_id = int(cur.fetchone()["route_id"])

            cur = conn.execute(
                """
                INSERT INTO decision.recommendation_runs (trip_id, algorithm, status, duration_ms)
                VALUES (%s, 'TOPSIS', 'COMPLETED', %s)
                RETURNING recommendation_run_id
                """,
                (trip_id, rng.randint(2, 9)),
            )
            run_id = int(cur.fetchone()["recommendation_run_id"])

            for s in scored:
                alt = next(a for a in alternatives if a["id"] == s["id"])
                for crit_v1, raw_v in alt["raw"].items():
                    conn.execute(
                        """
                        INSERT INTO decision.recommendation_scores
                            (recommendation_run_id, transportation_mode_id, criteria_id,
                             raw_value, normalized_value, weight, weighted_score,
                             final_score, rank_position)
                        VALUES (%s, (SELECT transportation_mode_id
                                       FROM transportation.transportation_modes WHERE code = %s),
                                (SELECT criteria_id FROM decision.recommendation_criteria
                                  WHERE code = %s),
                                %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            run_id, s["id"], v2map.CRIT_V1_TO_V2[crit_v1],
                            round(float(raw_v), 6), round(float(s["normalized"][crit_v1]), 6),
                            round(weights.get(crit_v1, 0) / 100.0, 6),
                            round(float(s["contributions"][crit_v1]), 6),
                            round(float(s["score"]), 6), s["rank"],
                        ),
                    )

            for zc in zone_checks:
                status_map = {"outside": "OUTSIDE", "partial": "PARTIAL", "within": "INSIDE"}
                for code, vt_id in vt_map.items():
                    comp = compliance.get(code, "compliant")
                    comp_map = {"compliant": "COMPLIANT",
                                "conditionally_restricted": "CONDITIONAL",
                                "not_permitted": "NOT_COMPLIANT"}
                    conn.execute(
                        """
                        INSERT INTO trip.trip_lez_analysis (route_id, lez_zone_id,
                            vehicle_type_id, intersects, intersection_percentage,
                            route_lez_status, compliance_status)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (route_id, lez_zone_id, vehicle_type_id) DO NOTHING
                        """,
                        (
                            route_id, zc["zoneId"], vt_id,
                            zc["status"] != "outside",
                            round(float(zc["insideRatio"]) * 100, 2),
                            status_map[zc["status"]],
                            comp_map[comp],
                        ),
                    )
        written += 1
    return written


def external_synthetic(a, b):
    from .services import external

    return external.synthetic_route(a, b)


def run() -> None:
    """Full boot-time seed (idempotent)."""
    auth.ensure_default_admin()
    ensure_study_area()

    from .services import geoimport, surveyimport

    geo_report = geoimport.import_admin_regions()
    if geo_report.get("imported"):
        print(f"seed_v2: import {geo_report['imported']} phường/xã từ GeoJSON")
    elif geo_report.get("reason"):
        print(f"seed_v2: CẢNH BÁO GeoJSON — {geo_report['reason']}")

    survey_report = surveyimport.import_survey()
    if survey_report.get("imported"):
        print(f"seed_v2: import {survey_report['imported']} dòng khảo sát Kaggle")

    trend.run_pipeline()

    demo = seed_demo_trips()
    if demo:
        print(f"seed_v2: sinh {demo} chuyến đi DEMO (công thức thật, tọa độ thật)")

    print("Seed v2 completed.")


if __name__ == "__main__":
    db.init_db()
    run()
