"""Import "Vehicle at Ha Noi" (Kaggle) CSV → survey.vehicle_survey_responses.

Task 52: nạp FILE KAGGLE THẬT (thanhlamdev/vehicle-at-ha-noi — dataHN.csv,
25.590 mẫu khảo sát cột/hộ gia đình, xuất bản 07/2025) thay cho scaffold
demo 2.400 dòng sinh bởi tools/make_dataset.py. Importer tự nhận diện 2
format (branch theo cột đặc trưng) để deploy mới vẫn chạy được khi thiếu
file thật:

A) Format KAGGLE THẬT (dataHN.csv, 58 cột — "vehic" tồn tại):
  rowid                   → source_row_id (dòng trống bị bỏ)
  (tên file)              → source_dataset = 'Kaggle: Vehicle at Ha Noi'
  oridist                 → area_label (quận nơi xuất phát, tên cũ Hà Nội)
  purp                    → trip_purpose (work/education/visit/…)
  vehic                   → current_mode_id (REAL_MODE_TO_ID)
  fut_veh                 → preferred_mode_id ('no' → NULL; đây là kế hoạch
                            mua/khai thác phương tiện tiếp theo)
  alt_ebike/alt_bike/alt_bus/alt_ltrain/alt_walk = 1 (≥1 cột)
                          → willing_to_switch = TRUE (chấp nhận ≥1 phương
                            án thay thế xanh — cơ sở khách quan, không suy diễn)
  OD_dist_km              → trip_distance_km
  travtime                → trip_time_min (phút)
  quy tắc làm sạch        → is_valid (mode map được + 0 < OD_dist_km ≤ 80)
  100% cột gốc            → raw_data (JSONB)

B) Format SCAFFOLD DEMO (vehicle_at_hanoi.csv — giữ tương thích deploy cũ):
  respondent_id → source_row_id, district → area_label, main_mode →
  current_mode_id (MODE_LABEL_TO_ID), distance_km → trip_distance_km,
  trip_duration_min → trip_time_min; preferred_mode_id/willing_to_switch = NULL.
"""
import json
from pathlib import Path

import pandas as pd

from .. import config, db
from .trend import MODE_LABEL_TO_ID

SOURCE_DATASET = "Kaggle: Vehicle at Ha Noi"

# File Kaggle thật (đưa vào theo yêu cầu Task 52; tải từ kaggle.com/datasets/
# thanhlamdev/vehicle-at-ha-noi). Scaffold CSV chỉ là fallback demo.
REAL_CSV = config.DATA_DIR / "dataHN.csv"

# Nhãn vehic/fut_veh của dataset thật → transportation_modes.code (DB v2).
REAL_MODE_TO_ID = {
    "moto": "gasoline_motorbike",
    "motorbike": "gasoline_motorbike",
    "car": "private_car",
    "ebike": "electric_motorbike",
    "bike": "bicycle",
    "walk": "walking",
    "bus": "bus",
    "taxi": "taxi",
}

# Phương án thay thế XANH (cột alt_* nhị phân) — cơ sở của willing_to_switch.
GREEN_ALT_COLS = ("alt_ebike", "alt_bike", "alt_bus", "alt_ltrain", "alt_walk")

_INSERT_SQL = """
INSERT INTO survey.vehicle_survey_responses
    (source_dataset, source_row_id, study_area_id, region_id,
     area_label, trip_purpose, current_mode_id, preferred_mode_id,
     willing_to_switch, trip_distance_km, trip_time_min,
     is_valid, raw_data)
VALUES (%s, %s, 1, NULL, %s, %s,
        (SELECT transportation_mode_id FROM transportation.transportation_modes
         WHERE code = %s),
        (SELECT transportation_mode_id FROM transportation.transportation_modes
         WHERE code = %s),
        %s, %s, %s, %s, %s)
ON CONFLICT (source_dataset, source_row_id) DO NOTHING
"""


def _raw_json(row) -> str:
    return json.dumps(
        {k: (None if pd.isna(v) else (v.item() if hasattr(v, "item") else v))
         for k, v in row.items()},
        ensure_ascii=False,
    )


def _default_csv() -> Path:
    """Ưu tiên file Kaggle thật; CSV scaffold chỉ là fallback demo."""
    return REAL_CSV if REAL_CSV.exists() else config.DATASET_CSV


def import_survey(
    csv_path: Path | None = None, force: bool = False, replace: bool = False
) -> dict:
    """Import CSV khảo sát. Idempotent: bỏ qua khi bảng đã có dữ liệu.

    - force=True    : import thêm cả khi bảng đã có dòng (ON CONFLICT DO NOTHING)
    - replace=True  : XÓA toàn bộ dòng cũ trước khi nạp (dùng khi thay
                      scaffold bằng dataset thật; gọi tay, không dùng ở startup)
    """
    path = Path(csv_path) if csv_path else _default_csv()
    with db.get_conn() as conn:
        existing = conn.execute(
            "SELECT count(*) AS c FROM survey.vehicle_survey_responses"
        ).fetchone()["c"]
    if existing and not force and not replace:
        return {"imported": 0, "existing": int(existing), "skipped": True}
    if not path.exists():
        return {"imported": 0, "existing": int(existing), "skipped": True,
                "reason": f"CSV không tồn tại: {path}"}

    raw = pd.read_csv(path)
    raw.columns = [c.strip() for c in raw.columns]
    real = "vehic" in raw.columns

    if replace:
        with db.tx() as conn:
            conn.execute("DELETE FROM survey.vehicle_survey_responses")
        existing = 0

    result = _import_real(raw) if real else _import_scaffold(raw)
    from . import trend

    trend.invalidate()
    return {
        "imported": result["imported"],
        "existing": int(existing),
        "skipped": False,
        "file": path.name,
        "format": "kaggle-real" if real else "demo-scaffold",
    }


# ---------------------------------------------------------------- format A

def _import_real(raw: pd.DataFrame) -> dict:
    """dataHN.csv (25.590 dòng) → survey.vehicle_survey_responses."""
    mode_code = raw["vehic"].astype(str).str.strip().str.lower().map(REAL_MODE_TO_ID)
    pref_code = raw["fut_veh"].astype(str).str.strip().str.lower().map(REAL_MODE_TO_ID)
    distance = pd.to_numeric(raw.get("OD_dist_km"), errors="coerce")
    tmin = pd.to_numeric(raw.get("travtime"), errors="coerce")
    alt_cols = [c for c in GREEN_ALT_COLS if c in raw.columns]
    willing = (
        (raw[alt_cols].apply(pd.to_numeric, errors="coerce").fillna(0) == 1).any(axis=1)
        if alt_cols
        else pd.Series(False, index=raw.index)
    )

    payload = []
    for i, row in raw.iterrows():
        rid = row.get("rowid")
        if pd.isna(rid):
            continue  # dòng trống cuối file
        mc = mode_code.iloc[i]
        dist = distance.iloc[i]
        valid = bool(pd.notna(mc) and pd.notna(dist) and 0 < float(dist) <= 80)
        payload.append((
            SOURCE_DATASET,
            str(int(rid)),
            str(row.get("oridist")) if pd.notna(row.get("oridist")) else None,
            str(row.get("purp")) if pd.notna(row.get("purp")) else None,
            mc if pd.notna(mc) else None,
            pref_code.iloc[i] if pd.notna(pref_code.iloc[i]) else None,
            bool(willing.iloc[i]),
            float(dist) if pd.notna(dist) else None,
            float(tmin.iloc[i]) if pd.notna(tmin.iloc[i]) else None,
            valid,
            _raw_json(row),
        ))

    with db.tx() as conn:
        cur = conn.cursor()
        cur.executemany(_INSERT_SQL, payload)
    return {"imported": len(payload)}


# ---------------------------------------------------------------- format B

def _import_scaffold(raw: pd.DataFrame) -> dict:
    """vehicle_at_hanoi.csv (scaffold demo 2.400 dòng, giữ tương thích)."""
    mode_id = raw["main_mode"].astype(str).str.strip().str.lower().map(MODE_LABEL_TO_ID)
    distance = pd.to_numeric(raw.get("distance_km"), errors="coerce")

    payload = []
    for i, row in raw.iterrows():
        mid = mode_id.iloc[i]
        dist = distance.iloc[i]
        valid = bool(
            pd.notna(mid)
            and pd.notna(dist)
            and 0 < float(dist) <= 80
            and pd.notna(row.get("survey_month"))
        )
        payload.append((
            SOURCE_DATASET,
            str(row.get("respondent_id", f"row-{i}")),
            str(row.get("district")) if pd.notna(row.get("district")) else None,
            str(row.get("trip_purpose")) if pd.notna(row.get("trip_purpose")) else None,
            mid if pd.notna(mid) else None,
            None,
            None,
            float(dist) if pd.notna(dist) else None,
            float(row["trip_duration_min"]) if pd.notna(row.get("trip_duration_min")) else None,
            valid,
            _raw_json(row),
        ))

    with db.tx() as conn:
        cur = conn.cursor()
        cur.executemany(_INSERT_SQL, payload)
    return {"imported": len(payload)}
