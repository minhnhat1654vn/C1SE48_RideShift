#!/usr/bin/env python3
"""Translate the ALREADY-SEEDED RideShift database display data to Vietnamese.

Idempotent one-shot migration (Task 24-e):
  - transport_mode            : UPDATE name/description by exact seed id
  - lez_zone                  : UPDATE name/description by exact seed zone id
  - policy_rule               : UPDATE condition WHERE it exactly equals one of
                                the OLD English seed strings (admin-edited
                                conditions are therefore preserved)
  - transportation_location   : UPDATE name WHERE it exactly equals an OLD
                                English seed name
  - criteria_weight           : UPDATE label WHERE criterion = seed key AND
                                label still equals the OLD English label
  - admin_user                : UPDATE full_name for username='admin' WHERE it
                                still equals the OLD English value

Every WHERE clause matches nothing after a successful run, so re-running is
safe (prints 0 updated rows). Admin-created custom rows (e.g. the
"ebus_shuttle" mode) are never touched.

Usage:  python3 scripts/translate_seed_data_vi.py
DB:     postgresql://postgres@127.0.0.1:5432/rideshift
"""
import psycopg

DSN = "postgresql://postgres@127.0.0.1:5432/rideshift"

# (id, new_name, new_description) — ids are the seed ids from app/seed.py
MODES = [
    ("gasoline_motorbike", "Xe máy xăng", "Xe máy xăng thông thường"),
    ("electric_motorbike", "Xe máy điện", "Xe máy điện dùng pin (VinFast, Yadea…)"),
    ("private_car", "Ô tô cá nhân", "Ô tô sở hữu cá nhân"),
    ("bus", "Xe buýt", "Xe buýt công cộng"),
    ("taxi", "Taxi / Công nghệ", "Dịch vụ taxi hoặc gọi xe công nghệ (Grab, Be…)"),
    ("bicycle", "Xe đạp", "Xe đạp"),
    ("walking", "Đi bộ", "Đi bộ"),
]

# (zone_id, new_name, new_description)
ZONES = [
    (
        "zone-ring-road-1",
        "Vùng phát thải thấp Vành đai 1",
        "Vùng phát thải thấp thí điểm cho khu vực Vành đai 1 theo Kế hoạch LEZ "
        "Hà Nội 2025-2026. Hạn chế phương tiện phát thải cao trong giờ ban ngày.",
    ),
    (
        "zone-old-quarter",
        "Vùng thí điểm Phố cổ",
        "Vùng phát thải thấp thí điểm bổ sung bao phủ khu Phố cổ phục vụ mục "
        "đích trình diễn.",
    ),
]

# (old_condition_en, new_condition_vi) — exact-string match only
RULES = [
    (
        "Must meet Euro 3 standard or newer (registered from 2015). "
        "Motorbikes registered before 2015 are not permitted.",
        "Phải đạt chuẩn Euro 3 trở lên (đăng ký từ 2015). Xe máy đăng ký "
        "trước 2015 không được phép.",
    ),
    (
        "Must meet Euro 4 emission standard or newer (registered from 2018).",
        "Phải đạt chuẩn khí thải Euro 4 trở lên (đăng ký từ 2018).",
    ),
    (
        "Only CNG, electric or Euro 5+ buses are permitted inside the zone.",
        "Chỉ xe buýt CNG, điện hoặc chuẩn Euro 5+ được phép vào vùng.",
    ),
    (
        "Allowed all day; some streets restrict cycling during peak hours.",
        "Được phép cả ngày; một số phố hạn chế xe đạp giờ cao điểm.",
    ),
    (
        "Allowed all day; some pedestrian-only streets in the Old Quarter.",
        "Được phép cả ngày; một số phố ở Phố cổ chỉ dành cho người đi bộ.",
    ),
    (
        "Fully permitted — zero tailpipe emission vehicles are exempt.",
        "Được phép hoàn toàn — xe không phát thải ống xả được miễn.",
    ),
    (
        "Only hybrid, electric or Euro 5 vehicles permitted.",
        "Chỉ xe hybrid, điện hoặc chuẩn Euro 5 được phép.",
    ),
]

# (old_name_en, new_name_vi) — exact-string match only
LOCATIONS = [
    ("Giap Bat Bus Station", "Bến xe Giáp Bát"),
    ("My Dinh Bus Station", "Bến xe Mỹ Đình"),
    ("Nuoc Ngam Bus Station", "Bến xe Nước Ngầm"),
    ("Long Bien Bus Station", "Bến xe Long Biên"),
    ("Kim Ma Bus Station", "Bến xe Kim Mã"),
    ("Gia Lam Bus Station", "Bến xe Gia Lâm"),
    ("Yen Nghia Bus Station", "Bến xe Yên Nghĩa"),
    ("Cat Linh Metro Station (Line 2A)", "Ga metro Cát Linh (tuyến 2A)"),
    ("Thuong Dinh Metro Station (Line 2A)", "Ga metro Thượng Đình (tuyến 2A)"),
    ("La Khe Metro Station (Line 2A)", "Ga metro La Khê (tuyến 2A)"),
    ("BRT Trung Yen Stop", "Trạm BRT Trung Yên"),
    ("BRT Nguyen Trai Stop", "Trạm BRT Nguyễn Trãi"),
]

# (criterion_key, old_label_en, new_label_vi) — key + exact old label match
WEIGHTS = [
    ("travelTime", "Travel Time", "Thời gian di chuyển"),
    ("cost", "Estimated Cost", "Chi phí ước tính"),
    ("lezCompliance", "LEZ Compliance", "Tuân thủ LEZ"),
    ("accessibility", "Accessibility", "Khả năng tiếp cận"),
    ("convenience", "Convenience", "Thuận tiện"),
    ("environment", "Environmental Impact", "Tác động môi trường"),
    ("trend", "Survey-based Trend", "Xu hướng khảo sát"),
]


def main() -> None:
    with psycopg.connect(DSN) as conn:
        n_modes = 0
        for mid, name, desc in MODES:
            cur = conn.execute(
                """
                UPDATE transport_mode
                SET name = %s, description = %s
                WHERE id = %s
                  AND (name IS DISTINCT FROM %s OR description IS DISTINCT FROM %s)
                """,
                (name, desc, mid, name, desc),
            )
            n_modes += cur.rowcount

        n_zones = 0
        for zid, name, desc in ZONES:
            cur = conn.execute(
                """
                UPDATE lez_zone
                SET name = %s, description = %s
                WHERE id = %s
                  AND (name IS DISTINCT FROM %s OR description IS DISTINCT FROM %s)
                """,
                (name, desc, zid, name, desc),
            )
            n_zones += cur.rowcount

        n_rules = 0
        for old, new in RULES:
            cur = conn.execute(
                "UPDATE policy_rule SET condition = %s WHERE condition = %s",
                (new, old),
            )
            n_rules += cur.rowcount

        n_locs = 0
        for old, new in LOCATIONS:
            cur = conn.execute(
                "UPDATE transportation_location SET name = %s WHERE name = %s",
                (new, old),
            )
            n_locs += cur.rowcount

        # Dedupe safeguard: if the backend re-seeded (name-only lookup) while
        # this script had already renamed the seed rows, duplicate landmark
        # rows can exist (English re-inserts, later renamed into Vietnamese
        # twins). Remove ANY row carrying a seed landmark name (old EN or new
        # VI) that has an identical (name, type, lat, lng) twin with a smaller
        # id — keeps exactly one row per seed landmark, touches nothing else.
        n_dupes = 0
        seed_names = [old for old, _n in LOCATIONS] + [n for _o, n in LOCATIONS]
        cur = conn.execute(
            """
            DELETE FROM transportation_location t
            USING transportation_location v
            WHERE t.name = ANY(%s)
              AND v.name = t.name AND v.type = t.type
              AND v.lat = t.lat AND v.lng = t.lng
              AND v.id <> t.id AND v.id < t.id
            """,
            (seed_names,),
        )
        n_dupes = cur.rowcount

        n_weights = 0
        for crit, old, new in WEIGHTS:
            cur = conn.execute(
                "UPDATE criteria_weight SET label = %s WHERE criterion = %s AND label = %s",
                (new, crit, old),
            )
            n_weights += cur.rowcount

        cur = conn.execute(
            """
            UPDATE admin_user SET full_name = 'Quản trị viên hệ thống'
            WHERE username = 'admin' AND full_name = 'System Administrator'
            """
        )
        n_admin = cur.rowcount

    print(f"transport_mode:           {n_modes} row(s) updated")
    print(f"lez_zone:                 {n_zones} row(s) updated")
    print(f"policy_rule (condition):  {n_rules} row(s) updated")
    print(f"transportation_location:  {n_locs} row(s) updated")
    print(f"transportation_location:  {n_dupes} duplicate row(s) removed")
    print(f"criteria_weight (label):  {n_weights} row(s) updated")
    print(f"admin_user (full_name):   {n_admin} row(s) updated")
    print("Done. Safe to re-run — subsequent runs update 0 rows.")


if __name__ == "__main__":
    main()
