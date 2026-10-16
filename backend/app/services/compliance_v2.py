"""Đánh giá tuân thủ LEZ theo schema v2 — logic ghi trong comment của
policy.vehicle_restrictions (nhóm đã thiết kế):

  Không có rule đang hiệu lực hoặc không có dòng restriction cho loại xe -> COMPLIANT
  ALLOWED                                                              -> COMPLIANT
  PROHIBITED                                                           -> NOT_COMPLIANT
  CONDITIONAL + min_emission_level có giá trị: level xe >= min ? COMPLIANT : NOT_COMPLIANT
  CONDITIONAL + min_emission_level NULL (điều kiện khác, hiển thị restriction_reason) -> CONDITIONAL

Rule chỉ áp dụng khi: status='ACTIVE' VÀ khung giờ chứa thời điểm đi
(hỗ trợ qua nửa đêm: end < start) VÀ ngày trong tuần (ISO 1=Thứ Hai..7=CN)
VÀ ngày hiệu lực (effective_from/to).
"""
from __future__ import annotations

from datetime import datetime

COMPLIANT = "COMPLIANT"
CONDITIONAL = "CONDITIONAL"
NOT_COMPLIANT = "NOT_COMPLIANT"


def rule_applies_at(rule: dict, travel_time: datetime) -> bool:
    """Rule ACTIVE + ngày trong tuần + khung giờ (qua nửa đêm được hỗ trợ) + hiệu lực."""
    if rule["status"] != "ACTIVE":
        return False
    if travel_time.isoweekday() not in (rule["days_of_week"] or []):
        return False
    start, end = rule["start_time"], rule["end_time"]
    t = travel_time.time()
    if start <= end:
        in_window = start <= t <= end
    else:  # qua nửa đêm, vd 22:00 -> 06:00
        in_window = t >= start or t <= end
    if not in_window:
        return False
    d = travel_time.date()
    if rule["effective_from"] and d < rule["effective_from"]:
        return False
    if rule["effective_to"] and d > rule["effective_to"]:
        return False
    return True


def evaluate_restriction(restriction: dict | None, vehicle: dict) -> tuple[str, str | None]:
    """Trả về (status, reason) cho một loại xe với restriction đã cho."""
    if restriction is None:
        return COMPLIANT, None
    rtype = restriction["restriction_type"]
    reason = restriction["restriction_reason"]
    if rtype == "ALLOWED":
        return COMPLIANT, None
    if rtype == "PROHIBITED":
        return NOT_COMPLIANT, reason
    # CONDITIONAL
    min_level = restriction["min_emission_level"]
    if min_level is None:
        return CONDITIONAL, reason
    if (vehicle["emission_level"] or 0) >= min_level:
        return COMPLIANT, None
    return NOT_COMPLIANT, (
        reason or f"Phương tiện đạt chuẩn {vehicle['emission_standard'] or 'không rõ'} "
        f"thấp hơn yêu cầu tối thiểu (Euro {min_level}) của vùng."
    )


def evaluate_vehicle(
    conn,
    crossed_zone_ids: list[int],
    travel_time: datetime,
    vehicle_type_id: int,
) -> dict:
    """Tuân thủ của 1 loại xe đối chiếu các vùng mà tuyến ĐANG đi qua.

    Trả về {"status", "reason", "rules": [rule áp dụng]}. Ưu tiên trạng thái
    xấu nhất nếu nhiều vùng: NOT_COMPLIANT > CONDITIONAL > COMPLIANT.
    """
    vehicle = conn.execute(
        "SELECT vehicle_type_id, emission_level, emission_standard FROM policy.vehicle_types "
        "WHERE vehicle_type_id = %s",
        (vehicle_type_id,),
    ).fetchone()
    if vehicle is None:
        return {"status": CONDITIONAL, "reason": "Loại phương tiện không tồn tại.", "rules": []}

    worst = (COMPLIANT, None)
    applied_rules: list[dict] = []
    order = {COMPLIANT: 0, CONDITIONAL: 1, NOT_COMPLIANT: 2}
    for zid in crossed_zone_ids:
        rules = conn.execute(
            "SELECT * FROM policy.lez_rules WHERE lez_zone_id = %s", (zid,)
        ).fetchall()
        for rule in rules:
            if not rule_applies_at(rule, travel_time):
                continue
            applied_rules.append(rule)
            restriction = conn.execute(
                "SELECT * FROM policy.vehicle_restrictions "
                "WHERE lez_rule_id = %s AND vehicle_type_id = %s",
                (rule["lez_rule_id"], vehicle_type_id),
            ).fetchone()
            status, reason = evaluate_restriction(restriction, vehicle)
            if order[status] > order[worst[0]]:
                worst = (status, reason)
    return {"status": worst[0], "reason": worst[1], "rules": applied_rules}
