"""API quản trị v2 — CRUD trên schema v2 + analytics (US-30..41).

Mọi endpoint (trừ /login) yêu cầu phiên admin (auth_v2.require_admin).
Toàn bộ dữ liệu thao tác nằm ở 7 schema v2; đổi schema này ảnh hưởng
mọi người — đã được nhóm duyệt (rules.md mục 5).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app import auth_v2, db_v2

router = APIRouter(prefix="/api/v2/admin", tags=["admin-v2"])


# ---------------------------------------------------------------- auth

class LoginBody(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response):
    ip = request.client.host if request.client else "unknown"
    token, expires, admin = auth_v2.login(body.email, body.password, ip)
    response.set_cookie(
        auth_v2.COOKIE, token, expires=expires,
        httponly=True, samesite="lax", secure=False,  # secure=True khi có HTTPS
        path="/",
    )
    return {"ok": True, "admin": {"id": admin["admin_id"], "name": admin["full_name"],
                                  "email": admin["email"], "role": admin["role"]}}


@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(auth_v2.COOKIE)
    if token:
        auth_v2.logout(token)
    response.delete_cookie(auth_v2.COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(admin: dict = Depends(auth_v2.require_admin)):
    return {"admin": {"id": admin["admin_id"], "name": admin["full_name"],
                      "email": admin["email"], "role": admin["role"]}}


# ---------------------------------------------------------------- zones (US-30)

class ZoneBody(BaseModel):
    name: str
    description: str | None = None
    coordinates: list[list[float]] = Field(description="[[lat,lng], ...] >= 3 điểm")
    effective_from: str | None = None
    effective_to: str | None = None


def _poly_ewkt(coordinates: list[list[float]]) -> str:
    if len(coordinates) < 3:
        raise HTTPException(400, detail="Vùng LEZ cần ít nhất 3 điểm tọa độ.")
    pts = ", ".join(f"{lng} {lat}" for lat, lng in coordinates)
    first = coordinates[0]
    return f"SRID=4326;MULTIPOLYGON((({pts}, {first[1]} {first[0]})))"


def _zone_out(row) -> dict:
    return {"id": row["lez_zone_id"], "name": row["name"], "description": row["description"],
            "effectiveFrom": str(row["effective_from"]) if row["effective_from"] else None,
            "effectiveTo": str(row["effective_to"]) if row["effective_to"] else None,
            "status": row["status"],
            "geometry": json.loads(row["geojson"]) if row["geojson"] else None}


@router.get("/zones")
def list_zones(admin: dict = Depends(auth_v2.require_admin)):
    with db_v2.db.get_conn() as conn:
        rows = conn.execute(
            """SELECT z.*, ST_AsGeoJSON(z.geometry) AS geojson
               FROM policy.lez_zones z ORDER BY z.lez_zone_id"""
        ).fetchall()
    return {"zones": [_zone_out(r) for r in rows]}


@router.post("/zones")
def create_zone(body: ZoneBody, admin: dict = Depends(auth_v2.require_admin)):
    with db_v2.db.get_conn() as conn:
        area = conn.execute(
            "SELECT study_area_id FROM core.study_areas WHERE code='HN' LIMIT 1"
        ).fetchone()
        row = conn.execute(
            """INSERT INTO policy.lez_zones (study_area_id, name, description,
                   geometry, effective_from, effective_to, status)
               VALUES (%s, %s, %s, ST_GeomFromEWKT(%s), %s, %s, 'ACTIVE')
               RETURNING lez_zone_id""",
            (area["study_area_id"], body.name, body.description, _poly_ewkt(body.coordinates),
             body.effective_from, body.effective_to),
        ).fetchone()
    return {"ok": True, "id": row["lez_zone_id"]}


@router.put("/zones/{zone_id}")
def update_zone(zone_id: int, body: ZoneBody, admin: dict = Depends(auth_v2.require_admin)):
    with db_v2.db.get_conn() as conn:
        n = conn.execute(
            """UPDATE policy.lez_zones SET name=%s, description=%s, geometry=ST_GeomFromEWKT(%s),
                   effective_from=%s, effective_to=%s, updated_at=now()
               WHERE lez_zone_id=%s""",
            (body.name, body.description, _poly_ewkt(body.coordinates),
             body.effective_from, body.effective_to, zone_id),
        ).rowcount
    if not n:
        raise HTTPException(404, detail="Không tìm thấy vùng LEZ.")
    return {"ok": True}


@router.delete("/zones/{zone_id}")
def delete_zone(zone_id: int, admin: dict = Depends(auth_v2.require_admin)):
    with db_v2.db.get_conn() as conn:
        n = conn.execute(
            "DELETE FROM policy.lez_zones WHERE lez_zone_id=%s", (zone_id,)
        ).rowcount
    if not n:
        raise HTTPException(404, detail="Không tìm thấy vùng LEZ.")
    return {"ok": True}  # rules + restrictions bị xóa cascade (thiết kế schema)


# ---------------------------------------------------------------- rules + restrictions (US-31..33)

class RestrictionIn(BaseModel):
    vehicleTypeId: int
    restrictionType: str = Field(pattern="^(ALLOWED|CONDITIONAL|PROHIBITED)$")
    minEmissionLevel: int | None = Field(default=None, ge=0, le=9)
    reason: str | None = None


class RuleBody(BaseModel):
    zoneId: int
    ruleName: str
    description: str | None = None
    startTime: str = "00:00"
    endTime: str = "23:59:59"
    daysOfWeek: list[int] = Field(default=[1, 2, 3, 4, 5, 6, 7])
    effectiveFrom: str | None = None
    effectiveTo: str | None = None
    restrictions: list[RestrictionIn] = []


def _rule_out(conn, rule_id: int) -> dict:
    r = conn.execute("SELECT * FROM policy.lez_rules WHERE lez_rule_id=%s", (rule_id,)).fetchone()
    if r is None:
        return None
    restrictions = conn.execute(
        """SELECT vr.*, vt.code AS vtype_code, vt.name AS vtype_name
           FROM policy.vehicle_restrictions vr
           JOIN policy.vehicle_types vt ON vt.vehicle_type_id = vr.vehicle_type_id
           WHERE vr.lez_rule_id = %s ORDER BY vr.vehicle_restriction_id""",
        (rule_id,),
    ).fetchall()
    return {"id": r["lez_rule_id"], "zoneId": r["lez_zone_id"], "ruleName": r["rule_name"],
            "description": r["description"], "startTime": str(r["start_time"]),
            "endTime": str(r["end_time"]), "daysOfWeek": r["days_of_week"],
            "effectiveFrom": str(r["effective_from"]) if r["effective_from"] else None,
            "effectiveTo": str(r["effective_to"]) if r["effective_to"] else None,
            "status": r["status"],
            "restrictions": [
                {"vehicleTypeId": x["vehicle_type_id"], "vehicleTypeCode": x["vtype_code"],
                 "vehicleTypeName": x["vtype_name"], "restrictionType": x["restriction_type"],
                 "minEmissionLevel": x["min_emission_level"], "reason": x["restriction_reason"]}
                for x in restrictions]}


@router.get("/rules")
def list_rules(zone_id: int | None = None, admin: dict = Depends(auth_v2.require_admin)):
    with db_v2.db.get_conn() as conn:
        if zone_id:
            ids = [r["lez_rule_id"] for r in conn.execute(
                "SELECT lez_rule_id FROM policy.lez_rules WHERE lez_zone_id=%s ORDER BY lez_rule_id",
                (zone_id,)).fetchall()]
        else:
            ids = [r["lez_rule_id"] for r in conn.execute(
                "SELECT lez_rule_id FROM policy.lez_rules ORDER BY lez_rule_id").fetchall()]
        rules = [_rule_out(conn, i) for i in ids]
    return {"rules": rules}


@router.post("/rules")
def create_rule(body: RuleBody, admin: dict = Depends(auth_v2.require_admin)):
    if not body.daysOfWeek:
        raise HTTPException(400, detail="Cần ít nhất một ngày trong tuần.")
    with db_v2.db.get_conn() as conn:
        with conn.transaction():
            row = conn.execute(
                """INSERT INTO policy.lez_rules (lez_zone_id, rule_name, description,
                       start_time, end_time, days_of_week, effective_from, effective_to, status)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'ACTIVE')
                   RETURNING lez_rule_id""",
                (body.zoneId, body.ruleName, body.description, body.startTime, body.endTime,
                 body.daysOfWeek, body.effectiveFrom, body.effectiveTo),
            ).fetchone()
            rid = row["lez_rule_id"]
            for r in body.restrictions:
                conn.execute(
                    """INSERT INTO policy.vehicle_restrictions
                         (lez_rule_id, vehicle_type_id, restriction_type,
                          min_emission_level, restriction_reason)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (rid, r.vehicleTypeId, r.restrictionType, r.minEmissionLevel, r.reason),
                )
    return {"ok": True, "id": rid}


@router.put("/rules/{rule_id}")
def update_rule(rule_id: int, body: RuleBody, admin: dict = Depends(auth_v2.require_admin)):
    with db_v2.db.get_conn() as conn:
        with conn.transaction():
            n = conn.execute(
                """UPDATE policy.lez_rules SET zone_id=%s, rule_name=%s, description=%s,
                       start_time=%s, end_time=%s, days_of_week=%s,
                       effective_from=%s, effective_to=%s, updated_at=now()
                   WHERE lez_rule_id=%s""",
                (body.zoneId, body.ruleName, body.description, body.startTime, body.endTime,
                 body.daysOfWeek, body.effectiveFrom, body.effectiveTo, rule_id),
            ).rowcount
            if not n:
                raise HTTPException(404, detail="Không tìm thấy quy định.")
            conn.execute("DELETE FROM policy.vehicle_restrictions WHERE lez_rule_id=%s", (rule_id,))
            for r in body.restrictions:
                conn.execute(
                    """INSERT INTO policy.vehicle_restrictions
                         (lez_rule_id, vehicle_type_id, restriction_type,
                          min_emission_level, restriction_reason)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (rule_id, r.vehicleTypeId, r.restrictionType, r.minEmissionLevel, r.reason),
                )
    return {"ok": True}


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, admin: dict = Depends(auth_v2.require_admin)):
    with db_v2.db.get_conn() as conn:
        n = conn.execute("DELETE FROM policy.lez_rules WHERE lez_rule_id=%s", (rule_id,)).rowcount
    if not n:
        raise HTTPException(404, detail="Không tìm thấy quy định.")
    return {"ok": True}


# ---------------------------------------------------------------- vehicle types + modes (US-33)

class VehicleTypeBody(BaseModel):
    code: str
    name: str
    category: str
    fuelType: str
    emissionStandard: str | None = None
    emissionLevel: int = Field(ge=0, le=9)
    transportationModeId: int
    isDefault: bool = False


@router.get("/vehicle-types")
def list_vehicle_types(admin: dict = Depends(auth_v2.require_admin)):
    with db_v2.db.get_conn() as conn:
        rows = conn.execute(
            """SELECT vt.*, m.name AS mode_name FROM policy.vehicle_types vt
               JOIN transportation.transportation_modes m
                 ON m.transportation_mode_id = vt.transportation_mode_id
               ORDER BY vt.vehicle_type_id"""
        ).fetchall()
    return {"vehicleTypes": [
        {"id": r["vehicle_type_id"], "code": r["code"], "name": r["name"],
         "category": r["category"], "fuelType": r["fuel_type"],
         "emissionStandard": r["emission_standard"], "emissionLevel": r["emission_level"],
         "transportationModeId": r["transportation_mode_id"], "modeName": r["mode_name"],
         "isDefault": r["is_default"], "status": r["status"]} for r in rows]}


@router.post("/vehicle-types")
def create_vehicle_type(body: VehicleTypeBody, admin: dict = Depends(auth_v2.require_admin)):
    with db_v2.db.get_conn() as conn:
        if body.isDefault:  # giữ nguyên tắc 1 đại diện mỗi mode
            conn.execute(
                "UPDATE policy.vehicle_types SET is_default=FALSE WHERE transportation_mode_id=%s",
                (body.transportationModeId,))
        row = conn.execute(
            """INSERT INTO policy.vehicle_types (code, name, category, fuel_type,
                   emission_standard, emission_level, transportation_mode_id, is_default)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING vehicle_type_id""",
            (body.code, body.name, body.category, body.fuelType, body.emissionStandard,
             body.emissionLevel, body.transportationModeId, body.isDefault),
        ).fetchone()
    return {"ok": True, "id": row["vehicle_type_id"]}


class ModeBody(BaseModel):
    name: str | None = None
    routingProfile: str | None = Field(default=None, pattern="^(car|bike|foot)$")
    speedFactor: float | None = Field(default=None, gt=0)
    avgWaitMin: float | None = Field(default=None, ge=0)
    baseFare: float | None = Field(default=None, ge=0)
    costPerKm: float | None = Field(default=None, ge=0)
    accessibilityScore: int | None = Field(default=None, ge=1, le=5)
    convenienceScore: int | None = Field(default=None, ge=1, le=5)
    isActive: bool | None = None


@router.get("/modes")
def list_modes(admin: dict = Depends(auth_v2.require_admin)):
    with db_v2.db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM transportation.transportation_modes ORDER BY transportation_mode_id"
        ).fetchall()
    return {"modes": [{k: v for k, v in dict(r).items()} for r in rows]}


@router.put("/modes/{mode_id}")
def update_mode(mode_id: int, body: ModeBody, admin: dict = Depends(auth_v2.require_admin)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, detail="Không có gì để cập nhật.")
    cols = ", ".join(f"{k}=%s" for k in fields)
    with db_v2.db.get_conn() as conn:
        n = conn.execute(
            f"""UPDATE transportation.transportation_modes SET {cols}
                WHERE transportation_mode_id=%s""",
            (*fields.values(), mode_id),
        ).rowcount
    if not n:
        raise HTTPException(404, detail="Không tìm thấy phương thức.")
    return {"ok": True}


# ---------------------------------------------------------------- weights (US-34)

class WeightsBody(BaseModel):
    weights: list[dict]  # [{code, weight}] — weight 0..1


@router.get("/weights")
def get_weights(admin: dict = Depends(auth_v2.require_admin)):
    with db_v2.db.get_conn() as conn:
        rows = conn.execute(
            "SELECT code, name, criteria_type, default_weight FROM decision.recommendation_criteria "
            "ORDER BY criteria_id").fetchall()
    return {"weights": [{"code": r["code"], "name": r["name"],
                         "type": r["criteria_type"], "weight": float(r["default_weight"])}
                        for r in rows]}


@router.put("/weights")
def put_weights(body: WeightsBody, admin: dict = Depends(auth_v2.require_admin)):
    total = sum(float(w.get("weight", 0)) for w in body.weights)
    if abs(total - 1.0) > 0.01:
        raise HTTPException(400, detail=f"Tổng trọng số phải bằng 1 (hiện tại {total:.2f}).")
    with db_v2.db.get_conn() as conn:
        for w in body.weights:
            conn.execute(
                "UPDATE decision.recommendation_criteria SET default_weight=%s WHERE code=%s",
                (float(w.get("weight", 0)), w.get("code")),
            )
    return {"ok": True, "total": round(total, 4)}


# ---------------------------------------------------------------- analytics (US-34..41)

@router.get("/analytics")
def analytics(from_: str | None = None, to: str | None = None,
              admin: dict = Depends(auth_v2.require_admin)):
    cond, params = "", []
    if from_ and to:
        cond = "WHERE t.created_at BETWEEN %s AND %s"
        params = [from_, to + " 23:59:59"]
    with db_v2.db.get_conn() as conn:
        k = conn.execute(
            f"""
            SELECT count(*) AS total,
                   count(*) FILTER (WHERE EXISTS (
                       SELECT 1 FROM trip.trip_routes r
                       JOIN trip.trip_lez_analysis a ON a.route_id = r.route_id
                       WHERE r.trip_id = t.trip_id AND r.routing_profile='car'
                         AND a.intersects)) AS lez_affected,
                   count(*) FILTER (WHERE t.switched) AS switched,
                   count(*) FILTER (WHERE t.chosen_vehicle_type_id IS NOT NULL) AS chosen
            FROM trip.trips t {cond}
            """, params).fetchone()
        top = conn.execute(
            f"""
            SELECT m.name, m.code, count(DISTINCT r.recommendation_run_id) AS cnt
            FROM decision.recommendation_scores s
            JOIN decision.recommendation_runs r ON r.recommendation_run_id = s.recommendation_run_id
            JOIN trip.trips t ON t.trip_id = r.trip_id
            JOIN transportation.transportation_modes m
              ON m.transportation_mode_id = s.transportation_mode_id
            WHERE s.rank_position = 1 {('AND ' + cond[6:]) if cond else ''}
            GROUP BY m.name, m.code ORDER BY cnt DESC
            """, params).fetchall()
        by_district = conn.execute(
            f"""
            SELECT COALESCE(rg.name, 'Không xác định') AS district, count(*) AS cnt
            FROM trip.trips t LEFT JOIN gis.administrative_regions rg
              ON rg.region_id = t.origin_region_id
            {cond}
            GROUP BY rg.name ORDER BY cnt DESC
            """, params).fetchall()
        by_purpose = conn.execute(
            f"""
            SELECT COALESCE(t.trip_purpose, 'other') AS purpose, count(*) AS cnt
            FROM trip.trips t {cond}
            GROUP BY t.trip_purpose ORDER BY cnt DESC
            """, params).fetchall()
        switching = conn.execute(
            f"""
            SELECT vt.name, count(*) AS cnt FROM trip.trips t
            JOIN policy.vehicle_types vt ON vt.vehicle_type_id = t.chosen_vehicle_type_id
            WHERE t.switched {('AND ' + cond[6:]) if cond else ''}
            GROUP BY vt.name ORDER BY cnt DESC
            """, params).fetchall()
        rec_stats = conn.execute(
            "SELECT count(*) AS runs, COALESCE(round(avg(duration_ms)),0) AS avg_ms, "
            "COALESCE(max(duration_ms),0) AS max_ms FROM decision.recommendation_runs"
        ).fetchone()
        survey = conn.execute(
            "SELECT count(*) AS total, count(*) FILTER (WHERE is_valid) AS valid, "
            "max(imported_at) AS imported_at FROM survey.vehicle_survey_responses"
        ).fetchone()
    return {
        "kpis": {"totalTrips": k["total"],
                 "lezAffectedPct": round(k["lez_affected"] / k["total"] * 100, 1) if k["total"] else 0,
                 "switchingPct": round(k["switched"] / k["total"] * 100, 1) if k["total"] else 0,
                 "chosenCount": k["chosen"]},
        "topRecommended": [{"mode": r["name"], "code": r["code"], "count": r["cnt"]} for r in top],
        "byDistrict": [{"district": r["district"], "count": r["cnt"]} for r in by_district],
        "byPurpose": [{"purpose": r["purpose"], "count": r["cnt"]} for r in by_purpose],
        "switchingTo": [{"vehicleType": r["name"], "count": r["cnt"]} for r in switching],
        "recommendationStats": {"runs": rec_stats["runs"], "avgMs": rec_stats["avg_ms"],
                                "maxMs": rec_stats["max_ms"]},
        "dataset": {"surveyTotal": survey["total"], "surveyValid": survey["valid"],
                    "importedAt": survey["imported_at"].isoformat() if survey["imported_at"] else None},
    }
