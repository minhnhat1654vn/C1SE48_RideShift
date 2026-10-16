"""Recommendation v2 — tính raw 7 tiêu chí từ schema v2, chạy TOPSIS (mcdm.py,
thuần numpy) và LƯU VẾT đầy đủ: recommendation_runs -> recommendation_scores
(mỗi mode × tiêu chí) -> recommendation_scores.final_score/rank_position (của
MODE, theo thiết kế thầy) -> impact_assessments (current vs đề xuất).

Trend: tính on-the-fly từ survey.vehicle_survey_responses (tỉ lệ người khảo sát
MUỐN chuyển sang mode so với đang dùng); bảng trống -> 0.5 trung tính.
"""
from __future__ import annotations

from datetime import datetime

from app.services import mcdm
from app.services.compliance_v2 import CONDITIONAL, COMPLIANT, NOT_COMPLIANT, evaluate_vehicle

# map tiêu chí v2 (code trong DB) <-> khóa của mcdm.topsis (v1, camelCase)
CRITERIA_KEY = {
    "TRAVEL_TIME": "travelTime",
    "COST": "cost",
    "LEZ_COMPLIANCE": "lezCompliance",
    "ACCESSIBILITY": "accessibility",
    "CONVENIENCE": "convenience",
    "ENVIRONMENT": "environment",
    "SURVEY_TREND": "trend",
}
SCORE_3 = {COMPLIANT: 1.0, CONDITIONAL: 0.5, NOT_COMPLIANT: 0.0}


def _trend_by_mode(conn) -> dict[int, float]:
    rows = conn.execute(
        """
        SELECT m.transportation_mode_id AS mid,
               count(*) FILTER (WHERE r.preferred_mode_id = m.transportation_mode_id) AS want,
               count(*) AS total
        FROM survey.vehicle_survey_responses r
        JOIN transportation.transportation_modes m
          ON m.transportation_mode_id IN (r.current_mode_id, r.preferred_mode_id)
        WHERE r.is_valid
        GROUP BY m.transportation_mode_id
        """
    ).fetchall()
    # tỉ lệ "muốn chuyển sang mode" trên tổng lượt nhắc đến mode
    out: dict[int, float] = {}
    for r in rows:
        out[r["mid"]] = (r["want"] / r["total"]) if r["total"] else 0.5
    return out


def _guest_weight_multiplier(prefs: dict | None) -> dict[str, float]:
    """Ưu tiên của Guest (0-100, mặc định 50) nhân vào trọng số tiêu chí tương ứng."""
    p = prefs or {}
    base = 50.0
    return {
        "travelTime": max((p.get("fastest") or base), 5) / base,
        "cost": max((p.get("cheapest") or base), 5) / base,
        "environment": max((p.get("eco") or base), 5) / base,
        "convenience": max((p.get("comfort") or base), 5) / base,
        "lezCompliance": 1.0,
        "accessibility": 1.0,
        "trend": 1.0,
    }


def compute_and_persist(
    conn,
    *,
    trip_id: int,
    distance_m: float,
    duration_sec_by_profile: dict[str, int],
    travel_time: datetime,
    current_vehicle_type_id: int,
    preferences: dict | None,
) -> list[dict]:
    """Chấm điểm mọi mode ACTIVE, lưu runs/scores, trả về danh sách khuyến nghị."""
    modes = conn.execute(
        "SELECT * FROM transportation.transportation_modes WHERE is_active "
        "ORDER BY transportation_mode_id"
    ).fetchall()
    criteria = conn.execute(
        "SELECT * FROM decision.recommendation_criteria WHERE status = 'ACTIVE' "
        "ORDER BY criteria_id"
    ).fetchall()
    vtypes = {
        r["vehicle_type_id"]: r
        for r in conn.execute("SELECT * FROM policy.vehicle_types").fetchall()
    }
    trend = _trend_by_mode(conn)
    mult = _guest_weight_multiplier(preferences)

    km = distance_m / 1000.0
    alternatives: list[dict] = []
    mode_compliance: dict[int, dict] = {}

    for m in modes:
        profile = m["routing_profile"]
        duration = duration_sec_by_profile.get(profile)
        if duration is None:  # profile chưa có route (không nên xảy ra với 3 profile chuẩn)
            continue
        travel_min = duration / 60.0 * float(m["speed_factor"]) + float(m["avg_wait_min"])
        cost_vnd = float(m["base_fare"]) + float(m["cost_per_km"]) * km

        # compliance của mode = compliance của loại xe đại diện (is_default)
        vt = next(
            (v for v in vtypes.values()
             if v["transportation_mode_id"] == m["transportation_mode_id"] and v["is_default"]),
            None,
        )
        crossed = conn.execute(
            """SELECT z.lez_zone_id FROM trip.trip_lez_analysis a
               JOIN policy.lez_zones z ON z.lez_zone_id = a.lez_zone_id
               WHERE a.route_id = (SELECT route_id FROM trip.trip_routes
                                   WHERE trip_id = %s AND routing_profile = %s
                                   ORDER BY route_index LIMIT 1)
                 AND a.intersects""",
            (trip_id, profile),
        ).fetchall()
        crossed_ids = [r["lez_zone_id"] for r in crossed]
        comp = (
            evaluate_vehicle(conn, crossed_ids, travel_time, vt["vehicle_type_id"])
            if vt else {"status": CONDITIONAL, "reason": None, "rules": []}
        )
        mode_compliance[m["transportation_mode_id"]] = comp

        # ENVIRONMENT dùng emission_level của loại xe đại diện (0..9, cao = sạch)
        env_level = float(vt["emission_level"]) if vt else 0.0

        alternatives.append({
            "id": m["transportation_mode_id"],
            "name": m["name"],
            "vehicleTypeId": vt["vehicle_type_id"] if vt else None,
            "raw": {
                "travelTime": travel_min,
                "cost": cost_vnd,
                "lezCompliance": SCORE_3[comp["status"]],
                "accessibility": float(m["accessibility_score"] or 3),
                "convenience": float(m["convenience_score"] or 3),
                "environment": env_level,
                "trend": trend.get(m["transportation_mode_id"], 0.5),
            },
            "travelTimeMin": travel_min,
            "costVnd": cost_vnd,
            "compliance": comp,
        })

    # trọng số: default_weight (0-1) x hệ số ưu tiên Guest, chuẩn hóa lại tổng 1
    weights: dict[str, float] = {}
    total = 0.0
    for c in criteria:
        key = CRITERIA_KEY[c["code"]]
        w = float(c["default_weight"]) * mult.get(key, 1.0)
        weights[key] = max(w, 0.0)
        total += weights[key]
    if total <= 0:
        total = 1.0
    for k in weights:
        weights[k] /= total

    ranked = mcdm.topsis(alternatives, weights)

    # ---- persist: runs -> scores -> impact ----
    import time as _time
    t0 = _time.perf_counter()
    run = conn.execute(
        """INSERT INTO decision.recommendation_runs (trip_id, algorithm, status, completed_at)
           VALUES (%s, 'TOPSIS', 'COMPLETED', now()) RETURNING recommendation_run_id""",
        (trip_id,),
    ).fetchone()
    run_id = run["recommendation_run_id"]

    criteria_id_by_key = {CRITERIA_KEY[c["code"]]: c["criteria_id"] for c in criteria}
    for item in ranked:
        alt = next(a for a in alternatives if a["id"] == item["id"])
        for c in criteria:
            key = CRITERIA_KEY[c["code"]]
            conn.execute(
                """INSERT INTO decision.recommendation_scores
                     (recommendation_run_id, transportation_mode_id, criteria_id,
                      raw_value, normalized_value, weight, weighted_score, final_score, rank_position)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    run_id, item["id"], criteria_id_by_key[key],
                    alt["raw"][key], item["normalized"][key],
                    weights[key], item["contributions"][key],
                    item["score"], item["rank"],
                ),
            )
    duration_ms = int((_time.perf_counter() - t0) * 1000)
    conn.execute(
        "UPDATE decision.recommendation_runs SET duration_ms = %s WHERE recommendation_run_id = %s",
        (duration_ms, run_id),
    )

    current_mode_id = (
        vtypes[current_vehicle_type_id]["transportation_mode_id"]
        if current_vehicle_type_id in vtypes else None
    )
    best = ranked[0]
    best_mode = best["id"]
    alt_mode = best_mode if best_mode != current_mode_id else next(
        (r["id"] for r in ranked if r["id"] != current_mode_id), None
    )
    if alt_mode is not None and current_mode_id is not None:
        cur = next(a for a in alternatives if a["id"] == current_mode_id)
        alt = next(a for a in alternatives if a["id"] == alt_mode)
        conn.execute(
            """INSERT INTO decision.impact_assessments
                 (trip_id, recommendation_run_id, current_transportation_mode_id,
                  alternative_transportation_mode_id, current_time_min, alternative_time_min,
                  current_cost, alternative_cost, current_compliance_status,
                  alternative_compliance_status, current_score, alternative_score)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                trip_id, run_id, current_mode_id, alt_mode,
                cur["travelTimeMin"], alt["travelTimeMin"],
                cur["costVnd"], alt["costVnd"],
                mode_compliance[current_mode_id]["status"],
                mode_compliance[alt_mode]["status"],
                cur_rank_score(cur["id"], ranked), cur_rank_score(alt_mode, ranked),
            ),
        )

    # gắn thêm thông tin hiển thị vào kết quả trả về
    for item in ranked:
        alt = next(a for a in alternatives if a["id"] == item["id"])
        item["vehicleTypeId"] = alt["vehicleTypeId"]
        item["travelTimeMin"] = alt["travelTimeMin"]
        item["costVnd"] = alt["costVnd"]
        item["compliance"] = alt["compliance"]
    return ranked


def cur_rank_score(mode_id: int, ranked: list[dict]) -> float:
    return next((r["score"] for r in ranked if r["id"] == mode_id), 0.0)
