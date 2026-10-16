"""API v2 — pipeline chuyến đi trên schema v2 (7 nhóm).

Khác v1: mọi thứ LƯU VẾT vào DB (trips/trip_routes/trip_lez_analysis/recommendation_runs
/scores/impact_assessments), tuân thủ tính riêng tư của Guest (tọa độ làm tròn lưới 0.001
~ 100m theo comment của schema), compliance đánh giá bằng restriction_type + emission_level,
trọ trọng số theo ưu tiên của Guest. V1 (/api/trip/analyze) vẫn chạy song song.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import db_v2
from app.services import external
from app.services.compliance_v2 import evaluate_vehicle
from app.services.recommendation_v2 import compute_and_persist

router = APIRouter(prefix="/api/v2", tags=["trip-v2"])

GRID = 0.001  # ~100m — nguyên tắc riêng tư trong comment của trip.trips


class Point(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class AnalyzeV2Request(BaseModel):
    origin: Point
    destination: Point
    vehicleTypeCode: str  # code trong policy.vehicle_types, vd 'motorcycle_petrol_euro3'
    purpose: str = Field(pattern="^(work|school|shopping|leisure|other)$")
    travelTime: str | None = None  # ISO 8601
    preferences: dict | None = None  # {fastest, cheapest, eco, comfort} 0-100


class ChoiceV2Request(BaseModel):
    chosenVehicleTypeCode: str | None = None  # NULL = không chọn gì


@router.get("/vehicle-types")
def list_vehicle_types_public():
    """Danh mục loại xe ACTIVE cho Guest chọn (public — không cần đăng nhập)."""
    with db_v2.db.get_conn() as conn:
        rows = conn.execute(
            """SELECT vt.code, vt.name, vt.category, vt.fuel_type,
                      vt.emission_standard, vt.emission_level,
                      m.code AS mode_code, m.name AS mode_name
               FROM policy.vehicle_types vt
               JOIN transportation.transportation_modes m
                 ON m.transportation_mode_id = vt.transportation_mode_id
               WHERE vt.status = 'ACTIVE' AND m.is_active
               ORDER BY m.transportation_mode_id"""
        ).fetchall()
    return {"vehicleTypes": [dict(r) for r in rows]}


@router.post("/trip/analyze")
def analyze(body: AnalyzeV2Request):
    travel_time = _parse_time(body.travelTime)
    with db_v2.db.get_conn() as conn:
        area = conn.execute(
            "SELECT study_area_id FROM core.study_areas WHERE code = 'HN' AND status = 'ACTIVE'"
        ).fetchone()
        if area is None:
            raise HTTPException(400, detail="Chưa cấu hình khu vực nghiên cứu.")
        area_id = area["study_area_id"]

        vtype = conn.execute(
            "SELECT * FROM policy.vehicle_types WHERE code = %s AND status = 'ACTIVE'",
            (body.vehicleTypeCode,),
        ).fetchone()
        if vtype is None:
            raise HTTPException(400, detail="Loại phương tiện không hợp lệ hoặc đã bị tắt.")

        # 1) Lưu chuyến đi (ẩn danh: tọa độ làm tròn lưới ~100m; vùng xã/phường tra bằng PostGIS)
        trip = conn.execute(
            """
            INSERT INTO trip.trips (study_area_id, origin, destination,
                origin_region_id, destination_region_id, vehicle_type_id,
                travel_time, trip_purpose, preferences)
            VALUES (%s,
                ST_SnapToGrid(ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s),
                ST_SnapToGrid(ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s),
                (SELECT region_id FROM gis.administrative_regions
                  WHERE study_area_id = %s AND ST_Contains(geometry,
                        ST_SetSRID(ST_MakePoint(%s, %s), 4326)) LIMIT 1),
                (SELECT region_id FROM gis.administrative_regions
                  WHERE study_area_id = %s AND ST_Contains(geometry,
                        ST_SetSRID(ST_MakePoint(%s, %s), 4326)) LIMIT 1),
                %s, %s, %s, %s)
            RETURNING trip_id
            """,
            (area_id, body.origin.lng, body.origin.lat, GRID,
             body.destination.lng, body.destination.lat, GRID,
             area_id, body.origin.lng, body.origin.lat,
             area_id, body.destination.lng, body.destination.lat,
             vtype["vehicle_type_id"], travel_time, body.purpose,
             json.dumps(body.preferences) if body.preferences else None),
        ).fetchone()
        trip_id = trip["trip_id"]

        # 2) Route theo từng routing_profile cần thiết (car/bike/foot)
        profiles = {
            r["routing_profile"]
            for r in conn.execute(
                "SELECT DISTINCT routing_profile FROM transportation.transportation_modes "
                "WHERE is_active"
            ).fetchall()
        }
        profile_map = {"car": "driving", "bike": "cycling", "foot": "walking"}
        route_by_profile: dict[str, dict] = {}
        duration_by_profile: dict[str, int] = {}
        distance_m = 0.0
        for p in profiles:
            r = external.get_route(
                (body.origin.lat, body.origin.lng),
                (body.destination.lat, body.destination.lng),
                profile_map.get(p, "driving"),
            )
            route_by_profile[p] = r
            duration_by_profile[p] = int(r["durationMin"] * 60)
            if p == "car":
                distance_m = r["distanceKm"] * 1000
                main_route = r

        main_geom = json.dumps({
            "type": "LineString",
            "coordinates": [[lng, lat] for lat, lng in main_route["coords"]],
        })
        for p, r in route_by_profile.items():
            geom = json.dumps({
                "type": "LineString",
                "coordinates": [[lng, lat] for lat, lng in r["coords"]],
            })
            conn.execute(
                """INSERT INTO trip.trip_routes (trip_id, routing_profile, route_index,
                       provider, distance_m, duration_sec, geometry)
                   VALUES (%s, %s, 0, %s, %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))""",
                (trip_id, p, "OSRM" if r["source"] == "osrm" else "ESTIMATED",
                 r["distanceKm"] * 1000, int(r["durationMin"] * 60), geom),
            )

        # 3) Phân tích giao tuyến × LEZ (PostGIS) — lưu kết quả vào trip_lez_analysis
        zones = conn.execute(
            """SELECT lez_zone_id, name FROM policy.lez_zones
               WHERE study_area_id = %s AND status = 'ACTIVE'
                 AND (effective_from IS NULL OR effective_from <= %s::date)
                 AND (effective_to IS NULL OR effective_to >= %s::date)""",
            (area_id, travel_time.date().isoformat(), travel_time.date().isoformat()),
        ).fetchall()
        car_route_id = conn.execute(
            "SELECT route_id FROM trip.trip_routes WHERE trip_id = %s AND routing_profile = 'car'",
            (trip_id,),
        ).fetchone()["route_id"]
        lez_out = []
        for z in zones:
            row = conn.execute(
                """
                SELECT ST_Intersects(r.geometry, z.geometry) AS intersects,
                       COALESCE(ST_Length(ST_Intersection(r.geometry, z.geometry)::geography), 0) AS len_m,
                       COALESCE(ST_Length(ST_Intersection(r.geometry, z.geometry)::geography)
                                / NULLIF(ST_Length(r.geometry::geography), 0) * 100, 0) AS pct
                FROM trip.trip_routes r, policy.lez_zones z
                WHERE r.route_id = %s AND z.lez_zone_id = %s
                """,
                (car_route_id, z["lez_zone_id"]),
            ).fetchone()
            intersects = bool(row["intersects"])
            pct = round(float(row["pct"] or 0), 2)
            status = "OUTSIDE" if pct == 0 else ("INSIDE" if pct >= 95 else "PARTIAL")
            zone_comp = evaluate_vehicle(conn, [z["lez_zone_id"]], travel_time,
                                         vtype["vehicle_type_id"])
            conn.execute(
                """INSERT INTO trip.trip_lez_analysis (route_id, lez_zone_id, vehicle_type_id,
                       intersects, intersection_length_m, intersection_percentage,
                       route_lez_status, compliance_status, compliance_reason)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (car_route_id, z["lez_zone_id"], vtype["vehicle_type_id"], intersects,
                 float(row["len_m"] or 0), pct, status,
                 zone_comp["status"], zone_comp["reason"]),
            )
            if intersects:
                lez_out.append({"zoneId": z["lez_zone_id"], "name": z["name"],
                                "insidePct": pct, "status": status})
        crossed_zone_ids = [z["zoneId"] for z in lez_out]

        # 4) Compliance của phương tiện hiện tại (FR-13/14/15)
        current_comp = evaluate_vehicle(conn, crossed_zone_ids, travel_time,
                                        vtype["vehicle_type_id"])

        # 5) TOPSIS + persist (runs/scores/impact)
        ranked = compute_and_persist(
            conn, trip_id=trip_id, distance_m=distance_m,
            duration_sec_by_profile=duration_by_profile, travel_time=travel_time,
            current_vehicle_type_id=vtype["vehicle_type_id"], preferences=body.preferences,
        )

        # 6) Compliance từng mode trong kết quả đã có sẵn từ compute_and_persist
        return {
            "tripId": trip_id,
            "vehicleType": {"code": vtype["code"], "name": vtype["name"]},
            "route": {"distanceKm": round(main_route["distanceKm"], 3),
                      "durationMin": round(main_route["durationMin"], 1),
                      "source": main_route["source"]},
            "lez": lez_out,
            "currentCompliance": {"status": current_comp["status"],
                                  "reason": current_comp["reason"]},
            "recommendations": [
                {"modeId": r["id"], "modeName": r["name"],
                 "vehicleTypeCode": _vtype_code(conn, r["vehicleTypeId"]),
                 "score": round(r["score"], 4), "rank": r["rank"],
                 "contributions": r["contributions"], "normalized": r["normalized"],
                 "travelTimeMin": round(r["travelTimeMin"], 1),
                 "costVnd": round(r["costVnd"]),
                 "compliance": {"status": r["compliance"]["status"],
                                "reason": r["compliance"]["reason"]}}
                for r in ranked
            ],
        }


def _vtype_code(conn, vtype_id: int | None) -> str | None:
    if vtype_id is None:
        return None
    r = conn.execute(
        "SELECT code FROM policy.vehicle_types WHERE vehicle_type_id = %s", (vtype_id,)
    ).fetchone()
    return r["code"] if r else None


@router.post("/trip/{trip_id}/choice")
def record_choice(trip_id: int, body: ChoiceV2Request):
    with db_v2.db.get_conn() as conn:
        trip = conn.execute(
            """SELECT t.vehicle_type_id, vt.transportation_mode_id AS current_mode
               FROM trip.trips t JOIN policy.vehicle_types vt
                 ON vt.vehicle_type_id = t.vehicle_type_id
               WHERE t.trip_id = %s""",
            (trip_id,),
        ).fetchone()
        if trip is None:
            raise HTTPException(404, detail="Không tìm thấy chuyến đi.")
        if body.chosenVehicleTypeCode is None:
            conn.execute(
                "UPDATE trip.trips SET chosen_vehicle_type_id = NULL, switched = FALSE "
                "WHERE trip_id = %s",
                (trip_id,),
            )
            return {"ok": True, "trip": {"id": trip_id, "switched": False}}
        chosen = conn.execute(
            """SELECT vehicle_type_id, transportation_mode_id AS mode
               FROM policy.vehicle_types WHERE code = %s AND status = 'ACTIVE'""",
            (body.chosenVehicleTypeCode,),
        ).fetchone()
        if chosen is None:
            raise HTTPException(400, detail="Loại phương tiện được chọn không hợp lệ.")
        switched = chosen["mode"] != trip["current_mode"]
        conn.execute(
            """UPDATE trip.trips
               SET chosen_vehicle_type_id = %s, switched = %s WHERE trip_id = %s""",
            (chosen["vehicle_type_id"], switched, trip_id),
        )
        return {"ok": True,
                "trip": {"id": trip_id, "switched": switched,
                         "chosenVehicleTypeCode": body.chosenVehicleTypeCode}}


def _parse_time(raw: str | None) -> datetime:
    if not raw:
        return datetime.now(timezone.utc)
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            # datetime-local từ frontend là giờ Việt Nam — gắn +07:00 thay vì UTC
            dt = dt.replace(tzinfo=timezone(timedelta(hours=7)))
        return dt
    except ValueError:
        raise HTTPException(400, detail="Thời gian khởi hành không hợp lệ.")
