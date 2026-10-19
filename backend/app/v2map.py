"""V1↔V2 mapping layer — nơi DUY NHẤT dịch vocabulary giữa UI v1 và DB v2.

Bối cảnh Task 51: UI v1 giữ nguyên (contract camelCase), dữ liệu chuyển sang
schema v2 (22 bảng / 7 schema). Một số tham số của transport_mode v1 không có
cột tương ứng trong v2 (icon, sort_order, co2_per_km_g, avg_speed_kmh) — các
giá trị này được SUY RA ở lớp DTO theo bảng dưới đây và được ghi rõ:

- icon / sort_order      : hằng số hiển thị theo code (giữ nguyên seed v1).
- avg_speed_kmh          : suy ra từ routing_profile + speed_factor của v2
                           (thời gian = quãng đường / tốc độ; speed_factor
                           lớn = chậm hơn OSRM mặc định).
- co2_per_km_g           : bảng hiệu chuẩn demo theo code (mức phát thải
                           capabilities của v2 là emission_level ordinal —
                           không có g/km; xem policy.vehicle_types).
"""
from typing import Dict, List, Optional

# ---------------------------------------------------------------- criteria
CRIT_V1_TO_V2 = {
    "travelTime": "TRAVEL_TIME",
    "cost": "COST",
    "lezCompliance": "LEZ_COMPLIANCE",
    "accessibility": "ACCESSIBILITY",
    "convenience": "CONVENIENCE",
    "environment": "ENVIRONMENT",
    "trend": "SURVEY_TREND",
}
CRIT_V2_TO_V1 = {v: k for k, v in CRIT_V1_TO_V2.items()}

# ---------------------------------------------------------------- modes
ICON_BY_CODE: Dict[str, str] = {
    "gasoline_motorbike": "motorbike",
    "electric_motorbike": "zap",
    "private_car": "car",
    "bus": "bus",
    "taxi": "car-taxi-front",
    "bicycle": "bike",
    "walking": "footprints",
}
SORT_ORDER_BY_CODE: Dict[str, int] = {
    "gasoline_motorbike": 1,
    "electric_motorbike": 2,
    "private_car": 3,
    "bus": 4,
    "taxi": 5,
    "bicycle": 6,
    "walking": 7,
}

# Tốc độ cơ sở theo routing profile (km/h, đô thị Hà Nội — seed v1):
BASE_SPEED_BY_PROFILE: Dict[str, float] = {"car": 22.08, "bike": 12.0, "foot": 4.5}

# Hiệu chuẩn CO₂ demo (g/km) theo mode code — giữ nguyên số của seed v1.
EMISSION_G_BY_CODE: Dict[str, float] = {
    "gasoline_motorbike": 113,
    "electric_motorbike": 18,
    "private_car": 168,
    "bus": 42,
    "taxi": 150,
    "bicycle": 0,
    "walking": 0,
}
# Fallback theo emission_level (policy.vehicle_types) cho mode mới tạo:
EMISSION_G_BY_LEVEL: Dict[int, float] = {
    0: 170.0, 1: 150.0, 2: 130.0, 3: 113.0,
    4: 90.0, 5: 60.0, 6: 45.0, 7: 30.0, 8: 15.0, 9: 0.0,
}

# ---------------------------------------------------------------- days
DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]  # ISO 1..7
DAY_TO_ISO = {d: i + 1 for i, d in enumerate(DAY_KEYS)}
ISO_TO_DAY = {i + 1: d for i, d in enumerate(DAY_KEYS)}


def days_v1_to_iso(days: str) -> List[int]:
    """'Mon,Tue,...' (UI v1) -> [1..7] (policy.lez_rules.days_of_week)."""
    out = []
    for part in (days or "").split(","):
        d = part.strip()[:3].title()
        if d in DAY_TO_ISO:
            out.append(DAY_TO_ISO[d])
    return sorted(set(out)) or [1, 2, 3, 4, 5, 6, 7]


def days_iso_to_v1(days) -> str:
    """[1..7] -> 'Mon,Tue,...'."""
    try:
        vals = sorted({int(d) for d in (days or []) if 1 <= int(d) <= 7})
    except Exception:
        return "Mon,Tue,Wed,Thu,Fri,Sat,Sun"
    if not vals:
        vals = [1, 2, 3, 4, 5, 6, 7]
    return ",".join(ISO_TO_DAY[v] for v in vals)


# ---------------------------------------------------------------- rules
RESTRICTION_V1_TO_V2 = {"banned": "PROHIBITED", "conditional": "CONDITIONAL"}
RESTRICTION_V2_TO_V1 = {"PROHIBITED": "banned", "CONDITIONAL": "conditional"}
# Thứ tự "mạnh dần" khi một mode có nhiều restriction (nhiều vehicle_types):
RESTRICTION_STRENGTH = {"PROHIBITED": 2, "CONDITIONAL": 1, "ALLOWED": 0}


def hhmm(time_value) -> str:
    """TIME của DB -> 'HH:MM' cho UI v1."""
    s = str(time_value or "00:00")
    return s[:5]


def parse_hhmm(s: str) -> int:
    try:
        h, m = s.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return 0


# ---------------------------------------------------------------- helpers
def mode_avg_speed(row: dict) -> float:
    """avg_speed_kmh suy ra từ routing_profile + speed_factor (v2)."""
    profile = row.get("routing_profile") or "car"
    factor = float(row.get("speed_factor") or 1.0)
    base = BASE_SPEED_BY_PROFILE.get(profile, BASE_SPEED_BY_PROFILE["car"])
    return round(base / max(factor, 0.05), 2)


def mode_co2_per_km(code: str, emission_level: Optional[int] = None) -> float:
    if code in EMISSION_G_BY_CODE:
        return float(EMISSION_G_BY_CODE[code])
    try:
        return EMISSION_G_BY_LEVEL.get(int(emission_level or 0), 170.0)
    except Exception:
        return 170.0


def mode_icon(code: str) -> str:
    return ICON_BY_CODE.get(code, "circle-dot")


def mode_sort_order(code: str, fallback: int = 99) -> int:
    return SORT_ORDER_BY_CODE.get(code, fallback)
