"""Shared constants ported from the frontend contract (src/lib/types.ts)."""
from typing import Dict

CRITERIA = [
    "travelTime",
    "cost",
    "lezCompliance",
    "accessibility",
    "convenience",
    "environment",
    "trend",
]

CRITERION_LABELS: Dict[str, str] = {
    "travelTime": "Thời gian di chuyển",
    "cost": "Chi phí ước tính",
    "lezCompliance": "Tuân thủ LEZ",
    "accessibility": "Khả năng tiếp cận",
    "convenience": "Thuận tiện",
    "environment": "Tác động môi trường",
    "trend": "Xu hướng khảo sát",
}

# Convenience / accessibility modifiers per trip purpose (behavioral context, US-09)
PURPOSE_CONVENIENCE: Dict[str, Dict[str, float]] = {
    "work": {"gasoline_motorbike": 0.08, "electric_motorbike": 0.06, "private_car": 0.04, "bus": -0.05, "taxi": 0.03, "bicycle": -0.02, "walking": -0.08},
    "school": {"gasoline_motorbike": 0.05, "electric_motorbike": 0.05, "private_car": -0.05, "bus": 0.12, "taxi": -0.02, "bicycle": 0.06, "walking": 0.02},
    "shopping": {"gasoline_motorbike": 0.04, "electric_motorbike": 0.03, "private_car": 0.08, "bus": -0.03, "taxi": 0.1, "bicycle": 0.0, "walking": 0.02},
    "leisure": {"gasoline_motorbike": 0.0, "electric_motorbike": 0.04, "private_car": -0.02, "bus": 0.05, "taxi": 0.08, "bicycle": 0.12, "walking": 0.1},
    "other": {},
}

# Fallback trend priors used when the pandas dataset pipeline has not run yet
# (survey-derived "Vehicle at Ha Noi Dataset" baseline)
TREND_PRIOR: Dict[str, float] = {
    "gasoline_motorbike": 0.62,
    "electric_motorbike": 0.14,
    "private_car": 0.1,
    "bus": 0.08,
    "taxi": 0.04,
    "bicycle": 0.01,
    "walking": 0.01,
}

DAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

HANOI_DISTRICTS = [
    "Hoan Kiem", "Ba Dinh", "Dong Da", "Hai Ba Trung", "Cau Giay",
    "Thanh Xuan", "Tay Ho", "Ha Dong", "Nam Tu Liem", "Hoang Mai",
    "Long Bien", "Soc Son", "Dong Anh",
]


def guess_district(name) -> str:
    n = (name or "").lower()
    for d in HANOI_DISTRICTS:
        if d.lower() in n:
            return d
    return "Central Hanoi"


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def fmt_vi_vnd(v: float) -> str:
    """Format like JS toLocaleString('vi-VN'): 12500 -> '12.500'."""
    return f"{v:,.0f}".replace(",", ".")
