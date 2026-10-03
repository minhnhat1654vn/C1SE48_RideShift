"""Admin REST endpoints (cookie-authenticated, US-21..US-35).

Includes the admin analytics aggregation implemented with pandas (proposal:
data processing with Python + pandas) and the dataset reprocess endpoint.
"""
import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from .. import auth, config, db
from ..dto import iso_z, mode_dto, rule_dto, trip_dto, weight_dto, zone_dto

router = APIRouter()


# ---------------------------------------------------------------- auth

class LoginBody(BaseModel):
    username: str = ""
    password: str = ""


@router.post("/api/admin/login")
def login(body: LoginBody, response: Response):
    username = body.username.strip()
    password = body.password
    if not username or not password:
        raise HTTPException(status_code=400, detail="Vui lòng nhập tên đăng nhập và mật khẩu.")
    with db.get_conn() as conn:
        user = conn.execute(
            "SELECT * FROM admin_user WHERE username = %s", (username,)
        ).fetchone()
    if not user or not auth.verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Tên đăng nhập hoặc mật khẩu không đúng.")
    with db.get_conn() as conn:
        token, expires_at = auth.create_session(conn, user["id"])
    auth.set_session_cookie(response, token)
    return {
        "user": {"username": user["username"], "fullName": user["full_name"]},
        "expiresAt": expires_at.isoformat().replace("+00:00", "Z"),
    }


@router.post("/api/admin/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(config.SESSION_COOKIE)
    if token:
        try:
            with db.get_conn() as conn:
                auth.destroy_session(conn, token)
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
        rows = conn.execute("SELECT * FROM lez_zone ORDER BY created_at ASC").fetchall()
    # historical contract: admin list keeps coordinates as the raw JSON string
    return {"zones": [{**zone_dto(r), "coordinates": r["coordinates"]} for r in rows]}


@router.post("/api/admin/zones")
def create_zone(body: ZoneBody, admin: dict = Depends(auth.require_admin)):
    _validate_zone_points(body.coordinates)
    import json as _json

    zone_id = uuid.uuid4().hex
    coords_json = _json.dumps(body.coordinates)
    with db.get_conn() as conn:
        conn.execute(
            """
            INSERT INTO lez_zone (id, name, description, coordinates, active)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (zone_id, body.name, body.description, coords_json, body.active),
        )
        db.sync_zone_geom(conn, zone_id, coords_json)
        row = conn.execute("SELECT * FROM lez_zone WHERE id = %s", (zone_id,)).fetchone()
    return {"zone": zone_dto(row)}


@router.put("/api/admin/zones/{zone_id}")
def update_zone(zone_id: str, body: ZonePatch, admin: dict = Depends(auth.require_admin)):
    import json as _json

    data = body.model_dump(exclude_unset=True, exclude_none=False)
    if not data:
        raise HTTPException(status_code=400, detail="Dữ liệu vùng không hợp lệ.")
    coords_json = None
    with db.get_conn() as conn:
        existing = conn.execute("SELECT id FROM lez_zone WHERE id = %s", (zone_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Không tìm thấy vùng.")
        sets, vals = [], []
        for k, v in data.items():
            if k == "coordinates":
                if v is not None:
                    _validate_zone_points(v)  # US-22: same checks as create
                    coords_json = _json.dumps(v)
                    sets.append("coordinates = %s")
                    vals.append(coords_json)
                    sets.append("updated_at = now()")
            elif k == "description":
                sets.append("description = %s")
                vals.append(v)
                sets.append("updated_at = now()")
            else:
                col = {"name": "name", "active": "active"}[k]
                sets.append(f"{col} = %s")
                vals.append(v)
                sets.append("updated_at = now()")
        vals.append(zone_id)
        conn.execute(f"UPDATE lez_zone SET {', '.join(sets)} WHERE id = %s", vals)
        if coords_json:
            db.sync_zone_geom(conn, zone_id, coords_json)
        row = conn.execute("SELECT * FROM lez_zone WHERE id = %s", (zone_id,)).fetchone()
    return {"zone": zone_dto(row)}


@router.delete("/api/admin/zones/{zone_id}")
def delete_zone(zone_id: str, admin: dict = Depends(auth.require_admin)):
    with db.get_conn() as conn:
        res = conn.execute("DELETE FROM lez_zone WHERE id = %s RETURNING id", (zone_id,)).fetchone()
    if not res:
        raise HTTPException(status_code=404, detail="Không tìm thấy vùng.")
    return {"ok": True}


# ---------------------------------------------------------------- rules

class RuleBody(BaseModel):
    zoneId: str = Field(min_length=1)
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


@router.get("/api/admin/rules")
def admin_rules(admin: dict = Depends(auth.require_admin)):
    with db.get_conn() as conn:
        rows = conn.execute("SELECT * FROM policy_rule ORDER BY created_at ASC").fetchall()
    return {"rules": [rule_dto(r) for r in rows]}


@router.post("/api/admin/rules")
def create_rule(body: RuleBody, admin: dict = Depends(auth.require_admin)):
    rule_id = uuid.uuid4().hex
    try:
        with db.get_conn() as conn:
            conn.execute(
                """
                INSERT INTO policy_rule (id, zone_id, mode_id, restriction_type,
                    condition, start_time, end_time, days, active)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    rule_id, body.zoneId, body.modeId, body.restrictionType,
                    body.condition, body.startTime, body.endTime, body.days, body.active,
                ),
            )
            row = conn.execute("SELECT * FROM policy_rule WHERE id = %s", (rule_id,)).fetchone()
    except Exception:
        raise HTTPException(
            status_code=400, detail="Không tạo được quy định. Kiểm tra lại vùng và phương tiện."
        )
    return {"rule": rule_dto(row)}


@router.put("/api/admin/rules/{rule_id}")
def update_rule(rule_id: str, body: RulePatch, admin: dict = Depends(auth.require_admin)):
    mapping = {
        "restrictionType": "restriction_type",
        "condition": "condition",
        "startTime": "start_time",
        "endTime": "end_time",
        "days": "days",
        "active": "active",
    }
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    data = {k: v for k, v in data.items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="Dữ liệu quy định không hợp lệ.")
    sets = ", ".join(f"{mapping[k]} = %s" for k in data)
    vals = list(data.values()) + [rule_id]
    with db.get_conn() as conn:
        row = conn.execute(
            f"UPDATE policy_rule SET {sets} WHERE id = %s RETURNING *", vals
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy quy định.")
    return {"rule": rule_dto(row)}


@router.delete("/api/admin/rules/{rule_id}")
def delete_rule(rule_id: str, admin: dict = Depends(auth.require_admin)):
    with db.get_conn() as conn:
        res = conn.execute(
            "DELETE FROM policy_rule WHERE id = %s RETURNING id", (rule_id,)
        ).fetchone()
    if not res:
        raise HTTPException(status_code=404, detail="Không tìm thấy quy định.")
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
        rows = conn.execute("SELECT * FROM transport_mode ORDER BY sort_order ASC").fetchall()
    return {"modes": [mode_dto(r) for r in rows]}


@router.put("/api/admin/modes")
def update_mode(body: ModeBody, admin: dict = Depends(auth.require_admin)):
    colmap = {
        "name": "name",
        "enabled": "enabled",
        "avgSpeedKmh": "avg_speed_kmh",
        "baseCostVnd": "base_cost_vnd",
        "costPerKmVnd": "cost_per_km_vnd",
        "co2PerKmG": "co2_per_km_g",
        "baseAccessibility": "base_accessibility",
        "baseConvenience": "base_convenience",
        "waitMinutes": "wait_minutes",
    }
    data = body.model_dump(exclude_unset=True)
    updates = {colmap[k]: v for k, v in data.items() if k in colmap and v is not None}
    with db.get_conn() as conn:
        exists = conn.execute(
            "SELECT id FROM transport_mode WHERE id = %s", (body.id,)
        ).fetchone()
        if exists:
            if updates:
                sets = ", ".join(f"{c} = %s" for c in updates)
                conn.execute(
                    f"UPDATE transport_mode SET {sets} WHERE id = %s",
                    list(updates.values()) + [body.id],
                )
        else:
            conn.execute(
                """
                INSERT INTO transport_mode (id, name, description, icon, avg_speed_kmh,
                    base_cost_vnd, cost_per_km_vnd, co2_per_km_g, base_accessibility,
                    base_convenience, wait_minutes, enabled, sort_order)
                VALUES (%s,%s,'','circle-dot',%s,%s,%s,%s,%s,%s,%s,%s,99)
                """,
                (
                    body.id,
                    body.name,
                    updates.get("avg_speed_kmh", 20),
                    updates.get("base_cost_vnd", 0),
                    updates.get("cost_per_km_vnd", 0),
                    updates.get("co2_per_km_g", 0),
                    updates.get("base_accessibility", 0.7),
                    updates.get("base_convenience", 0.7),
                    updates.get("wait_minutes", 0),
                    updates.get("enabled", True),
                ),
            )
        row = conn.execute(
            "SELECT * FROM transport_mode WHERE id = %s", (body.id,)
        ).fetchone()
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
        rows = conn.execute("SELECT * FROM criteria_weight").fetchall()
    return {"weights": [weight_dto(r) for r in rows]}


@router.put("/api/admin/weights")
def update_weights(body: WeightsBody, admin: dict = Depends(auth.require_admin)):
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
                INSERT INTO criteria_weight (id, criterion, weight, label)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (criterion) DO UPDATE SET weight = EXCLUDED.weight
                """,
                (uuid.uuid4().hex, w.criterion, w.weight, w.criterion),
            )
        rows = conn.execute("SELECT * FROM criteria_weight").fetchall()
    return {"weights": [weight_dto(r) for r in rows]}


# ---------------------------------------------------------------- analytics
# Aggregations computed with pandas (proposal: data processing layer).


def _dataset_section() -> dict:
    """US-25: survey-dataset surface for the analytics dashboard.

    Latest dataset_run row +, for the latest month present in dataset_trend,
    one row per mode with share / trend index / sample count (mode display
    name resolved via transport_mode). share is stored 0..1 and reported
    as a percentage (0..100).
    """
    with db.get_conn() as conn:
        run = conn.execute(
            """
            SELECT ran_at, source_file, rows_in, rows_clean
            FROM dataset_run
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

        latest_month = conn.execute(
            "SELECT max(month) AS latest_month FROM dataset_trend"
        ).fetchone()["latest_month"]

        mode_trend: list = []
        if latest_month:
            trend_rows = conn.execute(
                """
                SELECT t.mode_id,
                       COALESCE(tm.name, t.mode_id) AS mode_name,
                       t.share, t.trend_index, t.sample_count
                FROM dataset_trend t
                LEFT JOIN transport_mode tm ON tm.id = t.mode_id
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

    return {"lastRun": last_run, "latestMonth": latest_month, "modeTrend": mode_trend}


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
            "SELECT * FROM transport_mode ORDER BY sort_order ASC"
        ).fetchall()
        # US-29/35: aggregate the WHOLE selected date range (no LIMIT).
        rows = conn.execute(
            """
            SELECT * FROM trip_record
            WHERE created_at >= %s AND created_at <= %s
            ORDER BY created_at DESC
            """,
            (from_, to),
        ).fetchall()

    mode_names = {m["id"]: m["name"] for m in modes}
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
def reprocess_dataset(admin: dict = Depends(auth.require_admin)):
    """Re-run the pandas "Vehicle at Ha Noi Dataset" pipeline."""
    from ..services import trend

    return trend.run_pipeline()
