"""Survey dataset generator — scaffolds the "Vehicle at Ha Noi Dataset".

The processing pipeline (app/services/trend.py) prefers a real CSV placed at
data/vehicle_at_hanoi.csv (e.g. the Kaggle "Vehicle at Ha Noi" survey export).
When that file is absent, this generator creates a realistic, deterministic
Hanoi travel-survey scaffold (2,400 respondents, 24 months, evolving mode
shares) so the pandas pipeline and the trend criterion are fully runnable.

Drop in the real CSV (same columns) and re-run the pipeline — nothing else
in the stack changes.
"""
import random
from pathlib import Path

import pandas as pd

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"
CSV = DATA / "vehicle_at_hanoi.csv"

DISTRICTS = [
    "Hoan Kiem", "Ba Dinh", "Dong Da", "Hai Ba Trung", "Cau Giay",
    "Thanh Xuan", "Tay Ho", "Ha Dong", "Nam Tu Liem", "Hoang Mai", "Long Bien",
]
PURPOSES = ["work", "school", "shopping", "leisure", "other"]

# Monthly mode-share trajectory (Hanoi 2023-01 .. 2024-12, 24 months).
# Tells the story the proposal assumes: motorbikes slowly decline as electric
# two-wheelers and public transport gain adoption.
START_SHARES = {
    "gasoline_motorbike": 0.660,
    "electric_motorbike": 0.090,
    "private_car": 0.100,
    "bus": 0.070,
    "taxi": 0.050,
    "bicycle": 0.012,
    "walking": 0.018,
}
END_SHARES = {
    "gasoline_motorbike": 0.560,
    "electric_motorbike": 0.190,
    "private_car": 0.100,
    "bus": 0.090,
    "taxi": 0.045,
    "bicycle": 0.016,
    "walking": 0.019,
}
# Euro standard cohort probability shifts with time (pre-2015 vs 2015+ etc.)
AVG_SPEED = {
    "gasoline_motorbike": 24, "electric_motorbike": 23, "private_car": 22,
    "bus": 17, "taxi": 26, "bicycle": 12, "walking": 4.5,
}
MODE_LABEL = {
    "gasoline_motorbike": "Gasoline motorbike",
    "electric_motorbike": "Electric motorbike",
    "private_car": "Private car",
    "bus": "Bus",
    "taxi": "Taxi/ride-hailing",
    "bicycle": "Bicycle",
    "walking": "Walking",
}


def _month_share(mode: str, t: float) -> float:
    return START_SHARES[mode] + (END_SHARES[mode] - START_SHARES[mode]) * t


def generate(rows: int = 2400, seed: int = 48) -> pd.DataFrame:
    rng = random.Random(seed)
    months = pd.period_range("2023-01", "2024-12", freq="M")
    per_month = rows // len(months)
    records = []
    respondent = 0
    for mi, month in enumerate(months):
        t = mi / (len(months) - 1)
        shares = {m: _month_share(m, t) for m in START_SHARES}
        total = sum(shares.values())
        shares = {m: s / total for m, s in shares.items()}
        for _ in range(per_month):
            respondent += 1
            u = rng.random()
            acc = 0.0
            mode = "gasoline_motorbike"
            for m, s in shares.items():
                acc += s
                if u <= acc:
                    mode = m
                    break
            district = rng.choice(DISTRICTS)
            purpose = rng.choices(
                PURPOSES, weights=[0.42, 0.20, 0.16, 0.16, 0.06]
            )[0]
            distance = round(rng.uniform(0.5, 18) ** 0.9, 2)
            speed = AVG_SPEED[mode] * rng.uniform(0.75, 1.25)
            duration = max(3, round(distance / speed * 60 * rng.uniform(0.9, 1.3)))
            if mode == "taxi":
                cost = int(11000 + 12500 * distance * rng.uniform(0.9, 1.15))
            elif mode == "private_car":
                cost = int(5000 + 850 * distance)
            elif mode == "gasoline_motorbike":
                cost = int(320 * distance * rng.uniform(0.85, 1.2))
            elif mode == "electric_motorbike":
                cost = int(120 * distance * rng.uniform(0.85, 1.2))
            elif mode == "bus":
                cost = 7000 if rng.random() < 0.85 else 9000
            else:
                cost = 0
            if mode in ("gasoline_motorbike",):
                euro = rng.choice(["pre-2015", "pre-2015", "2015+", "2015+"])
            elif mode == "private_car":
                euro = rng.choice(["pre-2018", "2018+", "2018+"])
            elif mode in ("electric_motorbike", "bicycle", "walking", "bus", "taxi"):
                euro = "n/a"
            else:
                euro = "n/a"
            satisfaction = rng.randint(1, 5)
            records.append(
                {
                    "respondent_id": f"HN-{respondent:05d}",
                    "survey_month": str(month),
                    "district": district,
                    "trip_purpose": purpose,
                    "main_mode": MODE_LABEL[mode],
                    "distance_km": distance,
                    "trip_duration_min": duration,
                    "out_of_pocket_cost_vnd": cost,
                    "euro_standard_cohort": euro,
                    "satisfaction_1to5": satisfaction,
                }
            )
    return pd.DataFrame(records)


def ensure_dataset() -> Path:
    CSV.parent.mkdir(parents=True, exist_ok=True)
    if not CSV.exists():
        generate().to_csv(CSV, index=False)
    return CSV


if __name__ == "__main__":
    path = ensure_dataset()
    df = pd.read_csv(CSV)
    print(f"Dataset ready: {path} ({len(df)} rows)")
