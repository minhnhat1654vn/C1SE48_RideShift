#!/usr/bin/env python3
"""Ingest user-uploaded CSVs from /home/z/my-project/upload into the backend.

Handles the two announced uploads:
  - dataHN.csv         → survey dataset ("Vehicle at Ha Noi Dataset") → data/vehicle_at_hanoi.csv
  - district_data.csv  → district-level statistics                    → data/district_data.csv

The survey file must end up with the columns the trend pipeline expects:
    survey_month, main_mode, distance_km   (required)
    respondent_id, trip_duration_min, out_of_pocket_cost_vnd (optional)

If the headers differ (e.g. Vietnamese survey exports), `COLUMN_ALIASES`
below maps the common variants; anything unmapped is reported and left as-is
so the operator can extend the alias table.

Usage:
    python3 -m tools.ingest_upload            # inspect + ingest + run trend pipeline
    python3 -m tools.ingest_upload --dry-run  # inspect only, no copy/pipeline
"""
import shutil
import sys
from pathlib import Path

import pandas as pd

BACKEND_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = Path("/home/z/my-project/upload")
DATA_DIR = BACKEND_DIR / "data"

SURVEY_TARGET = DATA_DIR / "vehicle_at_hanoi.csv"
DISTRICT_TARGET = DATA_DIR / "district_data.csv"

# Canonical column -> accepted source headers (lower-cased, stripped)
COLUMN_ALIASES: dict[str, list[str]] = {
    "survey_month": ["survey_month", "month", "thang", "tháng", "survey period", "period", "nam_thang", "year_month"],
    "main_mode": ["main_mode", "mode", "main mode", "phuong_tien", "phương tiện", "phuong tien", "vehicle", "transport_mode", "loai_phuong_tien"],
    "distance_km": ["distance_km", "distance", "km", "quang_duong", "quãng đường", "quang duong", "trip_distance", "do_dai"],
    "respondent_id": ["respondent_id", "respondent", "id", "user_id", "nguoi_tra_loi", "ma_nguoi_dung"],
    "trip_duration_min": ["trip_duration_min", "duration_min", "duration", "thoi_gian", "thời gian", "thoi_gian_phut", "trip_duration"],
    "out_of_pocket_cost_vnd": ["out_of_pocket_cost_vnd", "cost_vnd", "cost", "chi_phi", "chi phí", "gia_ve", "fare_vnd", "trip_cost"],
}

# main_mode value normalisation (lower-cased source value -> pipeline label)
MODE_VALUE_ALIASES: dict[str, str] = {
    "xe may": "gasoline motorbike",
    "xemay": "gasoline motorbike",
    "xe may xang": "gasoline motorbike",
    "motorbike": "gasoline motorbike",
    "motorcycle": "gasoline motorbike",
    "xe may dien": "electric motorbike",
    "e-bike": "electric motorbike",
    "ebike": "electric motorbike",
    "oto": "private car",
    "oto ca nhan": "private car",
    "car": "private car",
    "xe buyt": "bus",
    "xe bus": "bus",
    "taxi": "taxi/ride-hailing",
    "grab": "taxi/ride-hailing",
    "taxi/ride-hailing": "taxi/ride-hailing",
    "xe dap": "bicycle",
    "bike": "bicycle",
    "di bo": "walking",
    "walk": "walking",
}


def normalise_header(h: str) -> str:
    return str(h).strip().lower().replace(" ", "_")


def inspect(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    print(f"\n=== {path.name} ===")
    print(f"rows: {len(df)}  columns: {len(df.columns)}")
    print("headers:", list(df.columns))
    print(df.head(3).to_string(max_colwidth=24))
    return df


def map_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Rename source headers to canonical pipeline headers where recognised."""
    rename: dict[str, str] = {}
    for src in df.columns:
        n = normalise_header(src)
        for canonical, aliases in COLUMN_ALIASES.items():
            if n in {normalise_header(a) for a in aliases}:
                rename[src] = canonical
                break
    if rename:
        print("column mapping:", rename)
        df = df.rename(columns=rename)
    missing = [c for c in ("survey_month", "main_mode", "distance_km") if c not in df.columns]
    if missing:
        print(f"!! STILL MISSING required columns after mapping: {missing}")
        print("   → extend COLUMN_ALIASES in tools/ingest_upload.py and re-run")
    return df


def normalise_modes(df: pd.DataFrame) -> pd.DataFrame:
    if "main_mode" not in df.columns:
        return df
    def norm(v: object) -> object:
        s = str(v).strip().lower()
        return MODE_VALUE_ALIASES.get(s, s)
    df = df.copy()
    df["main_mode"] = df["main_mode"].map(norm)
    return df


def main() -> int:
    dry = "--dry-run" in sys.argv
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    files = sorted(p for p in UPLOAD_DIR.iterdir() if p.is_file()) if UPLOAD_DIR.exists() else []
    if not files:
        print("upload/ is empty — nothing to ingest. Waiting for the platform to sync files.")
        return 1

    survey_done = district_done = False
    for f in files:
        if f.suffix.lower() == ".zip":
            print(f"\n{f.name}: zip archive — extract it first (unzip -o {f} -d {UPLOAD_DIR})")
            continue
        try:
            df = inspect(f)
        except Exception as e:  # not a CSV / encoding issue
            print(f"{f.name}: cannot parse as CSV ({e!r})")
            continue

        cols = {normalise_header(c) for c in df.columns}
        is_survey = bool(cols & {"main_mode", "phuong_tien", "phương_tiện"}) or "distance_km" in cols
        name_hint = f.stem.lower().replace("_", "").replace("-", "")

        if not survey_done and (is_survey or "datahn" in name_hint):
            out = map_columns(df)
            out = normalise_modes(out)
            if not dry:
                out.to_csv(SURVEY_TARGET, index=False)
                print(f"→ wrote {SURVEY_TARGET} ({len(out)} rows)")
            survey_done = True
        elif not district_done:
            if not dry:
                shutil.copy2(f, DISTRICT_TARGET)
                print(f"→ wrote {DISTRICT_TARGET} ({len(df)} rows)")
            district_done = True

    if dry:
        print("\n(dry run — nothing written)")
        return 0

    if survey_done:
        print("\nrunning the trend pipeline on the ingested survey data…")
        from app.services import trend

        result = trend.run_pipeline()
        print("pipeline result:", result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
