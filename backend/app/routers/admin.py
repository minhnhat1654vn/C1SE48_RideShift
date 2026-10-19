"""Admin REST endpoints (cookie-authenticated, US-21..US-35).

Includes the admin analytics aggregation implemented with pandas (proposal:
data processing with Python + pandas), the dataset reprocess endpoint and
system_logs audit entries for every admin mutation.
"""
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Optional, Union

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from .. import auth, config, db
from ..dto import iso_z, mode_dto, rule_dto, trip_dto, weight_dto, zone_dto
from ..geojson import polygon_geojson_from_pairs

router = APIRouter()


def _client_ip(request: Request) -> Optional[str]:
    try:
        return request.client.host if request.client else None
    except Exception:
        return None


# ---------------------------------------------------------------- auth

class LoginBody(BaseModel):
    username: str = ""
    password: str = ""


@router.post("/api/admin/login")
def login(body: LoginBody, request: Request, response: Response):
    username = body.username.strip()
    password = body.password
    if not username or not password:
        raise HTTPException(status_code=400, detail="Vui lòng nhập tên đăng nhập và mật khẩu.")
    with db.get_conn() as conn:
        user = conn.execute(
            "SELECT * FROM core.admins WHERE username = %s", (username,)
        ).fetchone()
    if not user or not auth.verify_password(password, user["password_hash"]):
        db.log_action("LOGIN_FAILED", entity_type="admin", description=username, ip=_client_ip(request), level="warn")
        raise HTTPException(status_code=401, detail="Tên đăng nhập hoặc mật khẩu không đúng.")
    with db.get_conn() as conn:
        token, expires_at = auth.create_session(conn, user["admin_id"])
    auth.set_session_cookie(response, token)
    db.log_action("LOGIN", admin_id=user["admin_id"], entity_type="admin",
                  entity_id=user["admin_id"], description=username, ip=_client_ip(request))
    return {
        "user": {"username": user["username"], "fullName": user["full_name"]},
        "expiresAt": expires_at.isoformat().replace("+00:00", "Z"),
    }


@router.post("/api/admin/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(config.SESSION_COOKIE)
    if token:
        try:
            admin = auth.get_admin(request)
            with db.get_conn() as conn:
                auth.destroy_session(conn, token)
            if admin:
                db.log_action("LOGOUT", admin_id=admin["id"], entity_type="admin",
                              entity_id=admin["id"], ip=_client_ip(request))
        except Exception:
            pass
    auth.clear_session_cookie(response)
    return {"ok": True}


@router.get("/api/admin/me")
def me(request: Request):
    admin = auth.get_admin(request)
    return {"user": admin}


# ---------------------------------------------------------------- zones

class ZoneBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=1000)
    coordinates: list = Field(min_length=3)
    active: bool = True


class ZonePatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=1000)
    coordinates: Optional[list] = Field(default=None, min_length=3)
    active: Optional[bool] = None


def _validate_zone_points(points: list) -> None:
    """US-22: polygon points must be finite numeric [lat, lng] pairs in range."""
    for p in points:
        if not (isinstance(p, (list, tuple)) and len(p) == 2):
            raise HTTPException(
                status_code=400,
                detail="Dữ liệu vùng không hợp lệ. Một vùng cần ít nhất 3 điểm [lat, lng] hợp lệ và có tên.",
            )
        lat, lng = p
        if (
            isinstance(lat, bool)
            or isinstance(lng, bool)
            or not all(isinstance(v, (int, float)) for v in (lat, lng))
        ):
            raise HTTPException(
                status_code=400,
                detail="Dữ liệu vùng không hợp lệ. Tọa độ phải là số [lat, lng].",
            )
        lat, lng = float(lat), float(lng)
        if not (math.isfinite(lat) and math.isfinite(lng)):
            raise HTTPException(
                status_code=400,
                detail="Dữ liệu vùng không hợp lệ. Tọa độ phải là số hữu hạn.",
            )
        if not -90.0 <= lat <= 90.0:
            raise HTTPException(
                status_code=400,
                detail="Dữ liệu vùng không hợp lệ. Vĩ độ phải nằm trong [-90, 90].",
            )
        if not -180.0 <= lng <= 180.0:
            raise HTTPException(
                status_code=400,
                detail="Dữ liệu vùng không hợp lệ. Kinh độ phải nằm trong [-180, 180].",
            )


@router.get("/api/admin/zones")
def admin_zones(admin: dict = Depends(auth.require_admin)):
    with db.get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT lez_zone_id, name, description, status, effective_from,
                   created_at, updated_at, {db.geom_read('geometry', 'geometry_json')}
            FROM policy.lez_zones ORDER BY created_at ASC
            """
        ).fetchall()
    # historical contract: admin list keeps coordinates as the raw JSON string
    return {"zones": [zone_dto(r) for r in rows]}


@router.post("/api/admin/zones")
def create_zone(body: ZoneBody, request: Request, admin: dict = Depends(auth.require_admin)):
    _validate_zone_points(body.coordinates)

    ring_geojson = polygon_geojson_from_pairs(body.coordinates)
    with db.get_conn() as conn:
        study_id = db.study_area_id(conn)
        zone_id = int(
            conn.execute(
                f"""
                INSERT INTO policy.lez_zones (study_area_id, name, description,
                    geometry, status)
                VALUES (%s, %s, %s, {db.geom_write(multi=True)}, %s)
                RETURNING lez_zone_id
                """,
                (study_id, body.name, body.description, ring_geojson,
                 "active" if body.active else "inactive"),
            ).fetchone()["lez_zone_id"]
        )
        row = conn.execute(
            f"""
            SELECT lez_zone_id, name, description, status, effective_from,
                   created_at, updated_at, {db.geom_read('geometry', 'geometry_json')}
            FROM policy.lez_zones WHERE lez_zone_id = %s
            """,
            (zone_id,),
        ).fetchone()
    db.log_action("ZONE_CREATE", admin_id=admin["id"], entity_type="lez_zone",
                  entity_id=zone_id, description=body.name, ip=_client_ip(request))
    return {"zone": zone_dto(row)}


@router.put("/api/admin/zones/{zone_id}")
def update_zone(zone_id: str, body: ZonePatch, request: Request, admin: dict = Depends(auth.require_admin)):
    try:
        zid = int(zone_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="Không tìm thấy vùng.")
    data = body.model_dump(exclude_unset=True, exclude_none=False)
    if not data:
        raise HTTPException(status_code=400, detail="Dữ liệu vùng không hợp lệ.")
    with db.get_conn() as conn:
        existing = conn.execute(
            "SELECT lez_zone_id FROM policy.lez_zones WHERE lez_zone_id = %s", (zid,)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Không tìm thấy vùng.")
        sets, vals = [], []
        for k, v in data.items():
            if k == "coordinates":
                if v is not None:
                    _validate_zone_points(v)  # US-22: same checks as create
                    sets.append(f"geometry = {db.geom_write(multi=True)}")
                    vals.append(polygon_geojson_from_pairs(v))
            elif k == "description":
                sets.append("description = %s")
                vals.append(v)
            elif k == "active":
                sets.append("status = %s")
                vals.append("active" if v else "inactive")
            else:  # name
                sets.append("name = %s")
                vals.append(v)
        sets.append("updated_at = now()")
        vals.append(zid)
        conn.execute(f"UPDATE policy.lez_zones SET {', '.join(sets)} WHERE lez_zone_id = %s", vals)
        row = conn.execute(
            f"""
            SELECT lez_zone_id, name, description, status, effective_from,
                   created_at, updated_at, {db.geom_read('geometry', 'geometry_json')}
            FROM policy.lez_zones WHERE lez_zone_id = %s
            """,
            (zid,),
        ).fetchone()
    db.log_action("ZONE_UPDATE", admin_id=admin["id"], entity_type="lez_zone",
                  entity_id=zid, description=row["name"], ip=_client_ip(request))
    return {"zone": zone_dto(row)}


@router.delete("/api/admin/zones/{zone_id}")
def delete_zone(zone_id: str, request: Request, admin: dict = Depends(auth.require_admin)):
    try:
        zid = int(zone_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="Không tìm thấy vùng.")
    with db.get_conn() as conn:
        res = conn.execute(
            "DELETE FROM policy.lez_zones WHERE lez_zone_id = %s RETURNING lez_zone_id, name",
            (zid,),
        ).fetchone()
    if not res:
        raise HTTPException(status_code=404, detail="Không tìm thấy vùng.")
    db.log_action("ZONE_DELETE", admin_id=admin["id"], entity_type="lez_zone",
                  entity_id=zid, description=res["name"], ip=_client_ip(request))
    return {"ok": True}


# ---------------------------------------------------------------- rules

_RULE_JOIN = """
    SELECT lr.lez_rule_id, lr.lez_zone_id, lr.start_time, lr.end_time,
           lr.days_of_week, lr.status,
           vr.restriction_type,
           COALESCE(vr.restriction_reason, lr.description) AS condition,
           tm.code AS mode_code, tm.name AS mode_name
    FROM policy.lez_rules lr
    LEFT JOIN policy.vehicle_restrictions vr ON vr.lez_rule_id = lr.lez_rule_id
    LEFT JOIN policy.vehicle_types vt ON vt.vehicle_type_id = vr.vehicle_type_id
    LEFT JOIN transportation.transportation_modes tm
      ON tm.transportation_mode_id = vt.transportation_mode_id
"""


class RuleBody(BaseModel):
    zoneId: Union[int, str]
    modeId: str = Field(min_length=1)
    restrictionType: str = Field(pattern="^(banned|conditional)$")
    condition: Optional[str] = Field(default=None, max_length=600)
    startTime: str = Field(pattern=r"^\d{2}:\d{2}$")
    endTime: str = Field(pattern=r"^\d{2}:\d{2}$")
    days: str = Field(min_length=3)
    active: bool = True


class RulePatch(BaseModel):
    restrictionType: Optional[str] = Field(default=None, pattern="^(banned|conditional)$")
    condition: Optional[str] = Field(default=None, max_length=600)
    startTime: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    endTime: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    days: Optional[str] = Field(default=None, min_length=3)
    active: Optional[bool] = None


def _rule_id_of(raw) -> Optional[int]:
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


@router.get("/api/admin/rules")
def admin_rules(admin: dict = Depends(auth.require_admin)):
    with db.get_conn() as conn:
        rows = conn.execute(f"{_RULE_JOIN} ORDER BY lr.created_at ASC").fetchall()
    return {"rules": [rule_dto(r) for r in rows]}


@router.post("/api/admin/rules")
def create_rule(body: RuleBody, request: Request, admin: dict = Depends(auth.require_admin)):
    zone_id = _rule_id_of(body.zoneId)
    if not zone_id:
        raise HTTPException(status_code=400, detail="Không tạo được quy định. Kiểm tra lại vùng và phương tiện.")
    try:
        with db.get_conn() as conn:
            mode = conn.execute(
                "SELECT transportation_mode_id, name FROM transportation.transportation_modes WHERE code = %s",
                (body.modeId,),
            ).fetchone()
            if not mode:
                raise HTTPException(status_code=400, detail="Không tạo được quy định. Kiểm tra lại vùng và phương tiện.")
            vt_id = db.vehicle_type_id_by_mode_code(conn, body.modeId)
            rule_name = (
                f"{'Cấm' if body.restrictionType == 'banned' else 'Hạn chế có điều kiện'} — {mode['name']}"
            )
            rule_id = int(
                conn.execute(
                    """
                    INSERT INTO policy.lez_rules (lez_zone_id, rule_name, description,
                        start_time, end_time, days_of_week, status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING lez_rule_id
                    """,
                    (
                        zone_id, rule_name, body.condition, body.startTime,
                        body.endTime, body.days,
                        "active" if body.active else "inactive",
                    ),
                ).fetchone()["lez_rule_id"]
            )
            if vt_id:
                conn.execute(
                    """
                    INSERT INTO policy.vehicle_restrictions
                        (lez_rule_id, vehicle_type_id, restriction_type,
                         min_emission_level, restriction_reason)
                    VALUES (%s, %s, %s, 0, %s)
                    """,
                    (rule_id, vt_id, body.restrictionType, body.condition),
                )
            row = conn.execute(f"{_RULE_JOIN} WHERE lr.lez_rule_id = %s", (rule_id,)).fetchone()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=400, detail="Không tạo được quy định. Kiểm tra lại vùng và phương tiện."
        )
    db.log_action("RULE_CREATE", admin_id=admin["id"], entity_type="lez_rule",
                  entity_id=rule_id, description=rule_name, ip=_client_ip(request))
    return {"rule": rule_dto(row)}


@router.put("/api/admin/rules/{rule_id}")
def update_rule(rule_id: str, body: RulePatch, request: Request, admin: dict = Depends(auth.require_admin)):
    rid = _rule_id_of(rule_id)
    if not rid:
        raise HTTPException(status_code=404, detail="Không tìm thấy quy định.")
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    data = {k: v for k, v in data.items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="Dữ liệu quy định không hợp lệ.")
    rule_sets, rule_vals = [], []
    vr_sets, vr_vals = [], []
    for k, v in data.items():
        if k == "startTime":
            rule_sets.append("start_time = %s")
            rule_vals.append(v)
        elif k == "endTime":
            rule_sets.append("end_time = %s")
            rule_vals.append(v)
        elif k == "days":
            rule_sets.append("days_of_week = %s")
            rule_vals.append(v)
        elif k == "active":
            rule_sets.append("status = %s")
            rule_vals.append("active" if v else "inactive")
        elif k == "restrictionType":
            vr_sets.append("restriction_type = %s")
            vr_vals.append(v)
        elif k == "condition":
            vr_sets.append("restriction_reason = %s")
            vr_vals.append(v)
    try:
        with db.get_conn() as conn:
            if rule_sets:
                rule_sets.append("updated_at = now()")
                rule_vals.append(rid)
                conn.execute(
                    f"UPDATE policy.lez_rules SET {', '.join(rule_sets)} WHERE lez_rule_id = %s",
                    rule_vals,
                )
            if vr_sets:
                conn.execute(
                    f"UPDATE policy.vehicle_restrictions SET {', '.join(vr_sets)} WHERE lez_rule_id = %s",
                    vr_vals + [rid],
                )
            row = conn.execute(f"{_RULE_JOIN} WHERE lr.lez_rule_id = %s", (rid,)).fetchone()
    except Exception:
        raise HTTPException(status_code=400, detail="Không cập nhật được quy định.")
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy quy định.")
    db.log_action("RULE_UPDATE", admin_id=admin["id"], entity_type="lez_rule",
                  entity_id=rid, ip=_client_ip(request))
    return {"rule": rule_dto(row)}


@router.delete("/api/admin/rules/{rule_id}")
def delete_rule(rule_id: str, request: Request, admin: dict = Depends(auth.require_admin)):
    rid = _rule_id_of(rule_id)
    if not rid:
        raise HTTPException(status_code=404, detail="Không tìm thấy quy định.")
    with db.get_conn() as conn:
        res = conn.execute(
            "DELETE FROM policy.lez_rules WHERE lez_rule_id = %s RETURNING lez_rule_id",
            (rid,),
        ).fetchone()
    if not res:
        raise HTTPException(status_code=404, detail="Không tìm thấy quy định.")
    db.log_action("RULE_DELETE", admin_id=admin["id"], entity_type="lez_rule",
                  entity_id=rid, ip=_client_ip(request))
    return {"ok": True}


# ---------------------------------------------------------------- modes

class ModeBody(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    enabled: Optional[bool] = None
    avgSpeedKmh: Optional[float] = Field(default=None, gt=0)
    baseCostVnd: Optional[float] = Field(default=None, ge=0)
    costPerKmVnd: Optional[float] = Field(default=None, ge=0)
    co2PerKmG: Optional[float] = Field(default=None, ge=0)
    baseAccessibility: Optional[float] = Field(default=None, ge=0, le=1)
    baseConvenience: Optional[float] = Field(default=None, ge=0, le=1)
    waitMinutes: Optional[float] = Field(default=None, ge=0)


@router.get("/api/admin/modes")
def admin_modes(admin: dict = Depends(auth.require_admin)):
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM transportation.transportation_modes ORDER BY sort_order ASC"
        ).fetchall()
    return {"modes": [mode_dto(r) for r in rows]}


@router.put("/api/admin/modes")
def update_mode(body: ModeBody, request: Request, admin: dict = Depends(auth.require_admin)):
    colmap = {
        "name": "name",
        "enabled": "is_active",
        "avgSpeedKmh": "avg_speed_kmh",
        "baseCostVnd": "base_fare",
        "costPerKmVnd": "cost_per_km",
        "co2PerKmG": "co2_per_km_g",
        "baseAccessibility": "accessibility_score",
        "baseConvenience": "convenience_score",
        "waitMinutes": "avg_wait_min",
    }
    data = body.model_dump(exclude_unset=True)
    updates = {colmap[k]: v for k, v in data.items() if k in colmap and v is not None}
    with db.get_conn() as conn:
        exists = conn.execute(
            "SELECT transportation_mode_id FROM transportation.transportation_modes WHERE code = %s",
            (body.id,),
        ).fetchone()
        if exists:
            if updates:
                sets = ", ".join(f"{c} = %s" for c in updates)
                conn.execute(
                    f"UPDATE transportation.transportation_modes SET {sets} WHERE code = %s",
                    list(updates.values()) + [body.id],
                )
        else:
            conn.execute(
                """
                INSERT INTO transportation.transportation_modes
                    (code, name, description, icon, avg_speed_kmh,
                     base_fare, cost_per_km, co2_per_km_g, accessibility_score,
                     convenience_score, avg_wait_min, is_active, sort_order)
                VALUES (%s,%s,'','circle-dot',%s,%s,%s,%s,%s,%s,%s,%s,99)
                """,
                (
                    body.id,
                    body.name,
                    updates.get("avg_speed_kmh", 20),
                    updates.get("base_fare", 0),
                    updates.get("cost_per_km", 0),
                    updates.get("co2_per_km_g", 0),
                    updates.get("accessibility_score", 0.7),
                    updates.get("convenience_score", 0.7),
                    updates.get("avg_wait_min", 0),
                    updates.get("is_active", True),
                ),
            )
        row = conn.execute(
            "SELECT * FROM transportation.transportation_modes WHERE code = %s", (body.id,)
        ).fetchone()
    db.log_action("MODE_UPDATE", admin_id=admin["id"], entity_type="transportation_mode",
                  entity_id=row["transportation_mode_id"], description=body.id,
                  ip=_client_ip(request))
    return {"mode": mode_dto(row)}


# ---------------------------------------------------------------- weights

class WeightRow(BaseModel):
    criterion: str = Field(min_length=1)
    weight: float = Field(ge=0, le=100)


class WeightsBody(BaseModel):
    weights: list[WeightRow] = Field(min_length=7, max_length=7)


@router.get("/api/admin/weights")
def admin_weights(admin: dict = Depends(auth.require_admin)):
    with db.get_conn() as conn:
        rows = conn.execute("SELECT * FROM decision.recommendation_criteria").fetchall()
    return {"weights": [weight_dto(r) for r in rows]}


@router.put("/api/admin/weights")
def update_weights(body: WeightsBody, request: Request, admin: dict = Depends(auth.require_admin)):
    total = sum(w.weight for w in body.weights)
    if abs(total - 100) > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Tổng trọng số phải bằng 100%. Hiện tại: {total:.1f}%.",
        )
    with db.get_conn() as conn:
        for w in body.weights:
            conn.execute(
                """
                INSERT INTO decision.recommendation_criteria (code, name, default_weight)
                VALUES (%s, %s, %s)
                ON CONFLICT (code) DO UPDATE SET default_weight = EXCLUDED.default_weight
                """,
                (w.criterion, w.criterion, w.weight),
            )
        rows = conn.execute("SELECT * FROM decision.recommendation_criteria").fetchall()
    db.log_action("WEIGHTS_UPDATE", admin_id=admin["id"], entity_type="recommendation_criteria",
                  description=", ".join(f"{w.criterion}={w.weight}%" for w in body.weights),
                  ip=_client_ip(request))
    return {"weights": [weight_dto(r) for r in rows]}


# ---------------------------------------------------------------- analytics
# Aggregations computed with pandas (proposal: data processing layer).


def _dataset_section() -> dict:
    """US-25: survey-dataset surface for the analytics dashboard.

    Latest core.dataset_runs row + one row per mode with share / trend index /
    sample count (mode display name resolved via transportation_modes).
    share is stored 0..1 and reported as a percentage (0..100).

    Period-aware: the Kaggle survey (dataHN.csv) has no date column, so its
    period axis is AGE COHORTS — the dashboard then shows the OVERALL mode
    shares of the whole sample instead of a single (oldest) cohort slice.
    """
    with db.get_conn() as conn:
        run = conn.execute(
            """
            SELECT ran_at, source_file, rows_in, rows_clean, notes
            FROM core.dataset_runs
            ORDER BY ran_at DESC
            LIMIT 1
            """
        ).fetchone()
        last_run = (
            {
                "ranAt": iso_z(run["ran_at"]),
                "sourceFile": run["source_file"],
                "rowsIn": int(run["rows_in"]),
                "rowsClean": int(run["rows_clean"]),
            }
            if run
            else None
        )

        try:
            run_notes = json.loads(run["notes"]) if run and run["notes"] else {}
        except (TypeError, ValueError):
            run_notes = {}
        period_kind = (
            run_notes.get("periodKind", "month")
            if isinstance(run_notes, dict)
            else "month"
        )
        latest_period = (
            run_notes.get("latestPeriod") if isinstance(run_notes, dict) else None
        )

        mode_trend: list = []
        latest_month = None
        if period_kind == "cohort":
            latest_month = latest_period
            total = conn.execute(
                """
                SELECT count(*) AS c FROM decision.vehicle_survey_responses
                WHERE current_mode_id IS NOT NULL
                """
            ).fetchone()["c"]
            if total:
                trend_rows = conn.execute(
                    """
                    SELECT tm.code AS mode_id,
                           COALESCE(tm.name, tm.code) AS mode_name,
                           counts.c,
                           ti.trend_index
                    FROM (
                        SELECT current_mode_id, count(*) AS c
                        FROM decision.vehicle_survey_responses
                        WHERE current_mode_id IS NOT NULL
                        GROUP BY current_mode_id
                    ) counts
                    JOIN transportation.transportation_modes tm
                      ON tm.transportation_mode_id = counts.current_mode_id
                    LEFT JOIN LATERAL (
                        SELECT t2.trend_index
                        FROM decision.dataset_trends t2
                        WHERE t2.transportation_mode_id = counts.current_mode_id
                        ORDER BY t2.month DESC
                        LIMIT 1
                    ) ti ON true
                    ORDER BY counts.c DESC
                    """
                ).fetchall()
                mode_trend = [
                    {
                        "modeId": r["mode_id"],
                        "modeName": r["mode_name"],
                        "share": round(float(r["c"]) / total * 100, 2),
                        "trendIndex": (
                            round(float(r["trend_index"]), 4)
                            if r["trend_index"] is not None
                            else None
                        ),
                        "sampleCount": int(r["c"]),
                    }
                    for r in trend_rows
                ]
        else:
            latest_month = conn.execute(
                "SELECT max(month) AS latest_month FROM decision.dataset_trends"
            ).fetchone()["latest_month"]

            if latest_month:
                trend_rows = conn.execute(
                    """
                    SELECT t.transportation_mode_id,
                           tm.code AS mode_id,
                           COALESCE(tm.name, tm.code) AS mode_name,
                           t.share, t.trend_index, t.sample_count
                    FROM decision.dataset_trends t
                    JOIN transportation.transportation_modes tm
                      ON tm.transportation_mode_id = t.transportation_mode_id
                    WHERE t.month = %s
                    ORDER BY t.share DESC
                    """,
                    (latest_month,),
                ).fetchall()
                mode_trend = [
                    {
                        "modeId": r["mode_id"],
                        "modeName": r["mode_name"],
                        "share": round(float(r["share"]) * 100, 2),
                        "trendIndex": round(float(r["trend_index"]), 4),
                        "sampleCount": int(r["sample_count"]),
                    }
                    for r in trend_rows
                ]

    return {
        "lastRun": last_run,
        "latestMonth": latest_month,
        "periodKind": period_kind,
        "modeTrend": mode_trend,
    }


_TRIP_JOIN = """
    SELECT t.*,
           mv.code  AS vehicle_id,
           mtc.code AS top_mode_id,
           mcc.code AS chosen_mode_id
    FROM trip.trips t
    LEFT JOIN policy.vehicle_types vtv ON vtv.vehicle_type_id = t.vehicle_type_id
    LEFT JOIN transportation.transportation_modes mv
      ON mv.transportation_mode_id = vtv.transportation_mode_id
    LEFT JOIN transportation.transportation_modes mtc
      ON mtc.transportation_mode_id = t.top_mode_id
    LEFT JOIN policy.vehicle_types vtc ON vtc.vehicle_type_id = t.chosen_vehicle_type_id
    LEFT JOIN transportation.transportation_modes mcc
      ON mcc.transportation_mode_id = vtc.transportation_mode_id
"""


@router.get("/api/admin/analytics")
def analytics(request: Request, admin=Depends(auth.require_admin), From: Optional[str] = Query(default=None, alias="from"), To: Optional[str] = Query(default=None, alias="to")):
    now = datetime.now(timezone.utc)
    try:
        to = (
            datetime.fromisoformat(f"{To}T23:59:59+00:00")
            if To
            else now
        )
        from_ = (
            datetime.fromisoformat(f"{From}T00:00:00+00:00")
            if From
            else now - timedelta(days=30)
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Khoảng thời gian không hợp lệ.")

    # US-25: dataset surface is independent of the trip date range
    dataset_section = _dataset_section()

    with db.get_conn() as conn:
        modes = conn.execute(
            "SELECT * FROM transportation.transportation_modes ORDER BY sort_order ASC"
        ).fetchall()
        # US-29/35: aggregate the WHOLE selected date range (no LIMIT).
        rows = conn.execute(
            f"""
            {_TRIP_JOIN}
            WHERE t.created_at >= %s AND t.created_at <= %s
            ORDER BY t.created_at DESC
            """,
            (from_, to),
        ).fetchall()

    mode_names = {m["code"]: m["name"] for m in modes}
    trips = pd.DataFrame([trip_dto(r) for r in rows])
    total = len(trips)

    if total == 0:
        empty_trips: list = []
        return {
            "from": from_.isoformat().replace("+00:00", "Z"),
            "to": to.isoformat().replace("+00:00", "Z"),
            "kpis": {
                "totalTrips": 0,
                "lezAffectedPct": 0,
                "avgTimeMin": 0,
                "avgCostVnd": 0,
                "switchingPct": 0,
                "mostRecommended": None,
            },
            "modeDistribution": [],
            "byDistrict": [],
            "byPurpose": [],
            "switching": [],
            "dataset": dataset_section,
            "trips": empty_trips,
        }

    lez_affected = int(trips["lezAffected"].sum())
    switched_n = int(trips["switched"].sum())

    # mode distribution of top recommendations
    dist = (
        trips.groupby("topModeId").size().sort_values(ascending=False)
    )
    mode_distribution = [
        {"modeId": mid, "name": mode_names.get(mid, mid), "count": int(c)}
        for mid, c in dist.items()
    ]

    # by origin district
    g = trips.groupby("originDistrict").agg(count=("id", "size"), avgScore=("topScore", "mean"))
    by_district = [
        {"district": d, "count": int(r["count"]), "avgScore": float(r["avgScore"])}
        for d, r in g.sort_values("count", ascending=False).iterrows()
    ]

    # by trip purpose (top recommended mode per purpose)
    by_purpose = []
    for purpose, grp in trips.groupby("purpose"):
        top_mode = grp["topModeId"].mode()
        by_purpose.append(
            {
                "purpose": purpose,
                "count": int(len(grp)),
                "topModeId": top_mode.iloc[0] if len(top_mode) else None,
            }
        )
    by_purpose.sort(key=lambda x: -x["count"])

    # switching patterns (what users switched TO)
    switched = trips[(trips["switched"]) & (trips["chosenModeId"].notna())]
    sw = (
        switched.groupby("chosenModeId").size().sort_values(ascending=False)
    )
    switching = [
        {"modeId": mid, "name": mode_names.get(mid, mid), "count": int(c)}
        for mid, c in sw.items()
    ]

    most_recommended = mode_distribution[0] if mode_distribution else None

    return {
        "from": from_.isoformat().replace("+00:00", "Z"),
        "to": to.isoformat().replace("+00:00", "Z"),
        "kpis": {
            "totalTrips": total,
            "lezAffectedPct": (lez_affected / total) * 100 if total else 0,
            "avgTimeMin": float(trips["avgTimeMin"].mean()),
            "avgCostVnd": float(trips["avgCostVnd"].mean()),
            "switchingPct": (switched_n / total) * 100 if total else 0,
            "mostRecommended": most_recommended,
        },
        "modeDistribution": mode_distribution,
        "byDistrict": by_district,
        "byPurpose": by_purpose,
        "switching": switching,
        "dataset": dataset_section,
        "trips": trips.to_dict(orient="records"),
    }


# ---------------------------------------------------------------- dataset

@router.post("/api/admin/dataset/reprocess")
def reprocess_dataset(request: Request, admin: dict = Depends(auth.require_admin)):
    """Re-run the pandas "Vehicle at Ha Noi Dataset" pipeline."""
    from ..services import trend

    report = trend.run_pipeline()
    db.log_action("DATASET_REPROCESS", admin_id=admin["id"], entity_type="dataset_run",
                  description=(
                      f"{report.get('sourceFile')}: rows_in={report.get('rowsIn')}, "
                      f"rows_clean={report.get('rowsClean')}"
                  ),
                  ip=_client_ip(request))
    return report
