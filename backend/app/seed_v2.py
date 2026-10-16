"""Seed dữ liệu cho schema v2 (backend/app/schema_v2.sql).

Chạy độc lập (không cần FastAPI):
    DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rideshift \
        python3 backend/app/seed_v2.py

Hành vi:
  - Nếu schema v2 chưa được áp (chưa có core.study_areas) -> áp schema_v2.sql.
  - Nếu đã seed (study_areas có code='HN') -> bỏ qua (idempotent, như seed v1).
Dữ liệu: 1 khu vực HN, 1 admin DEMO (bcrypt), 7 modes (tham số kế thừa v1),
7 vehicle_types, 1 vùng LEZ Vành đai 1 (polygon v1, hiệu lực 01/07/2026) +
1 rule 24/7 + restrictions theo Chỉ thị 20/CT-TTg, 12 điểm giao thông,
7 tiêu chí MCDM (default_weight tổng = 1).
"""
import os
from pathlib import Path

import bcrypt
import psycopg
from psycopg.rows import dict_row

SCHEMA_FILE = Path(__file__).resolve().parent / "schema_v2.sql"
DSN = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/rideshift")

# ---------------------------------------------------------------- dữ liệu

# (code, name, category, routing_profile, speed_factor, avg_wait_min,
#  base_fare VND, cost_per_km VND, accessibility 1..5, convenience 1..5)
# speed_factor = tốc độ xe hơi / tốc độ mode (v1) — bicycle/walking = 1.0 vì
# OSRM trả đúng duration theo profile bike/foot.
def to5(x: float) -> int:  # đổi điểm 0..1 của v1 -> thang 1..5 của v2
    return int(x * 4 + 0.5) + 1

MODES = [
    ("gasoline_motorbike", "Xe máy xăng", "PRIVATE", "car", 0.92, 0, 0, 320, to5(0.92), to5(0.85)),
    ("electric_motorbike", "Xe máy điện", "PRIVATE", "car", 0.96, 0, 0, 120, to5(0.88), to5(0.80)),
    ("private_car", "Ô tô cá nhân", "PRIVATE", "car", 1.00, 0, 5000, 850, to5(0.80), to5(0.88)),
    ("bus", "Xe buýt", "PUBLIC", "car", 1.29, 10, 7000, 0, to5(0.55), to5(0.50)),
    ("taxi", "Taxi / Công nghệ", "TAXI", "car", 0.85, 5, 11000, 12500, to5(0.95), to5(0.90)),
    ("bicycle", "Xe đạp", "ACTIVE", "bike", 1.00, 0, 0, 0, to5(0.72), to5(0.55)),
    ("walking", "Đi bộ", "ACTIVE", "foot", 1.00, 0, 0, 0, to5(0.60), to5(0.40)),
]

# (code, name, category, fuel_type, emission_standard, emission_level, mode_code, is_default)
# emission_level: 0=chưa rõ, 1..5=Euro 1..5, 9=không phát thải (EV)
VEHICLE_TYPES = [
    ("motorcycle_petrol_euro3", "Xe máy xăng (Euro 3)", "MOTORCYCLE", "PETROL", "EURO_3", 3, "gasoline_motorbike", True),
    ("motorcycle_electric", "Xe máy điện", "MOTORCYCLE", "ELECTRIC", "ZERO_EMISSION", 9, "electric_motorbike", True),
    ("car_petrol_euro4", "Ô tô cá nhân (xăng Euro 4)", "CAR", "PETROL", "EURO_4", 4, "private_car", True),
    ("bus_euro5", "Xe buýt", "BUS", "DIESEL", "EURO_5", 5, "bus", True),
    ("taxi_hybrid", "Taxi / xe công nghệ", "CAR", "HYBRID", "EURO_5", 5, "taxi", True),
    ("bicycle", "Xe đạp", "BICYCLE", "HUMAN_POWERED", "ZERO_EMISSION", 9, "bicycle", True),
    ("walking", "Đi bộ", "WALKING", "NONE", "ZERO_EMISSION", 9, "walking", True),
]

# Polygon Vành đai 1 (v1 seed.py — dựng từ trục OSM theo quy_dinh_vanh_dai_1.txt)
RING1 = [
    (21.036, 105.8527), (21.014, 105.853), (21.00858, 105.85141),
    (21.00753, 105.84156), (21.00797, 105.83991), (21.00894, 105.83864),
    (21.01501, 105.83326), (21.01806, 105.82971), (21.01881, 105.82961),
    (21.0209, 105.82563), (21.01666, 105.82339), (21.01638, 105.8211),
    (21.01378, 105.81889), (21.0165, 105.82), (21.0212, 105.821),
    (21.0234, 105.81989), (21.03136, 105.82973), (21.03217, 105.83),
    (21.0324, 105.82885), (21.03055, 105.81726), (21.0345, 105.815),
    (21.03048, 105.81279), (21.04343, 105.81682), (21.0436, 105.8197),
    (21.04291, 105.8237), (21.04092, 105.82792), (21.0427, 105.83272),
    (21.04271, 105.83585), (21.0403, 105.8476), (21.0399, 105.84718),
    (21.0407, 105.84993),
]

# (vehicle_type_code, restriction_type, min_emission_level, reason)
# Theo Chỉ thị 20/CT-TTg: cấm xe máy xăng 24/7 từ 01/07/2026; xe máy điện,
# xe đạp, giao thông công cộng được phép; ô tô xăng chưa cấm (chỉ phí cao hơn).
RESTRICTIONS = [
    ("motorcycle_petrol_euro3", "PROHIBITED", None,
     "Cấm hoàn toàn xe mô tô, xe gắn máy (hai bánh) nhiên liệu hóa thạch "
     "trong phạm vi Vành đai 1 — 24/7, hiệu lực từ 01/07/2026 theo Chỉ thị "
     "số 20/CT-TTg."),
    ("car_petrol_euro4", "CONDITIONAL", None,
     "Ô tô chạy xăng/dầu chưa bị cấm hoàn toàn ở giai đoạn Vành đai 1, nhưng "
     "chịu mức phí trước bạ, phí cấp biển số và phí trông giữ xe cao hơn tại "
     "khu vực trung tâm theo lộ trình tăng dần từ Quý III/2025."),
    ("motorcycle_electric", "ALLOWED", None, None),
    ("bus_euro5", "ALLOWED", None, None),
    ("taxi_hybrid", "ALLOWED", None, None),
    ("bicycle", "ALLOWED", None, None),
    ("walking", "ALLOWED", None, None),
]

# (name, location_type, lat, lng) — v1 seed; mọi điểm giao thông công cộng
# đều phục vụ accessibility của mode 'bus' (location_type giữ chi tiết loại).
LOCATIONS = [
    ("Bến xe Giáp Bát", "BUS_STOP", 21.0034, 105.8412),
    ("Bến xe Mỹ Đình", "BUS_STOP", 21.0276, 105.7763),
    ("Bến xe Nước Ngầm", "BUS_STOP", 20.9960, 105.8495),
    ("Bến xe Long Biên", "BUS_STOP", 21.0338, 105.8592),
    ("Bến xe Kim Mã", "BUS_STOP", 21.0342, 105.8170),
    ("Bến xe Gia Lâm", "BUS_STOP", 21.0378, 105.8745),
    ("Bến xe Yên Nghĩa", "BUS_STOP", 20.9765, 105.7895),
    ("Ga metro Cát Linh (tuyến 2A)", "METRO_STATION", 21.0299, 105.8147),
    ("Ga metro Thượng Đình (tuyến 2A)", "METRO_STATION", 20.9906, 105.8085),
    ("Ga metro La Khê (tuyến 2A)", "METRO_STATION", 20.9835, 105.7806),
    ("Trạm BRT Trung Yên", "BRT_STOP", 21.0070, 105.7872),
    ("Trạm BRT Nguyễn Trãi", "BRT_STOP", 20.9975, 105.8148),
]

# (code, name, criteria_type, default_weight) — tổng = 1.00 (v1: 25/20/20/10/10/10/5)
CRITERIA = [
    ("TRAVEL_TIME", "Thời gian di chuyển", "COST", 0.25),
    ("COST", "Chi phí ước tính", "COST", 0.20),
    ("LEZ_COMPLIANCE", "Tuân thủ LEZ", "BENEFIT", 0.20),
    ("ACCESSIBILITY", "Khả năng tiếp cận", "BENEFIT", 0.10),
    ("CONVENIENCE", "Thuận tiện", "BENEFIT", 0.10),
    ("ENVIRONMENT", "Tác động môi trường", "BENEFIT", 0.10),
    ("SURVEY_TREND", "Xu hướng khảo sát", "BENEFIT", 0.05),
]

ADMIN_EMAIL = os.environ.get("RIDESHIFT_ADMIN_EMAIL", "admin@rideshift.local")
# DEMO credential — đổi bằng biến môi trường ở môi trường thật (rules.md: gắn nhãn DEMO)
ADMIN_PASSWORD = os.environ.get("RIDESHIFT_ADMIN_PASSWORD", "admin123")


def ring1_wkt() -> str:
    """MULTIPOLYGON WKT từ RING1 [(lat,lng)] — PostGIS dùng thứ tự (lng lat)."""
    pts = ", ".join(f"{lng} {lat}" for lat, lng in RING1)
    first_lng, first_lat = RING1[0][1], RING1[0][0]
    return f"SRID=4326;MULTIPOLYGON((({pts}, {first_lng} {first_lat})))"


def schema_applied(conn) -> bool:
    row = conn.execute(
        "SELECT to_regclass('core.study_areas') IS NOT NULL AS ok"
    ).fetchone()
    return bool(row["ok"])


def already_seeded(conn) -> bool:
    row = conn.execute(
        "SELECT EXISTS(SELECT 1 FROM core.study_areas WHERE code = 'HN') AS ok"
    ).fetchone()
    return bool(row["ok"])


def seed(conn) -> None:
    # Khu vực nghiên cứu: Hà Nội
    conn.execute(
        """INSERT INTO core.study_areas (code, name, area_type, country_code, description)
           VALUES ('HN', 'Hà Nội', 'CITY', 'VN',
                   'Khu vực thí điểm: nội thành Hà Nội — Vành đai 1 theo Chỉ thị 20/CT-TTg')
           ON CONFLICT (code) DO NOTHING""",
    )
    area_id = conn.execute(
        "SELECT study_area_id FROM core.study_areas WHERE code = 'HN'"
    ).fetchone()["study_area_id"]

    # Admin (bcrypt — RULES.md §7 bắt buộc)
    pw_hash = bcrypt.hashpw(ADMIN_PASSWORD.encode(), bcrypt.gensalt()).decode()
    conn.execute(
        """INSERT INTO core.admins (full_name, email, password_hash)
           VALUES ('Quản trị viên hệ thống', %s, %s)
           ON CONFLICT DO NOTHING""",
        (ADMIN_EMAIL, pw_hash),
    )

    # Modes
    for code, name, cat, profile, sf, wait, base_fare, per_km, acc, conv in MODES:
        conn.execute(
            """INSERT INTO transportation.transportation_modes
                 (code, name, category, description, routing_profile,
                  speed_factor, avg_wait_min, base_fare, cost_per_km,
                  accessibility_score, convenience_score)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (code) DO NOTHING""",
            (code, name, cat, None, profile, sf, wait, base_fare, per_km, acc, conv),
        )
    mode_ids = {
        r["code"]: r["id"]
        for r in conn.execute(
            "SELECT code, transportation_mode_id AS id FROM transportation.transportation_modes"
        ).fetchall()
    }

    # Vehicle types (mỗi mode 1 loại đại diện)
    for code, name, cat, fuel, std, level, mode_code, is_default in VEHICLE_TYPES:
        conn.execute(
            """INSERT INTO policy.vehicle_types
                 (code, name, category, fuel_type, emission_standard,
                  emission_level, transportation_mode_id, is_default)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (code) DO NOTHING""",
            (code, name, cat, fuel, std, level, mode_ids[mode_code], is_default),
        )
    vtype_ids = {
        r["code"]: r["id"]
        for r in conn.execute(
            "SELECT code, vehicle_type_id AS id FROM policy.vehicle_types"
        ).fetchall()
    }

    # Vùng LEZ Vành đai 1 + rule 24/7 + restrictions
    conn.execute(
        """INSERT INTO policy.lez_zones (study_area_id, name, description,
               geometry, effective_from, status)
           VALUES (%s, 'Vùng phát thải thấp Vành đai 1',
                   'Phạm vi phía trong vòng giới hạn Vành đai 1 (các trục Trần Khát Chân – Đại Cồ Việt – Xã Đàn; Ô Chợ Dừa – Hoàng Cầu; Voi Phục – Kim Mã – Giảng Võ; Nguyễn Khoái), theo Chỉ thị số 20/CT-TTg.',
                   ST_GeomFromEWKT(%s), '2026-07-01', 'ACTIVE')""",
        (area_id, ring1_wkt()),
    )
    zone_id = conn.execute(
        "SELECT lez_zone_id FROM policy.lez_zones ORDER BY lez_zone_id DESC LIMIT 1"
    ).fetchone()["lez_zone_id"]

    conn.execute(
        """INSERT INTO policy.lez_rules
             (lez_zone_id, rule_name, description, start_time, end_time,
              days_of_week, effective_from, status)
           VALUES (%s, 'Cấm xe máy xăng trong Vành đai 1 — 24/7',
                   'Áp dụng toàn bộ các ngày trong tuần, toàn bộ khung giờ.',
                   '00:00', '23:59:59', ARRAY[1,2,3,4,5,6,7]::SMALLINT[],
                   '2026-07-01', 'ACTIVE')""",
        (zone_id,),
    )
    rule_id = conn.execute(
        "SELECT lez_rule_id FROM policy.lez_rules ORDER BY lez_rule_id DESC LIMIT 1"
    ).fetchone()["lez_rule_id"]

    for vt_code, rtype, min_level, reason in RESTRICTIONS:
        conn.execute(
            """INSERT INTO policy.vehicle_restrictions
                 (lez_rule_id, vehicle_type_id, restriction_type,
                  min_emission_level, restriction_reason)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (lez_rule_id, vehicle_type_id) DO NOTHING""",
            (rule_id, vtype_ids[vt_code], rtype, min_level, reason),
        )

    # Điểm giao thông công cộng
    for name, ltype, lat, lng in LOCATIONS:
        conn.execute(
            """INSERT INTO transportation.transportation_locations
                 (study_area_id, transportation_mode_id, name, location_type,
                  geometry, source)
               VALUES (%s, %s, %s, %s,
                       ST_SetSRID(ST_MakePoint(%s, %s), 4326), 'seed-v2')""",
            (area_id, mode_ids["bus"], name, ltype, lng, lat),
        )

    # Tiêu chí MCDM
    for code, name, ctype, weight in CRITERIA:
        conn.execute(
            """INSERT INTO decision.recommendation_criteria
                 (code, name, criteria_type, default_weight)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (code) DO NOTHING""",
            (code, name, ctype, weight),
        )


def main() -> None:
    with psycopg.connect(DSN, autocommit=True, row_factory=dict_row) as conn:
        if not schema_applied(conn):
            print("Áp schema_v2.sql ...")
            conn.execute(SCHEMA_FILE.read_text(encoding="utf-8"))
            print("Schema v2 đã được áp.")
        if already_seeded(conn):
            print("Đã seed sẵn (study_areas có HN) — bỏ qua.")
            return
        seed(conn)
        w = conn.execute(
            "SELECT round(sum(default_weight), 4) AS s FROM decision.recommendation_criteria"
        ).fetchone()["s"]
        print(f"Seed v2 hoàn tất. Tổng default_weight = {w} (kỳ vọng 1.0).")


if __name__ == "__main__":
    main()
