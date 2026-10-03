"""pandas survey-data pipeline — "Vehicle at Ha Noi Dataset" processing.

Proposal alignment (Deliverable #11 — Processed Survey Dataset, and the
"trend" criterion of the MCDM model):

1. LOAD    data/vehicle_at_hanoi.csv (real Kaggle export or the scaffold)
2. CLEAN   dropna, dedupe, normalize mode labels, clip implausible values
3. ENGINEER per-trip features (speed, cost per km, emission-relevant cohort)
4. AGGREGATE monthly mode shares + per-mode descriptive stats
5. TREND    growth = normalized slope of each mode's monthly share (numpy
            polyfit); adoption = normalized overall share;
            trend_index = 0.6*adoption + 0.4*growth  (0..1, higher = better)
6. PERSIST  processed CSVs under data/processed + dataset_trend/dataset_run
            tables in PostgreSQL (consumed by /api/trip/analyze)
"""
import json
import uuid
from pathlib import Path
from typing import Dict, Optional

import numpy as np
import pandas as pd

from .. import config, constants, db

MODE_LABEL_TO_ID = {
    "gasoline motorbike": "gasoline_motorbike",
    "electric motorbike": "electric_motorbike",
    "private car": "private_car",
    "bus": "bus",
    "taxi/ride-hailing": "taxi",
    "taxi": "taxi",
    "bicycle": "bicycle",
    "walking": "walking",
    "walk": "walking",
}

_latest_cache: Optional[Dict[str, float]] = None


# ---------------------------------------------------------------- pipeline

def load_and_clean(csv_path: Path) -> tuple[pd.DataFrame, int]:
    raw = pd.read_csv(csv_path)
    rows_in = len(raw)

    df = raw.copy()
    df.columns = [c.strip() for c in df.columns]
    df = df.dropna(subset=["survey_month", "main_mode", "distance_km"])
    df = df.drop_duplicates(subset=["respondent_id", "survey_month", "main_mode", "distance_km"])

    df["mode_id"] = (
        df["main_mode"].astype(str).str.strip().str.lower().map(MODE_LABEL_TO_ID)
    )
    df = df.dropna(subset=["mode_id"])

    df["distance_km"] = pd.to_numeric(df["distance_km"], errors="coerce")
    df = df.dropna(subset=["distance_km"])
    df = df[(df["distance_km"] > 0) & (df["distance_km"] <= 80)]
    df["distance_km"] = df["distance_km"].clip(lower=0.2, upper=60)

    if "trip_duration_min" in df.columns:
        df["trip_duration_min"] = pd.to_numeric(df["trip_duration_min"], errors="coerce")
        df.loc[df["trip_duration_min"] <= 0, "trip_duration_min"] = np.nan
        df["avg_speed_kmh"] = df["distance_km"] / (df["trip_duration_min"] / 60)
        df["avg_speed_kmh"] = df["avg_speed_kmh"].clip(upper=90)
    else:
        df["avg_speed_kmh"] = np.nan

    if "out_of_pocket_cost_vnd" in df.columns:
        df["out_of_pocket_cost_vnd"] = pd.to_numeric(
            df["out_of_pocket_cost_vnd"], errors="coerce"
        ).fillna(0).clip(lower=0)
        df["cost_per_km_vnd"] = df["out_of_pocket_cost_vnd"] / df["distance_km"]
    else:
        df["cost_per_km_vnd"] = np.nan

    df["survey_period"] = pd.PeriodIndex(df["survey_month"].astype(str), freq="M")
    return df, rows_in


def run_pipeline() -> dict:
    """Process the dataset end-to-end; returns a run report."""
    csv_path = _ensure_dataset()
    PROCESSED = config.PROCESSED_DIR
    PROCESSED.mkdir(parents=True, exist_ok=True)

    df, rows_in = load_and_clean(csv_path)
    rows_clean = len(df)

    # ---- monthly mode shares -------------------------------------------
    monthly = (
        df.groupby(["survey_period", "mode_id"]).size().unstack(fill_value=0)
    )
    share = monthly.div(monthly.sum(axis=1), axis=0)  # 0..1 per month

    modes = [m for m in share.columns]
    months_idx = np.arange(len(share.index))

    # ---- growth: OLS slope of share over months, min-max normalized -----
    slopes: Dict[str, float] = {}
    for m in modes:
        y = share[m].to_numpy(dtype=float)
        if len(y) >= 2 and np.ptp(y) > 0:
            slopes[m] = float(np.polyfit(months_idx, y, 1)[0])
        else:
            slopes[m] = 0.0

    # ---- adoption: overall share over the whole window ------------------
    overall_share = (monthly.sum(axis=0) / monthly.values.sum()).to_dict()

    def minmax(d: Dict[str, float]) -> Dict[str, float]:
        vals = list(d.values())
        lo, hi = min(vals), max(vals)
        if hi - lo < 1e-12:
            return {k: 0.5 for k in d}
        return {k: (v - lo) / (hi - lo) for k, v in d.items()}

    growth_n = minmax(slopes)
    adoption_n = minmax(overall_share)

    trend_index = {
        m: float(constants.clamp01(0.6 * adoption_n[m] + 0.4 * growth_n[m]))
        for m in modes
    }

    # ---- per-mode descriptive stats --------------------------------------
    stats = (
        df.groupby("mode_id")
        .agg(
            trips=("mode_id", "size"),
            avg_distance_km=("distance_km", "mean"),
            avg_speed_kmh=("avg_speed_kmh", "mean"),
            avg_cost_per_km=("cost_per_km_vnd", "mean"),
        )
        .round(3)
    )

    # ---- persist processed outputs (Deliverable #11 artifacts) -----------
    df.drop(columns=["survey_period"]).to_csv(PROCESSED / "processed_trips.csv", index=False)

    trend_rows = []
    for mi, period in enumerate(share.index):
        for m in modes:
            trend_rows.append(
                {
                    "month": str(period),
                    "mode_id": m,
                    "share": float(share.loc[period, m]),
                    "trend_index": trend_index[m],
                    "growth_slope": slopes[m],
                }
            )
    pd.DataFrame(trend_rows).to_csv(PROCESSED / "mode_trend.csv", index=False)
    stats.reset_index().to_csv(PROCESSED / "mode_stats.csv", index=False)

    # ---- persist to PostgreSQL -------------------------------------------
    with db.get_conn() as conn:
        conn.execute("DELETE FROM dataset_trend")
        for r in trend_rows:
            conn.execute(
                """
                INSERT INTO dataset_trend (id, mode_id, month, share, trend_index, sample_count)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    uuid.uuid4().hex,
                    r["mode_id"],
                    r["month"],
                    r["share"],
                    r["trend_index"],
                    int(monthly.loc[r["month"], r["mode_id"]]),
                ),
            )
        conn.execute(
            """
            INSERT INTO dataset_run (id, source_file, rows_in, rows_clean, notes)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (
                uuid.uuid4().hex,
                str(csv_path),
                rows_in,
                rows_clean,
                json.dumps({"modes": len(modes), "months": len(share.index)}),
            ),
        )

    global _latest_cache
    _latest_cache = None  # invalidate

    return {
        "sourceFile": csv_path.name,
        "rowsIn": rows_in,
        "rowsClean": rows_clean,
        "months": [str(p) for p in share.index],
        "modes": modes,
        "trendIndex": trend_index,
        "overallShare": {m: float(overall_share.get(m, 0.0)) for m in modes},
        "growthSlope": slopes,
    }


def _ensure_dataset() -> Path:
    if config.DATASET_CSV.exists():
        return config.DATASET_CSV
    # generate the scaffold via the tools module
    import sys

    sys.path.insert(0, str(config.BASE_DIR))
    from tools.make_dataset import ensure_dataset

    return ensure_dataset()


# ---------------------------------------------------------------- consumers

def latest_trend_map() -> Dict[str, float]:
    """Latest trend index per mode from the pipeline output (or priors)."""
    global _latest_cache
    if _latest_cache is not None:
        return _latest_cache
    result: Dict[str, float] = {}
    try:
        with db.get_conn() as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT ON (mode_id) mode_id, trend_index
                FROM dataset_trend ORDER BY mode_id, month DESC
                """
            ).fetchall()
            result = {r["mode_id"]: float(r["trend_index"]) for r in rows}
    except Exception:
        result = {}
    _latest_cache = result or dict(constants.TREND_PRIOR)
    return _latest_cache


def trend_value(mode_id: str) -> float:
    return latest_trend_map().get(mode_id, constants.TREND_PRIOR.get(mode_id, 0.01))


def dataset_summary() -> dict:
    """JSON payload for GET /api/dataset/summary (pandas showcase)."""
    report = run_pipeline()
    csv_path = config.DATASET_CSV
    df, _ = load_and_clean(csv_path)

    monthly = (
        df.groupby(["survey_period", "mode_id"]).size().unstack(fill_value=0)
    )
    share = monthly.div(monthly.sum(axis=1), axis=0)
    monthly_payload = [
        {
            "month": str(period),
            "shares": {m: round(float(share.loc[period, m]), 4) for m in share.columns},
        }
        for period in share.index
    ]

    stats = (
        df.groupby("mode_id")
        .agg(
            trips=("mode_id", "size"),
            avg_distance_km=("distance_km", "mean"),
            avg_cost_per_km=("cost_per_km_vnd", "mean"),
        )
        .round(3)
        .to_dict(orient="index")
    )

    last_run = None
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT ran_at, source_file, rows_in, rows_clean FROM dataset_run ORDER BY ran_at DESC LIMIT 1"
        ).fetchone()
        if row:
            from ..dto import iso_z

            last_run = {
                "ranAt": iso_z(row["ran_at"]),
                "sourceFile": row["source_file"],
                "rowsIn": row["rows_in"],
                "rowsClean": row["rows_clean"],
            }

    return {
        "dataset": {
            "name": "Vehicle at Ha Noi Dataset",
            "sourceFile": csv_path.name,
            "rowsIn": report["rowsIn"],
            "rowsClean": report["rowsClean"],
            "period": {
                "from": report["months"][0] if report["months"] else None,
                "to": report["months"][-1] if report["months"] else None,
            },
            "lastRun": last_run,
            "processedFiles": [
                "processed_trips.csv",
                "mode_trend.csv",
                "mode_stats.csv",
            ],
        },
        "modes": [
            {
                "modeId": m,
                "overallShare": round(report["overallShare"].get(m, 0.0), 4),
                "trendIndex": round(report["trendIndex"].get(m, 0.0), 4),
                "growthSlopePerMonth": round(report["growthSlope"].get(m, 0.0), 6),
                "stats": stats.get(m, {}),
            }
            for m in report["modes"]
        ],
        "monthlyShares": monthly_payload,
    }


if __name__ == "__main__":
    report = run_pipeline()
    print(json.dumps(report, indent=2))
