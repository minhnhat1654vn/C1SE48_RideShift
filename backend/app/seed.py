"""Seed + legacy migration for the RideShift PostgreSQL database.

Run manually:  python3 -m app.seed
Also invoked automatically on backend startup.

Two responsibilities, both idempotent (safe on every boot):

1. migrate_legacy() — one-shot data copy from the pre-DB-FINAL layouts
   (flat snake_case tables in `public`, or the Task-56 singular-name
   schemas such as core.admin_user / trip.trip_record) into the final
   24-table layout of backend/app/schema.sql, then drops the old tables.
   No-op on databases that were created with the final layout.
2. seed() — reference/demo data: Hanoi study area, admin account, 7
   transportation modes, 7 vehicle types, 2 LEZ rules of Vành đai 1,
   7 MCDM criteria weights, bus/metro/BRT stops, Hanoi districts and
   140 demo trip records for the analytics dashboard.
"""
import hashlib
import json
import random
import uuid
from datetime import datetime, timedelta, timezone

from . import db
from .geojson import (
    linestring_geojson,
    point_geojson,
    polygon_geojson_from_pairs,
)

SALT = "rideshift-c1se48"

STUDY_AREA_CODE = "HN"
ZONE_RING1_NAME = "Vùng phát thải thấp Vành đai 1"
RING1_EFFECTIVE_FROM = "2026-07-01"  # Chỉ thị số 20/CT-TTg


def _hash(password: str) -> str:
    return f"{SALT}${hashlib.sha256(f'{SALT}:{password}'.encode()).hexdigest()}"


# --------------------------------------------------------------------------
# Reference data
# --------------------------------------------------------------------------

# (code, name, description, icon, category, routing_profile, avg_speed_kmh,
#  base_fare, cost_per_km, co2_per_km_g, accessibility, convenience, wait_min, sort)
MODES = [
    ("gasoline_motorbike", "Xe máy xăng", "Xe máy xăng thông thường", "motorbike", "motorbike", "driving", 24, 0, 320, 113, 0.92, 0.85, 0, 1),
    ("electric_motorbike", "Xe máy điện", "Xe máy điện dùng pin (VinFast, Yadea…)", "zap", "motorbike", "driving", 23, 0, 120, 18, 0.88, 0.80, 0, 2),
    ("private_car", "Ô tô cá nhân", "Ô tô sở hữu cá nhân", "car", "car", "driving", 22, 5000, 850, 168, 0.80, 0.88, 0, 3),
    ("bus", "Xe buýt", "Xe buýt công cộng", "bus", "public", "driving", 17, 7000, 0, 42, 0.55, 0.50, 10, 4),
    ("taxi", "Taxi / Công nghệ", "Dịch vụ taxi hoặc gọi xe công nghệ (Grab, Be…)", "car-taxi-front", "car", "driving", 26, 11000, 12500, 150, 0.95, 0.90, 5, 5),
    ("bicycle", "Xe đạp", "Xe đạp", "bike", "active", "bike", 12, 0, 0, 0, 0.72, 0.55, 0, 6),
    ("walking", "Đi bộ", "Đi bộ", "footprints", "active", "foot", 4.5, 0, 0, 0, 0.60, 0.40, 0, 7),
]

# (code, name, mode_code, category, fuel, standard, level)
VEHICLE_TYPES = [
    ("gasoline_motorbike", "Xe máy xăng", "gasoline_motorbike", "motorbike", "PETROL", "EURO 3", 3),
    ("electric_motorbike", "Xe máy điện", "electric_motorbike", "motorbike", "ELECTRIC", "ZERO", 0),
    ("private_car", "Ô tô cá nhân (xăng)", "private_car", "car", "PETROL", "EURO 4", 4),
    ("bus", "Xe buýt", "bus", "public", "DIESEL", "EURO 5", 5),
    ("taxi", "Taxi / Công nghệ (xăng)", "taxi", "car", "PETROL", "EURO 4", 4),
    ("bicycle", "Xe đạp", "bicycle", "active", "HUMAN", "ZERO", 0),
    ("walking", "Đi bộ", "walking", "active", "HUMAN", "ZERO", 0),
]

# Polygon Vành đai 1 — dựng từ hình học OSM của các trục theo file
# quy_dinh_vanh_dai_1.txt (Trần Khát Chân – Đại Cồ Việt – Xã Đàn; Ô Chợ Dừa –
# Hoàng Cầu; Voi Phục – Kim Mã – Giảng Võ; Nguyễn Khoái), khép bằng Liễu Giai,
# Thụy Khuê (bờ Hồ Tây), Quán Thánh, Hàng Đậu (Task 29).
RING1 = [
    [21.036, 105.8527], [21.014, 105.853], [21.00858, 105.85141],
    [21.00753, 105.84156], [21.00797, 105.83991], [21.00894, 105.83864],
    [21.01501, 105.83326], [21.01806, 105.82971], [21.01881, 105.82961],
    [21.0209, 105.82563], [21.01666, 105.82339], [21.01638, 105.8211],
    [21.01378, 105.81889], [21.0165, 105.82], [21.0212, 105.821],
    [21.0234, 105.81989], [21.03136, 105.82973], [21.03217, 105.83],
    [21.0324, 105.82885], [21.03055, 105.81726], [21.0345, 105.815],
    [21.03048, 105.81279], [21.04343, 105.81682], [21.0436, 105.8197],
    [21.04291, 105.8237], [21.04092, 105.82792], [21.0427, 105.83272],
    [21.04271, 105.83585], [21.0403, 105.8476], [21.0399, 105.84718],
    [21.0407, 105.84993],
]

# Ranh giới thô Hà Nội (đa giác bao ~ 10 điểm) cho core.study_areas.geometry
HANOI_BOUNDARY = [
    [21.0750, 105.7750], [21.1200, 105.8100], [21.1600, 105.8300],
    [21.2100, 105.8100], [21.2300, 105.7900], [21.1800, 105.7300],
    [21.1200, 105.6900], [21.0400, 105.7000], [20.9700, 105.7400],
    [20.9500, 105.8100], [20.9700, 105.8700], [21.0100, 105.9000],
    [21.0600, 105.8600],
]

RING1_ZONE_DESCRIPTION = (
    "Vùng phát thải thấp Vành đai 1 — theo lộ trình triển khai Chỉ thị số "
    "20/CT-TTg. Phạm vi áp dụng: toàn bộ các tuyến đường, phố nằm phía trong "
    "vòng giới hạn của Vành đai 1, bao quanh bởi các trục đường chính: "
    "Trần Khát Chân – Đại Cồ Việt – Xã Đàn; Ô Chợ Dừa – Hoàng Cầu (nhánh phụ); "
    "Voi Phục – Kim Mã – Giảng Võ; Nguyễn Khoái (đê ven sông). "
    "Quy định (hiệu lực từ 01/07/2026): cấm hoàn toàn xe mô tô, xe gắn máy "
    "(hai bánh) sử dụng nhiên liệu hóa thạch (xăng, dầu) — áp dụng 24/7; "
    "xe máy điện, xe đạp điện, các phương tiện năng lượng xanh và giao thông "
    "công cộng (xe buýt, tàu điện) được phép lưu thông; ô tô xăng/dầu chưa bị "
    "cấm hoàn toàn nhưng chịu mức phí trước bạ, phí cấp biển số và phí trông "
    "giữ cao hơn tại khu vực trung tâm theo lộ trình tăng dần từ Quý III/2025. "
    "Thành phố đang thực hiện thí điểm cuốn chiếu bắt đầu từ một số vùng lõi "
    "thuộc quận Hoàn Kiếm."
)

# Quy định theo file quy_dinh_vanh_dai_1.txt (Chỉ thị số 20/CT-TTg):
#   - Cấm hoàn toàn xe mô tô, xe gắn máy (hai bánh) nhiên liệu hóa thạch
#     (xăng, dầu) trong toàn bộ Vành đai 1 — 24/7, hiệu lực từ 01/07/2026.
#   - Ô tô xăng/dầu chưa bị cấm hoàn toàn — chỉ chịu phí cao hơn.
#   - Xe máy điện, xe đạp, năng lượng xanh, giao thông công cộng: được phép.
#   - Vành đai 2 năm sau mới áp dụng — không tạo vùng trong giai đoạn này.
RULES = [
    (
        "gasoline_motorbike", "banned",
        "Cấm xe máy xăng trong Vành đai 1",
        "Cấm hoàn toàn xe mô tô, xe gắn máy (hai bánh) sử dụng nhiên liệu hóa "
        "thạch (xăng, dầu) trong phạm vi Vành đai 1 — 24/7, có hiệu lực từ "
        "01/07/2026 theo Chỉ thị số 20/CT-TTg.",
        "00:00", "23:59", "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
    ),
    (
        "private_car", "conditional",
        "Hạn chế có điều kiện — ô tô xăng trong Vành đai 1",
        "Ô tô chạy xăng/dầu chưa bị cấm hoàn toàn ở giai đoạn Vành đai 1, "
        "nhưng chịu mức phí trước bạ, phí cấp biển số và phí trông giữ cao "
        "hơn tại khu vực trung tâm theo lộ trình tăng dần từ Quý III/2025.",
        "00:00", "23:59", "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
    ),
]

# (code, name, type COST|BENEFIT, weight%, label)
WEIGHTS = [
    ("travelTime", "Thời gian di chuyển", "COST", 25, "Thời gian di chuyển"),
    ("cost", "Chi phí ước tính", "COST", 20, "Chi phí ước tính"),
    ("lezCompliance", "Tuân thủ LEZ", "BENEFIT", 20, "Tuân thủ LEZ"),
    ("accessibility", "Khả năng tiếp cận", "BENEFIT", 10, "Khả năng tiếp cận"),
    ("convenience", "Thuận tiện", "BENEFIT", 10, "Thuận tiện"),
    ("environment", "Tác động môi trường", "BENEFIT", 10, "Tác động môi trường"),
    ("trend", "Xu hướng khảo sát", "BENEFIT", 5, "Xu hướng khảo sát"),
]

LOCATIONS = [
    ("Bến xe Giáp Bát", "bus_stop", 21.0034, 105.8412),
    ("Bến xe Mỹ Đình", "bus_stop", 21.0276, 105.7763),
    ("Bến xe Nước Ngầm", "bus_stop", 20.9960, 105.8495),
    ("Bến xe Long Biên", "bus_stop", 21.0338, 105.8592),
    ("Bến xe Kim Mã", "bus_stop", 21.0342, 105.8170),
    ("Bến xe Gia Lâm", "bus_stop", 21.0378, 105.8745),
    ("Bến xe Yên Nghĩa", "bus_stop", 20.9765, 105.7895),
    ("Ga metro Cát Linh (tuyến 2A)", "metro", 21.0299, 105.8147),
    ("Ga metro Thượng Đình (tuyến 2A)", "metro", 20.9906, 105.8085),
    ("Ga metro La Khê (tuyến 2A)", "metro", 20.9835, 105.7806),
    ("Trạm BRT Trung Yên", "brt", 21.0070, 105.7872),
    ("Trạm BRT Nguyễn Trãi", "brt", 20.9975, 105.8148),
]

DISTRICTS = ["Hoan Kiem", "Ba Dinh", "Dong Da", "Hai Ba Trung", "Cau Giay", "Thanh Xuan", "Tay Ho", "Ha Dong"]
PLACES = ["Hồ Hoàn Kiếm", "Mỹ Đình", "Times City", "Royal City", "Siêu thị Big C Thăng Long", "Chợ Đồng Xuân", "Bệnh viện Bạch Mai", "Keangnam Landmark 72", "Hồ Tây", "Quảng trường Ba Đình", "Vincom Phạm Ngọc Thạch", "Bách khoa Thăng Long"]
PURPOSES = ["work", "school", "shopping", "leisure", "other"]


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

def _exists(conn, regname: str) -> bool:
    row = conn.execute("SELECT to_regclass(%s) AS t", (regname,)).fetchone()
    return bool(row and row["t"])


def _study_area_id(conn) -> int:
    row = conn.execute(
        "SELECT study_area_id FROM core.study_areas WHERE code = %s", (STUDY_AREA_CODE,)
    ).fetchone()
    return int(row["study_area_id"]) if row else None


def _mode_id_map(conn) -> dict:
    rows = conn.execute(
        "SELECT transportation_mode_id, code FROM transportation.transportation_modes"
    ).fetchall()
    return {r["code"]: int(r["transportation_mode_id"]) for r in rows}


def _ensure_modes(conn) -> None:
    for (code, name, desc, icon, category, profile, speed, base, perkm, co2,
         acc, conv, wait, order) in MODES:
        conn.execute(
            """
            INSERT INTO transportation.transportation_modes
                (code, name, description, icon, category, routing_profile,
                 avg_speed_kmh, base_fare, cost_per_km, co2_per_km_g,
                 accessibility_score, convenience_score, avg_wait_min,
                 is_active, sort_order)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true,%s)
            ON CONFLICT (code) DO UPDATE SET
                name=EXCLUDED.name, description=EXCLUDED.description,
                icon=EXCLUDED.icon, category=EXCLUDED.category,
                routing_profile=EXCLUDED.routing_profile,
                avg_speed_kmh=EXCLUDED.avg_speed_kmh,
                base_fare=EXCLUDED.base_fare, cost_per_km=EXCLUDED.cost_per_km,
                co2_per_km_g=EXCLUDED.co2_per_km_g,
                accessibility_score=EXCLUDED.accessibility_score,
                convenience_score=EXCLUDED.convenience_score,
                avg_wait_min=EXCLUDED.avg_wait_min, sort_order=EXCLUDED.sort_order
            """,
            (code, name, desc, icon, category, profile, speed, base, perkm,
             co2, acc, conv, wait, order),
        )


def _ensure_vehicle_types(conn) -> None:
    mode_ids = _mode_id_map(conn)
    for (code, name, mode_code, category, fuel, standard, level) in VEHICLE_TYPES:
        if mode_code not in mode_ids:
            continue
        conn.execute(
            """
            INSERT INTO policy.vehicle_types
                (code, name, category, fuel_type, emission_standard,
                 emission_level, transportation_mode_id, is_default, description)
            VALUES (%s,%s,%s,%s,%s,%s,%s,true,%s)
            ON CONFLICT (code) DO UPDATE SET
                name=EXCLUDED.name, category=EXCLUDED.category,
                fuel_type=EXCLUDED.fuel_type,
                emission_standard=EXCLUDED.emission_standard,
                emission_level=EXCLUDED.emission_level,
                transportation_mode_id=EXCLUDED.transportation_mode_id
            """,
            (code, name, category, fuel, standard, level,
             mode_ids[mode_code], f"Loại phương tiện mặc định: {name}"),
        )


def _ensure_study_area(conn) -> None:
    conn.execute(
        f"""
        INSERT INTO core.study_areas (code, name, area_type, country_code,
            description, geometry, status)
        VALUES (%s, %s, 'CITY', 'VN', %s, {db.geom_write(multi=True)}, 'active')
        ON CONFLICT (code) DO UPDATE SET
            name = EXCLUDED.name, geometry = EXCLUDED.geometry,
            updated_at = now()
        """,
        (
            STUDY_AREA_CODE,
            "Hà Nội",
            "Khu vực nghiên cứu Capstone C1SE.48 — thành phố Hà Nội.",
            json.dumps({"type": "MultiPolygon",
                        "coordinates": [[[[p[1], p[0]] for p in HANOI_BOUNDARY]
                                         + [[HANOI_BOUNDARY[0][1], HANOI_BOUNDARY[0][0]]]]]}),
        ),
    )


def _ensure_admin(conn) -> None:
    conn.execute(
        """
        INSERT INTO core.admins (username, password_hash, full_name, role)
        VALUES (%s, %s, %s, 'admin')
        ON CONFLICT (username) DO NOTHING
        """,
        ("admin", _hash("admin123"), "Quản trị viên hệ thống"),
    )


def _ensure_criteria(conn) -> None:
    for (code, name, ctype, weight, label) in WEIGHTS:
        conn.execute(
            """
            INSERT INTO decision.recommendation_criteria
                (code, name, criteria_type, default_weight, description)
            VALUES (%s,%s,%s,%s,%s)
            ON CONFLICT (code) DO UPDATE SET
                name = EXCLUDED.name, criteria_type = EXCLUDED.criteria_type,
                default_weight = EXCLUDED.default_weight, description = EXCLUDED.description
            """,
            (code, name, ctype, weight, f"Tiêu chí MCDM: {label}"),
        )


def _ensure_zone_and_rules(conn) -> None:
    """Vành đai 1 zone + 2 rules (Vành đai 2 năm sau mới áp dụng — không tạo)."""
    study_id = _study_area_id(conn)
    row = conn.execute(
        "SELECT lez_zone_id FROM policy.lez_zones WHERE name = %s", (ZONE_RING1_NAME,)
    ).fetchone()
    ring1_geojson = polygon_geojson_from_pairs(RING1)
    if row:
        zone_id = int(row["lez_zone_id"])
        conn.execute(
            f"""
            UPDATE policy.lez_zones SET description = %s,
                geometry = {db.geom_write(multi=True)},
                effective_from = %s, status = 'active', updated_at = now()
            WHERE lez_zone_id = %s
            """,
            (RING1_ZONE_DESCRIPTION, ring1_geojson, RING1_EFFECTIVE_FROM, zone_id),
        )
    else:
        zone_id = int(
            conn.execute(
                f"""
                INSERT INTO policy.lez_zones (study_area_id, name, description,
                    geometry, effective_from, status)
                VALUES (%s, %s, %s, {db.geom_write(multi=True)}, %s, 'active')
                RETURNING lez_zone_id
                """,
                (study_id, ZONE_RING1_NAME, RING1_ZONE_DESCRIPTION, ring1_geojson,
                 RING1_EFFECTIVE_FROM),
            ).fetchone()["lez_zone_id"]
        )
    # Xoá các vùng cũ không còn dùng (idempotent)
    conn.execute(
        "DELETE FROM policy.lez_zones WHERE name = ANY(%s)",
        (["Vùng LEZ Phố Cổ", "Vùng phát thải thấp Vành đai 2", "Vùng LEZ Hồ Hoàn Kiếm"],),
    )

    # Rules — xoá rule cũ của các vùng quản lý rồi chèn bộ mới
    conn.execute("DELETE FROM policy.lez_rules WHERE lez_zone_id = %s", (zone_id,))
    vt = conn.execute(
        "SELECT vehicle_type_id, code FROM policy.vehicle_types"
    ).fetchall()
    vt_by_code = {r["code"]: int(r["vehicle_type_id"]) for r in vt}
    for (mode_code, rtype, rule_name, text, start, end, days) in RULES:
        rule_id = int(
            conn.execute(
                """
                INSERT INTO policy.lez_rules (lez_zone_id, rule_name, description,
                    start_time, end_time, days_of_week, effective_from, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'active')
                RETURNING lez_rule_id
                """,
                (zone_id, rule_name, text, start, end, days, RING1_EFFECTIVE_FROM),
            ).fetchone()["lez_rule_id"]
        )
        vt_id = vt_by_code.get(mode_code)
        if vt_id:
            conn.execute(
                """
                INSERT INTO policy.vehicle_restrictions
                    (lez_rule_id, vehicle_type_id, restriction_type,
                     min_emission_level, restriction_reason)
                VALUES (%s, %s, %s, 0, %s)
                """,
                (rule_id, vt_id, rtype, text),
            )


def _ensure_locations(conn) -> None:
    study_id = _study_area_id(conn)
    mode_ids = _mode_id_map(conn)
    bus_mode = mode_ids.get("bus")
    for (name, typ, lat, lng) in LOCATIONS:
        row = conn.execute(
            """
            SELECT transportation_location_id FROM transportation.transportation_locations
            WHERE name = %s AND study_area_id = %s
            """,
            (name, study_id),
        ).fetchone()
        if not row:
            conn.execute(
                f"""
                INSERT INTO transportation.transportation_locations
                    (study_area_id, transportation_mode_id, name, location_type,
                     lat, lng, geometry, source, status)
                VALUES (%s, %s, %s, %s, %s, %s, {db.geom_write()}, 'manual', 'active')
                """,
                (
                    study_id,
                    bus_mode if typ == "bus_stop" else None,
                    name, typ, lat, lng,
                    point_geojson(lat, lng),
                ),
            )


def _ensure_regions(conn) -> None:
    study_id = _study_area_id(conn)
    # 13 urban districts + 2 periphery + "Central Hanoi" marker, then the
    # rural districts that appear in the Kaggle survey (dataHN.csv `oridist`)
    # so decision.vehicle_survey_responses can link region_id for every row.
    names = [
        "Hoan Kiem", "Ba Dinh", "Dong Da", "Hai Ba Trung", "Cau Giay",
        "Thanh Xuan", "Tay Ho", "Ha Dong", "Nam Tu Liem", "Hoang Mai",
        "Long Bien", "Soc Son", "Dong Anh", "Central Hanoi",
        "Bac Tu Liem", "Gia Lam", "Hoai Duc", "Thanh Tri", "Ba Vi",
        "Chuong My", "Dan Phuong", "Me Linh", "My Duc", "Phu Xuyen",
        "Phuc Tho", "Quoc Oai", "Son Tay", "Thach That", "Thanh Oai",
        "Thuong Tin", "Ung Hoa",
    ]
    for name in names:
        conn.execute(
            """
            INSERT INTO gis.administrative_regions
                (study_area_id, name, region_type, source, status)
            SELECT %s, %s, 'DISTRICT', 'manual', 'active'
            WHERE NOT EXISTS (
                SELECT 1 FROM gis.administrative_regions
                WHERE study_area_id = %s AND name = %s
            )
            """,
            (study_id, name, study_id, name),
        )


def _backfill_trip_regions(conn) -> None:
    """Trips migrated before regions existed — link origin_region_id now."""
    conn.execute(
        """
        UPDATE trip.trips t
        SET origin_region_id = r.region_id
        FROM gis.administrative_regions r
        WHERE r.name = t.origin_district AND t.origin_region_id IS NULL
        """
    )


def _ensure_demo_trips(conn) -> None:
    count = conn.execute("SELECT count(*) AS c FROM trip.trips").fetchone()["c"]
    if count >= 50:
        return
    study_id = _study_area_id(conn)
    mode_ids = _mode_id_map(conn)
    vt_rows = conn.execute(
        """
        SELECT vt.vehicle_type_id, tm.code AS mode_code
        FROM policy.vehicle_types vt
        JOIN transportation.transportation_modes tm
          ON tm.transportation_mode_id = vt.transportation_mode_id
        """
    ).fetchall()
    vt_by_mode = {r["mode_code"]: int(r["vehicle_type_id"]) for r in vt_rows}
    regions = conn.execute(
        "SELECT region_id, name FROM gis.administrative_regions WHERE study_area_id = %s",
        (study_id,),
    ).fetchall()
    region_by_name = {r["name"]: int(r["region_id"]) for r in regions}
    central = region_by_name.get("Central Hanoi")

    rng = random.Random(48)
    now = datetime.now(timezone.utc)
    mode_codes = [m[0] for m in MODES]
    for _ in range(140):
        mode = rng.choice(mode_codes)
        top = rng.choice(mode_codes)
        switched = rng.random() < 0.3
        created = now - timedelta(days=rng.randint(0, 29), hours=rng.randint(0, 9))
        o_lat = 20.98 + rng.random() * 0.06
        o_lng = 105.78 + rng.random() * 0.09
        d_lat = 20.98 + rng.random() * 0.06
        d_lng = 105.78 + rng.random() * 0.09
        district = rng.choice(DISTRICTS)
        conn.execute(
            f"""
            INSERT INTO trip.trips
                (study_area_id, origin_name, destination_name, origin, destination,
                 origin_lat, origin_lng, dest_lat, dest_lng,
                 origin_region_id, destination_region_id, origin_district,
                 vehicle_type_id, chosen_vehicle_type_id, switched,
                 top_mode_id, top_score, travel_time, departure_hour,
                 trip_purpose, preferences, distance_km, duration_min,
                 lez_affected, avg_cost_vnd, avg_time_min, created_at)
            VALUES (%s,%s,%s,{db.geom_write()},{db.geom_write()},%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                study_id,
                rng.choice(PLACES), rng.choice(PLACES),
                point_geojson(o_lat, o_lng),
                point_geojson(d_lat, d_lng),
                o_lat, o_lng, d_lat, d_lng,
                region_by_name.get(district, central), None, district,
                vt_by_mode.get(mode), vt_by_mode.get(rng.choice(mode_codes)) if switched else None,
                switched,
                mode_ids.get(top), 0.5 + rng.random() * 0.45,
                created, rng.randint(0, 23),
                rng.choice(PURPOSES), "{}",
                2 + rng.random() * 14, 10 + rng.random() * 45,
                rng.random() < 0.45,
                float(rng.randint(5000, 95000)), 10 + rng.random() * 45,
                created,
            ),
        )


# --------------------------------------------------------------------------
# One-shot legacy migration (pre DB-FINAL layouts) — copy, then drop
# --------------------------------------------------------------------------

def migrate_legacy(conn) -> None:
    """Copy rows from old layouts into the final tables, then drop them.

    Layout A (original): flat snake_case tables in public.
    Layout B (Task 56):  singular names inside the 6 schemas
                         (core.admin_user, policy.lez_zone, trip.trip_record, …).
    """
    _ensure_study_area(conn)
    study_id = _study_area_id(conn)

    admin_src = session_src = mode_src = loc_src = None
    zone_src = rule_src = crit_src = aq_src = trend_src = run_src = trip_src = None

    # ---- admins + sessions -------------------------------------------------
    admin_src = "core.admin_user" if _exists(conn, "core.admin_user") else (
        "public.admin_user" if _exists(conn, "public.admin_user") else None
    )
    if admin_src:
        conn.execute(
            f"""
            INSERT INTO core.admins (username, password_hash, full_name, created_at)
            SELECT username, password_hash, full_name, created_at FROM {admin_src}
            ON CONFLICT (username) DO NOTHING
            """
        )
        session_src = "core.admin_session" if _exists(conn, "core.admin_session") else (
            "public.admin_session" if _exists(conn, "public.admin_session") else None
        )
        if session_src:
            conn.execute(
                f"""
                INSERT INTO core.admin_sessions (admin_id, token, expires_at, created_at)
                SELECT a.admin_id, s.token, s.expires_at, s.created_at
                FROM {session_src} s
                JOIN {admin_src} u ON u.id = s.user_id
                JOIN core.admins a ON a.username = u.username
                ON CONFLICT (token) DO NOTHING
                """
            )

    # ---- transportation modes ---------------------------------------------
    mode_src = "transportation.transport_mode" if _exists(conn, "transportation.transport_mode") else (
        "public.transport_mode" if _exists(conn, "public.transport_mode") else None
    )
    if mode_src:
        conn.execute(
            f"""
            INSERT INTO transportation.transportation_modes
                (code, name, description, icon, routing_profile, avg_speed_kmh,
                 base_fare, cost_per_km, co2_per_km_g, accessibility_score,
                 convenience_score, avg_wait_min, is_active, sort_order)
            SELECT id, name, description, icon, 'driving', avg_speed_kmh,
                   base_cost_vnd, cost_per_km_vnd, co2_per_km_g,
                   base_accessibility, base_convenience, wait_minutes,
                   enabled, sort_order
            FROM {mode_src}
            ON CONFLICT (code) DO NOTHING
            """
        )

    # ---- vehicle types (needed before migrating rules) ---------------------
    _ensure_modes(conn)
    _ensure_vehicle_types(conn)
    mode_ids = _mode_id_map(conn)
    vt_rows = conn.execute(
        """
        SELECT vt.vehicle_type_id, tm.code AS mode_code
        FROM policy.vehicle_types vt
        JOIN transportation.transportation_modes tm
          ON tm.transportation_mode_id = vt.transportation_mode_id
        """
    ).fetchall()
    vt_by_mode = {r["mode_code"]: int(r["vehicle_type_id"]) for r in vt_rows}

    # ---- locations ----------------------------------------------------------
    loc_src = "transportation.transportation_location" if _exists(conn, "transportation.transportation_location") else (
        "public.transportation_location" if _exists(conn, "public.transportation_location") else None
    )
    if loc_src:
        conn.execute(
            f"""
            INSERT INTO transportation.transportation_locations
                (study_area_id, transportation_mode_id, name, location_type,
                 lat, lng, geometry, source, status)
            SELECT %s,
                   (SELECT transportation_mode_id FROM transportation.transportation_modes
                     WHERE code = 'bus' AND src.type = 'bus_stop'),
                   src.name, src.type, src.lat, src.lng,
                   ST_SetSRID(ST_MakePoint(src.lng, src.lat), 4326),
                   'manual',
                   CASE WHEN src.active THEN 'active' ELSE 'inactive' END
            FROM {loc_src} src
            WHERE NOT EXISTS (
                SELECT 1 FROM transportation.transportation_locations l
                WHERE l.name = src.name AND l.study_area_id = %s
            )
            """,
            (study_id, study_id),
        )

    # ---- LEZ zones ----------------------------------------------------------
    zone_src = "policy.lez_zone" if _exists(conn, "policy.lez_zone") else (
        "public.lez_zone" if _exists(conn, "public.lez_zone") else None
    )
    if zone_src:
        # legacy rows carry the [[lat,lng],…] ring as JSON text — rebuild the
        # DB FINAL geometry from it (Python-side so bad rows can be skipped).
        # Legacy columns: id, name, description, coordinates, active(bool), …
        for z in conn.execute(f"SELECT * FROM {zone_src}").fetchall():
            exists = conn.execute(
                "SELECT 1 FROM policy.lez_zones WHERE name = %s", (z["name"],)
            ).fetchone()
            if exists:
                continue
            try:
                pts = json.loads(z["coordinates"]) if z["coordinates"] else None
                if not isinstance(pts, list) or len(pts) < 3:
                    print(f"legacy zone skipped (bad ring): {z['name']}")
                    continue
                conn.execute(
                    f"""
                    INSERT INTO policy.lez_zones (study_area_id, name, description,
                        geometry, status, created_at, updated_at)
                    VALUES (%s, %s, %s, {db.geom_write(multi=True)}, %s, %s, %s)
                    """,
                    (
                        study_id, z["name"], z["description"],
                        polygon_geojson_from_pairs(pts),
                        "active" if z.get("active", True) else "inactive",
                        z.get("created_at"), z.get("updated_at"),
                    ),
                )
            except Exception as exc:
                print(f"legacy zone migration warning ({z['name']}): {exc!r}")

    # ---- policy rules -> lez_rules + vehicle_restrictions -------------------
    rule_src = "policy.policy_rule" if _exists(conn, "policy.policy_rule") else (
        "public.policy_rule" if _exists(conn, "public.policy_rule") else None
    )
    if rule_src:
        # old zone_id is the old TEXT id — map it to the new BIGSERIAL zone
        # through the zone name (old zone rows are still available above).
        zone_id_map: dict = {}
        if zone_src:
            for z in conn.execute(f"SELECT id, name FROM {zone_src}").fetchall():
                row = conn.execute(
                    "SELECT lez_zone_id FROM policy.lez_zones WHERE name = %s",
                    (z["name"],),
                ).fetchone()
                if row:
                    zone_id_map[z["id"]] = int(row["lez_zone_id"])
        ring1 = conn.execute(
            "SELECT lez_zone_id FROM policy.lez_zones WHERE name = %s",
            (ZONE_RING1_NAME,),
        ).fetchone()
        fallback_zone_id = int(ring1["lez_zone_id"]) if ring1 else None
        old_rules = conn.execute(
            f"SELECT * FROM {rule_src} ORDER BY created_at ASC"
        ).fetchall()
        for r in old_rules:
            new_zone_id = zone_id_map.get(r["zone_id"]) or fallback_zone_id
            if not new_zone_id:
                continue
            rule_name = (
                f"{'Cấm' if r['restriction_type'] == 'banned' else 'Hạn chế có điều kiện'} — {r['mode_id']}"
            )
            new_rule_id = int(
                conn.execute(
                    """
                    INSERT INTO policy.lez_rules (lez_zone_id, rule_name, description,
                        start_time, end_time, days_of_week, effective_from, status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s,
                            CASE WHEN %s THEN 'active' ELSE 'inactive' END)
                    RETURNING lez_rule_id
                    """,
                    (
                        new_zone_id, rule_name, r["condition"],
                        r["start_time"], r["end_time"], r["days"],
                        RING1_EFFECTIVE_FROM, r["active"],
                    ),
                ).fetchone()["lez_rule_id"]
            )
            vt_id = vt_by_mode.get(r["mode_id"])
            if vt_id:
                conn.execute(
                    """
                    INSERT INTO policy.vehicle_restrictions
                        (lez_rule_id, vehicle_type_id, restriction_type,
                         min_emission_level, restriction_reason)
                    VALUES (%s, %s, %s, 0, %s)
                    """,
                    (new_rule_id, vt_id, r["restriction_type"], r["condition"]),
                )

    # ---- criteria weights ----------------------------------------------------
    crit_src = "decision.criteria_weight" if _exists(conn, "decision.criteria_weight") else (
        "public.criteria_weight" if _exists(conn, "public.criteria_weight") else None
    )
    if crit_src:
        conn.execute(
            f"""
            INSERT INTO decision.recommendation_criteria
                (code, name, criteria_type, default_weight, description)
            SELECT criterion, label,
                   CASE WHEN criterion IN ('travelTime','cost') THEN 'COST' ELSE 'BENEFIT' END,
                   weight, 'Tiêu chí MCDM (migrated)'
            FROM {crit_src}
            ON CONFLICT (code) DO NOTHING
            """
        )

    # ---- air quality cache ---------------------------------------------------
    aq_src = "decision.air_quality_cache" if _exists(conn, "decision.air_quality_cache") else (
        "public.air_quality_cache" if _exists(conn, "public.air_quality_cache") else None
    )
    if aq_src:
        old_aq = conn.execute(f"SELECT * FROM {aq_src}").fetchall()
        for r in old_aq:
            try:
                payload = json.loads(r["payload"]) if isinstance(r["payload"], str) else dict(r["payload"])
            except Exception:
                continue
            try:
                lat_s, lng_s = str(r["cache_key"]).split(":")
                lat, lng = float(lat_s), float(lng_s)
            except Exception:
                lat = lng = 0.0
            conn.execute(
                f"""
                INSERT INTO decision.air_quality_observations
                    (cache_key, study_area_id, source, lat, lng, location,
                     observed_at, aqi, pm25, pm10, raw_data)
                VALUES (%s, %s, 'open-meteo', %s, %s, {db.geom_write()}, %s, %s, %s, %s, %s)
                ON CONFLICT (cache_key) DO NOTHING
                """,
                (
                    r["cache_key"], study_id, lat, lng,
                    point_geojson(lat, lng),
                    r["fetched_at"], payload.get("aqi"), payload.get("pm25"),
                    payload.get("pm10"), json.dumps(payload),
                ),
            )

    # ---- dataset pipeline outputs ---------------------------------------------
    trend_src = "decision.dataset_trend" if _exists(conn, "decision.dataset_trend") else (
        "public.dataset_trend" if _exists(conn, "public.dataset_trend") else None
    )
    if trend_src:
        conn.execute(
            f"""
            INSERT INTO decision.dataset_trends
                (transportation_mode_id, month, share, trend_index, sample_count)
            SELECT m.transportation_mode_id, t.month, t.share, t.trend_index, t.sample_count
            FROM {trend_src} t
            JOIN transportation.transportation_modes m ON m.code = t.mode_id
            ON CONFLICT (transportation_mode_id, month) DO NOTHING
            """
        )
    run_src = "decision.dataset_run" if _exists(conn, "decision.dataset_run") else (
        "public.dataset_run" if _exists(conn, "public.dataset_run") else None
    )
    if run_src:
        conn.execute(
            f"""
            INSERT INTO core.dataset_runs (ran_at, source_file, rows_in, rows_clean, notes)
            SELECT ran_at, source_file, rows_in, rows_clean, notes FROM {run_src}
            """
        )

    # ---- trips ---------------------------------------------------------------
    trip_src = "trip.trip_record" if _exists(conn, "trip.trip_record") else (
        "public.trip_record" if _exists(conn, "public.trip_record") else None
    )
    if trip_src:
        regions = conn.execute(
            "SELECT region_id, name FROM gis.administrative_regions WHERE study_area_id = %s",
            (study_id,),
        ).fetchall()
        region_by_name = {r["name"]: int(r["region_id"]) for r in regions}
        old_trips = conn.execute(f"SELECT * FROM {trip_src} ORDER BY created_at ASC").fetchall()
        for t in old_trips:
            district = t["origin_district"] or "Central Hanoi"
            o_lat, o_lng = float(t["origin_lat"]), float(t["origin_lng"])
            d_lat, d_lng = float(t["dest_lat"]), float(t["dest_lng"])
            conn.execute(
                f"""
                INSERT INTO trip.trips
                    (study_area_id, origin_name, destination_name, origin, destination,
                     origin_lat, origin_lng, dest_lat, dest_lng,
                     origin_region_id, destination_region_id, origin_district,
                     vehicle_type_id, chosen_vehicle_type_id, switched,
                     top_mode_id, top_score, travel_time, departure_hour,
                     trip_purpose, preferences, distance_km, duration_min,
                     lez_affected, avg_cost_vnd, avg_time_min, created_at)
                VALUES (%s,%s,%s,{db.geom_write()},{db.geom_write()},%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    study_id, t["origin_name"], t["dest_name"],
                    point_geojson(o_lat, o_lng),
                    point_geojson(d_lat, d_lng),
                    o_lat, o_lng, d_lat, d_lng,
                    region_by_name.get(district), None, district,
                    vt_by_mode.get(t["vehicle_id"]),
                    vt_by_mode.get(t["chosen_mode_id"]) if t["chosen_mode_id"] else None,
                    bool(t["switched"]),
                    mode_ids.get(t["top_mode_id"]) or list(mode_ids.values())[0],
                    float(t["top_score"] or 0),
                    t["created_at"], int(t["departure_hour"] or 0),
                    t["purpose"] or "other", "{}",
                    float(t["distance_km"] or 0), float(t["duration_min"] or 0),
                    bool(t["lez_affected"]),
                    float(t["avg_cost_vnd"] or 0), float(t["avg_time_min"] or 0),
                    t["created_at"],
                ),
            )

    # ---- drop the legacy tables (data is now copied) ---------------------------
    for src in (
        admin_src, session_src, mode_src, loc_src, zone_src, rule_src,
        crit_src, aq_src, trend_src, run_src, trip_src,
    ):
        if src:
            conn.execute(f"DROP TABLE IF EXISTS {src} CASCADE")


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def seed() -> None:
    with db.get_conn() as conn:
        migrate_legacy(conn)
        _ensure_admin(conn)
        _ensure_study_area(conn)
        _ensure_modes(conn)
        _ensure_vehicle_types(conn)
        _ensure_criteria(conn)
        _ensure_zone_and_rules(conn)
        _ensure_locations(conn)
        _ensure_regions(conn)
        _backfill_trip_regions(conn)
        _ensure_demo_trips(conn)
    print("Seed completed.")


if __name__ == "__main__":
    db.init_db()
    seed()
