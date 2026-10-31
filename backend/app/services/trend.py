"""pandas survey-data pipeline — "Vehicle at Ha Noi Dataset" processing.

Proposal alignment (Deliverable #11 — Processed Survey Dataset, and the
"trend" criterion of the MCDM model):

1. LOAD    data/dataHN.csv — the REAL Kaggle "Vehicle at Ha Noi Dataset"
           (25,590 responses × 58 columns). Fallback: data/vehicle_at_hanoi.csv
           (monthly scaffold) or the generated scaffold itself.
2. CLEAN   dropna, dedupe, normalize mode labels, clip implausible values
3. ENGINEER per-trip features (speed, cost per km when available) plus the
           trend period axis: age cohort for the Kaggle survey (it records no
           date), survey month for the scaffold.
4. PERSIST raw cleaned rows -> decision.vehicle_survey_responses (ERD layer)
5. AGGREGATE per-period mode shares + per-mode descriptive stats
6. TREND    growth = normalized slope of each mode's share across periods
           (numpy polyfit; NEGATED on the cohort axis so a mode popular with
           the young ranks as future-oriented); adoption = normalized overall
           share; trend_index = 0.6*adoption + 0.4*growth  (0..1, higher =
           better future momentum)
7. PERSIST aggregates -> decision.dataset_trends + audit row in
            core.dataset_runs (consumed by /api/trip/analyze + analytics)
"""
import json
from pathlib import Path
from typing import Dict, Optional

import numpy as np
import pandas as pd

from .. import config, constants, db

# scaffold (vehicle_at_hanoi.csv) mode labels -> mode code
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

# Kaggle `vehic` codes -> mode code (dataHN.csv)
KAGGLE_MODE_TO_ID = {
    "moto": "gasoline_motorbike",
    "car": "private_car",
    "ebike": "electric_motorbike",
    "bike": "bicycle",
    "walk": "walking",
    "bus": "bus",
    "taxi": "taxi",
}

# Kaggle `age` cohorts -> sortable period labels (alphabetical == age order)
KAGGLE_COHORT_LABELS = {
    "less_18": "0-17",
    "18_25": "18-25",
    "26_35": "26-35",
    "36_55": "36-55",
    "56_75": "56-75",
    "more_75": "75+",
}

_last_report: Optional[Dict] = None
_latest_cache: Optional[Dict[str, float]] = None


# ---------------------------------------------------------------- loaders

def _clean_common(df: pd.DataFrame) -> pd.DataFrame:
    """Shared post-load cleaning: distance / duration / speed / cost."""
    df["distance_km"] = pd.to_numeric(df["distance_km"], errors="coerce")
    df = df.dropna(subset=["distance_km"])
    df = df[(df["distance_km"] > 0) & (df["distance_km"] <= 80)]
    df["distance_km"] = df["distance_km"].clip(lower=0.2, upper=60)

    df["trip_duration_min"] = pd.to_numeric(df["trip_duration_min"], errors="coerce")
    df.loc[df["trip_duration_min"] <= 0, "trip_duration_min"] = np.nan
    df["avg_speed_kmh"] = df["distance_km"] / (df["trip_duration_min"] / 60)
    df["avg_speed_kmh"] = df["avg_speed_kmh"].clip(upper=90)

    if "out_of_pocket_cost_vnd" in df.columns:
        df["out_of_pocket_cost_vnd"] = (
            pd.to_numeric(df["out_of_pocket_cost_vnd"], errors="coerce")
            .fillna(0)
            .clip(lower=0)
        )
        df["cost_per_km_vnd"] = df["out_of_pocket_cost_vnd"] / df["distance_km"]
    else:
        # the Kaggle survey records no out-of-pocket cost
        df["cost_per_km_vnd"] = np.nan
    return df


def load_and_clean(csv_path: Path) -> tuple[pd.DataFrame, int]:
    """Scaffold loader — monthly survey export (vehicle_at_hanoi.csv)."""
    raw = pd.read_csv(csv_path)
    rows_in = len(raw)

    df = raw.copy()
    df.columns = [str(c).strip() for c in df.columns]
    df = df.dropna(subset=["survey_month", "main_mode", "distance_km"])
    df = df.drop_duplicates(
        subset=["respondent_id", "survey_month", "main_mode", "distance_km"]
    )

    df["mode_id"] = (
        df["main_mode"].astype(str).str.strip().str.lower().map(MODE_LABEL_TO_ID)
    )
    df = df.dropna(subset=["mode_id"])
    df = _clean_common(df)

    df["period"] = pd.PeriodIndex(df["survey_month"].astype(str), freq="M").astype(str)
    return df, rows_in


def load_kaggle(csv_path: Path) -> tuple[pd.DataFrame, int]:
    """Real Kaggle loader — cohort-based survey (dataHN.csv, 58 columns)."""
    raw = pd.read_csv(csv_path)
    rows_in = len(raw)

    df = raw.copy()
    # 'traspeed ' ships with a trailing space in the Kaggle export
    df.columns = [str(c).strip() for c in df.columns]
    df = df.dropna(subset=["vehic", "OD_dist_km", "purp", "age"])
    df = df.drop_duplicates(subset=["rowid"])

    df["mode_id"] = (
        df["vehic"].astype(str).str.strip().str.lower().map(KAGGLE_MODE_TO_ID)
    )
    df = df.dropna(subset=["mode_id"])

    # rename to the canonical column names the shared pipeline expects
    df = df.rename(
        columns={
            "OD_dist_km": "distance_km",
            "travtime": "trip_duration_min",
            "oridist": "district",
            "purp": "trip_purpose",
            "rowid": "respondent_id",
        }
    )
    df = _clean_common(df)

    df["period"] = df["age"].astype(str).str.strip().map(KAGGLE_COHORT_LABELS)
    df = df.dropna(subset=["period"])
    return df, rows_in


def _select_source() -> tuple[Path, str]:
    """(csv_path, period_kind) — Kaggle cohort data first, monthly scaffold second."""
    if config.KAGGLE_CSV.exists():
        return config.KAGGLE_CSV, "cohort"
    return _ensure_dataset(), "month"


def _detect_period_kind(csv_path: Path) -> str:
    """Infer the period axis of an uploaded CSV from its header.

    'vehic' column      -> Kaggle cohort format (age cohorts)
    'survey_month'      -> monthly scaffold format
    anything else       -> assume cohort (Kaggle-like)
    """
    try:
        header = pd.read_csv(csv_path, nrows=0)
        cols = {str(c).strip().lower() for c in header.columns}
        if "vehic" in cols:
            return "cohort"
        if "survey_month" in cols:
            return "month"
    except Exception:  # noqa: BLE001
        pass
    return "cohort"


# ---------------------------------------------------------------- pipeline

def run_pipeline(csv_path: Path | None = None) -> dict:
    """Process the dataset end-to-end; returns a run report.

    `csv_path` defaults to the built-in Kaggle export (`_select_source` falls
    back to the monthly scaffold CSV when the Kaggle file is missing).
    """
    if csv_path is None:
        csv_path, period_kind = _select_source()
    else:
        period_kind = _detect_period_kind(csv_path)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    loader = load_kaggle if period_kind == "cohort" else load_and_clean
    df, rows_in = loader(csv_path)
    rows_clean = len(df)

    with db.get_conn() as conn:
        # Task 86: chốt duy nhất 1 luồng pipeline mỗi lúc. Nguyên nhân bảng
        # Kaggle phình 76.758 = 3 × 25.586: 3 boot song song cùng thấy bảng
        # rỗng (guard ở main.py) rồi cùng insert. Session advisory lock tự
        # nhả khi connection đóng (get_conn finally close) — boot đến sau
        # sẽ chờ, chạy đè bằng DELETE+INSERT nên kết quả cuối luôn đúng số.
        conn.execute("SELECT pg_advisory_lock(14876)")  # 0x3A1C 'RS'
        study_id = db.study_area_id(conn)
        mode_ids = _mode_ids(conn)
        region_ids = {
            r["name"]: int(r["region_id"])
            for r in conn.execute(
                "SELECT region_id, name FROM gis.administrative_regions WHERE study_area_id = %s",
                (study_id,),
            ).fetchall()
        }

        # ---- persist cleaned raw rows (ERD: vehicle_survey_responses) -------
        conn.execute("DELETE FROM decision.vehicle_survey_responses")
        survey_rows = []
        for _, row in df.iterrows():
            d = row.to_dict()
            survey_rows.append(
                (
                    csv_path.name,
                    str(d.get("respondent_id"))[:50] if d.get("respondent_id") is not None else None,
                    study_id,
                    region_ids.get(str(d.get("district"))),
                    str(d.get("district"))[:150] if d.get("district") is not None else None,
                    str(d.get("trip_purpose"))[:50] if d.get("trip_purpose") is not None else None,
                    mode_ids.get(d.get("mode_id")),
                    None,
                    None,
                    float(d["distance_km"]),
                    float(d["trip_duration_min"]) if pd.notna(d.get("trip_duration_min")) else None,
                    json.dumps(
                        {k: (None if pd.isna(v) else v) for k, v in d.items() if k != "period"},
                        default=str,
                    ),
                )
            )
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO decision.vehicle_survey_responses
                    (source_dataset, source_row, study_area_id, region_id, area_label,
                     trip_purpose, current_mode_id, preferred_mode_id, willing_to_switch,
                     trip_distance_km, trip_time_min, raw_data)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                survey_rows,
            )

        # ---- per-period mode shares ----------------------------------------
        monthly = df.groupby(["period", "mode_id"]).size().unstack(fill_value=0)
        share = monthly.div(monthly.sum(axis=1), axis=0)  # 0..1 per period

        modes = list(share.columns)
        periods = sorted(share.index)  # cohorts sort by age, months chronologically
        share = share.loc[periods]
        monthly = monthly.loc[periods]
        periods_idx = np.arange(len(periods))

        # ---- growth: OLS slope of share across periods, min-max normalized --
        # Cohort axis: NEGATED — a mode whose share falls with age is adopted
        # by the young, i.e. the future-oriented one (docs/architecture.md §8).
        growth_sign = -1.0 if period_kind == "cohort" else 1.0
        slopes: Dict[str, float] = {}
        for m in modes:
            y = share[m].to_numpy(dtype=float)
            if len(y) >= 2 and np.ptp(y) > 0:
                slopes[m] = float(growth_sign * np.polyfit(periods_idx, y, 1)[0])
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
        df.drop(columns=["period"]).to_csv(PROCESSED_TRIPS, index=False)

        trend_rows = []
        for p in periods:
            for m in modes:
                trend_rows.append(
                    {
                        "period": str(p),
                        "mode_id": m,
                        "share": float(share.loc[p, m]),
                        "trend_index": trend_index[m],
                        "growth_slope": slopes[m],
                    }
                )
        pd.DataFrame(trend_rows).to_csv(PROCESSED_TREND, index=False)
        stats.reset_index().to_csv(PROCESSED_STATS, index=False)

        # ---- persist aggregates to PostgreSQL --------------------------------
        conn.execute("DELETE FROM decision.dataset_trends")
        for r in trend_rows:
            conn.execute(
                """
                INSERT INTO decision.dataset_trends
                    (transportation_mode_id, month, share, trend_index, sample_count)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (transportation_mode_id, month) DO UPDATE SET
                    share = EXCLUDED.share, trend_index = EXCLUDED.trend_index,
                    sample_count = EXCLUDED.sample_count
                """,
                (
                    mode_ids.get(r["mode_id"]),
                    r["period"],
                    r["share"],
                    r["trend_index"],
                    int(monthly.loc[r["period"], r["mode_id"]]),
                ),
            )
        conn.execute(
            """
            INSERT INTO core.dataset_runs (source_file, rows_in, rows_clean, notes)
            VALUES (%s, %s, %s, %s)
            """,
            (
                str(csv_path),
                rows_in,
                rows_clean,
                json.dumps(
                    {
                        "periodKind": period_kind,
                        "modes": len(modes),
                        "periods": len(periods),
                        "latestPeriod": str(periods[-1]) if periods else None,
                        "surveyRows": len(survey_rows),
                    }
                ),
            ),
        )

    global _latest_cache, _last_report
    _latest_cache = None  # invalidate consumers

    report = {
        "sourceFile": csv_path.name,
        "periodKind": period_kind,
        "rowsIn": rows_in,
        "rowsClean": rows_clean,
        "periods": [str(p) for p in periods],
        "modes": modes,
        "trendIndex": trend_index,
        "overallShare": {m: float(overall_share.get(m, 0.0)) for m in modes},
        "growthSlope": slopes,
        "periodShares": [
            {"period": str(p), "shares": {m: round(float(share.loc[p, m]), 4) for m in modes}}
            for p in periods
        ],
        # numpy scalars are not JSON-serializable by FastAPI — cast explicitly
        "stats": {
            m: {k: (None if pd.isna(v) else float(v)) for k, v in d.items()}
            for m, d in stats.round(3).to_dict(orient="index").items()
        },
        "surveyRows": len(survey_rows),
    }
    _last_report = report
    return report


def _mode_ids(conn) -> Dict[str, int]:
    return {
        r["code"]: int(r["transportation_mode_id"])
        for r in conn.execute(
            "SELECT transportation_mode_id, code FROM transportation.transportation_modes"
        ).fetchall()
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
    """Latest trend index per mode code from the pipeline output (or priors)."""
    global _latest_cache
    if _latest_cache is not None:
        return _latest_cache
    result: Dict[str, float] = {}
    try:
        with db.get_conn() as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT ON (tm.code) tm.code, t.trend_index
                FROM decision.dataset_trends t
                JOIN transportation.transportation_modes tm
                  ON tm.transportation_mode_id = t.transportation_mode_id
                ORDER BY tm.code, t.month DESC
                """
            ).fetchall()
            result = {r["code"]: float(r["trend_index"]) for r in rows}
    except Exception:
        result = {}
    _latest_cache = result or dict(constants.TREND_PRIOR)
    return _latest_cache


def trend_value(mode_id: str) -> float:
    return latest_trend_map().get(mode_id, constants.TREND_PRIOR.get(mode_id, 0.01))


def dataset_summary() -> dict:
    """JSON payload for GET /api/dataset/summary (pandas showcase).

    Read-only: every aggregate comes straight from the tables the pipeline
    persists (decision.dataset_trends / decision.vehicle_survey_responses),
    so a GET never re-runs the 25k-row pipeline.
    """
    from ..dto import iso_z

    with db.get_conn() as conn:
        run = conn.execute(
            """
            SELECT ran_at, source_file, rows_in, rows_clean, notes
            FROM core.dataset_runs
            ORDER BY ran_at DESC
            LIMIT 1
            """
        ).fetchone()
        try:
            notes = json.loads(run["notes"]) if run and run["notes"] else {}
        except (TypeError, ValueError):
            notes = {}
        period_kind = (
            notes.get("periodKind", "month") if isinstance(notes, dict) else "month"
        )
        periods = [
            r["month"]
            for r in conn.execute(
                "SELECT DISTINCT month FROM decision.dataset_trends ORDER BY month"
            ).fetchall()
        ]
        share_rows = conn.execute(
            """
            SELECT t.month, tm.code AS mode_id, t.share
            FROM decision.dataset_trends t
            JOIN transportation.transportation_modes tm
              ON tm.transportation_mode_id = t.transportation_mode_id
            ORDER BY t.month
            """
        ).fetchall()
        overall_rows = conn.execute(
            """
            SELECT tm.code AS mode_id, count(*)::float AS c
            FROM decision.vehicle_survey_responses v
            JOIN transportation.transportation_modes tm
              ON tm.transportation_mode_id = v.current_mode_id
            GROUP BY 1
            """
        ).fetchall()
        stats_rows = conn.execute(
            """
            SELECT tm.code AS mode_id,
                   count(*) AS trips,
                   AVG(v.trip_distance_km) AS avg_distance_km,
                   AVG(CASE WHEN v.trip_time_min > 0
                       THEN v.trip_distance_km / (v.trip_time_min / 60.0) END) AS avg_speed_kmh
            FROM decision.vehicle_survey_responses v
            JOIN transportation.transportation_modes tm
              ON tm.transportation_mode_id = v.current_mode_id
            GROUP BY 1
            """
        ).fetchall()
        trend_idx_rows = conn.execute(
            """
            SELECT DISTINCT ON (tm.code) tm.code, t.trend_index
            FROM decision.dataset_trends t
            JOIN transportation.transportation_modes tm
              ON tm.transportation_mode_id = t.transportation_mode_id
            ORDER BY tm.code, t.month DESC
            """
        ).fetchall()

    total = sum(float(r["c"]) for r in overall_rows) or 1.0
    overall_share = {r["mode_id"]: float(r["c"]) / total for r in overall_rows}
    trend_index = {r["code"]: float(r["trend_index"]) for r in trend_idx_rows}
    share_by_period: Dict[str, Dict[str, float]] = {}
    for r in share_rows:
        share_by_period.setdefault(r["month"], {})[r["mode_id"]] = float(r["share"])
    stats = {
        r["mode_id"]: {
            "trips": int(r["trips"]),
            "avg_distance_km": (
                round(float(r["avg_distance_km"]), 3)
                if r["avg_distance_km"] is not None
                else None
            ),
            "avg_speed_kmh": (
                round(float(r["avg_speed_kmh"]), 3)
                if r["avg_speed_kmh"] is not None
                else None
            ),
        }
        for r in stats_rows
    }
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

    return {
        "dataset": {
            "name": "Vehicle at Ha Noi Dataset",
            "sourceFile": run["source_file"] if run else None,
            "rowsIn": int(run["rows_in"]) if run else 0,
            "rowsClean": int(run["rows_clean"]) if run else 0,
            "periodKind": period_kind,
            "period": {
                "from": periods[0] if periods else None,
                "to": periods[-1] if periods else None,
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
                "overallShare": round(overall_share.get(m, 0.0), 4),
                "trendIndex": round(trend_index.get(m, 0.0), 4),
                "stats": stats.get(m, {}),
            }
            for m in sorted(overall_share)
        ],
        "monthlyShares": [
            {"period": p, "shares": share_by_period.get(p, {})} for p in periods
        ],
    }


# processed-output paths (Deliverable #11 artifacts)
PROCESSED_DIR = config.PROCESSED_DIR
PROCESSED_TRIPS = PROCESSED_DIR / "processed_trips.csv"
PROCESSED_TREND = PROCESSED_DIR / "mode_trend.csv"
PROCESSED_STATS = PROCESSED_DIR / "mode_stats.csv"


if __name__ == "__main__":
    report = run_pipeline()
    print(json.dumps(report, indent=2))
