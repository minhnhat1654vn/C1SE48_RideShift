"""Seed the RideShift PostgreSQL database (port of prisma/seed.ts).

Run manually:  python3 -m app.seed
Also invoked automatically on backend startup when the DB is empty.
"""
import hashlib
import json
import random
import uuid
from datetime import datetime, timedelta, timezone

from . import db

SALT = "rideshift-c1se48"


def _hash(password: str) -> str:
    return f"{SALT}${hashlib.sha256(f'{SALT}:{password}'.encode()).hexdigest()}"


MODES = [
    ("gasoline_motorbike", "Xe máy xăng", "motorbike", "Xe máy xăng thông thường", 24, 0, 320, 113, 0.92, 0.85, 0, 1),
    ("electric_motorbike", "Xe máy điện", "zap", "Xe máy điện dùng pin (VinFast, Yadea…)", 23, 0, 120, 18, 0.88, 0.80, 0, 2),
    ("private_car", "Ô tô cá nhân", "car", "Ô tô sở hữu cá nhân", 22, 5000, 850, 168, 0.80, 0.88, 0, 3),
    ("bus", "Xe buýt", "bus", "Xe buýt công cộng", 17, 7000, 0, 42, 0.55, 0.50, 10, 4),
    ("taxi", "Taxi / Công nghệ", "car-taxi-front", "Dịch vụ taxi hoặc gọi xe công nghệ (Grab, Be…)", 26, 11000, 12500, 150, 0.95, 0.90, 5, 5),
    ("bicycle", "Xe đạp", "bike", "Xe đạp", 12, 0, 0, 0, 0.72, 0.55, 0, 6),
    ("walking", "Đi bộ", "footprints", "Đi bộ", 4.5, 0, 0, 0, 0.60, 0.40, 0, 7),
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
# Quy định theo file quy_dinh_vanh_dai_1.txt (Chỉ thị số 20/CT-TTg):
#   - Cấm hoàn toàn xe mô tô, xe gắn máy (hai bánh) nhiên liệu hóa thạch
#     (xăng, dầu) trong toàn bộ Vành đai 1 — 24/7, hiệu lực từ 01/07/2026.
#   - Xe máy điện, xe đạp điện, năng lượng xanh, giao thông công cộng: được phép.
#   - Ô tô xăng/dầu chưa bị cấm hoàn toàn — chỉ chịu phí cao hơn (trước bạ,
#     cấp biển số, trông giữ) theo lộ trình từ Quý III/2025.
# Vành đai 2 năm sau mới áp dụng — không tạo vùng trong giai đoạn này.
RULES = [
    ("zone-ring-road-1", "gasoline_motorbike", "banned",
     "Cấm hoàn toàn xe mô tô, xe gắn máy (hai bánh) sử dụng nhiên liệu hóa "
     "thạch (xăng, dầu) trong phạm vi Vành đai 1 — 24/7, có hiệu lực từ "
     "01/07/2026 theo Chỉ thị số 20/CT-TTg.",
     "00:00", "23:59", "Mon,Tue,Wed,Thu,Fri,Sat,Sun"),
    ("zone-ring-road-1", "private_car", "conditional",
     "Ô tô chạy xăng/dầu chưa bị cấm hoàn toàn ở giai đoạn Vành đai 1, "
     "nhưng chịu mức phí trước bạ, phí cấp biển số và phí trông giữ cao "
     "hơn tại khu vực trung tâm theo lộ trình tăng dần từ Quý III/2025.",
     "00:00", "23:59", "Mon,Tue,Wed,Thu,Fri,Sat,Sun"),
]

WEIGHTS = [
    ("travelTime", 25, "Thời gian di chuyển"),
    ("cost", 20, "Chi phí ước tính"),
    ("lezCompliance", 20, "Tuân thủ LEZ"),
    ("accessibility", 10, "Khả năng tiếp cận"),
    ("convenience", 10, "Thuận tiện"),
    ("environment", 10, "Tác động môi trường"),
    ("trend", 5, "Xu hướng khảo sát"),
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


def seed() -> None:
    with db.get_conn() as conn:
        # Admin user
        conn.execute(
            """
            INSERT INTO admin_user (id, username, password_hash, full_name)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (username) DO NOTHING
            """,
            (uuid.uuid4().hex, "admin", _hash("admin123"), "Quản trị viên hệ thống"),
        )

        # Transport modes
        for (mid, name, icon, desc, speed, base, perkm, co2, acc, conv, wait, order) in MODES:
            conn.execute(
                """
                INSERT INTO transport_mode (id, name, description, icon, avg_speed_kmh,
                    base_cost_vnd, cost_per_km_vnd, co2_per_km_g, base_accessibility,
                    base_convenience, wait_minutes, enabled, sort_order)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true,%s)
                ON CONFLICT (id) DO UPDATE SET
                    name=EXCLUDED.name, description=EXCLUDED.description, icon=EXCLUDED.icon,
                    avg_speed_kmh=EXCLUDED.avg_speed_kmh, base_cost_vnd=EXCLUDED.base_cost_vnd,
                    cost_per_km_vnd=EXCLUDED.cost_per_km_vnd, co2_per_km_g=EXCLUDED.co2_per_km_g,
                    base_accessibility=EXCLUDED.base_accessibility,
                    base_convenience=EXCLUDED.base_convenience, wait_minutes=EXCLUDED.wait_minutes,
                    sort_order=EXCLUDED.sort_order
                """,
                (mid, name, desc, icon, speed, base, perkm, co2, acc, conv, wait, order),
            )

        # LEZ zone duy nhất: Vành đai 1 (Vành đai 2 năm sau mới áp dụng — không tạo)
        conn.execute(
            """
            INSERT INTO lez_zone (id, name, description, coordinates, active)
            VALUES (%s, %s, %s, %s, true)
            ON CONFLICT (id) DO UPDATE SET coordinates = EXCLUDED.coordinates,
                description = EXCLUDED.description
            """,
            (
                "zone-ring-road-1",
                "Vùng phát thải thấp Vành đai 1",
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
                "thuộc quận Hoàn Kiếm.",
                json.dumps(RING1),
            ),
        )
        # Xoá các vùng cũ không còn dùng (idempotent)
        conn.execute(
            "DELETE FROM lez_zone WHERE id = ANY(%s)",
            (["zone-old-quarter", "zone-ring-road-2", "zone-hoan-kiem-lake"],),
        )


        # Policy rules — xoá rule cũ của các vùng quản lý rồi chèn bộ mới
        conn.execute(
            "DELETE FROM policy_rule WHERE zone_id = ANY(%s)",
            (["zone-ring-road-1", "zone-ring-road-2", "zone-hoan-kiem-lake",
              "zone-old-quarter"],),
        )
        for (zone_id, mid, rtype, cond, start, end, days) in RULES:
            conn.execute(
                """
                INSERT INTO policy_rule (id, zone_id, mode_id, restriction_type,
                    condition, start_time, end_time, days, active)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, true)
                """,
                (uuid.uuid4().hex, zone_id, mid, rtype, cond, start, end, days),
            )

        # Criteria weights
        for (crit, w, label) in WEIGHTS:
            conn.execute(
                """
                INSERT INTO criteria_weight (id, criterion, weight, label)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (criterion) DO UPDATE SET weight = EXCLUDED.weight, label = EXCLUDED.label
                """,
                (uuid.uuid4().hex, crit, w, label),
            )

        # Transportation locations
        for (name, typ, lat, lng) in LOCATIONS:
            row = conn.execute(
                "SELECT id FROM transportation_location WHERE name = %s", (name,)
            ).fetchone()
            if not row:
                conn.execute(
                    """
                    INSERT INTO transportation_location (id, name, type, lat, lng, active)
                    VALUES (%s, %s, %s, %s, %s, true)
                    """,
                    (uuid.uuid4().hex, name, typ, lat, lng),
                )

        # Demo trip records for analytics
        count = conn.execute("SELECT count(*) AS c FROM trip_record").fetchone()["c"]
        if count < 50:
            rng = random.Random(48)
            now = datetime.now(timezone.utc)
            mode_ids = [m[0] for m in MODES]
            rows = []
            for _ in range(140):
                mode = rng.choice(mode_ids)
                top = rng.choice(mode_ids)
                switched = rng.random() < 0.3
                created = now - timedelta(days=rng.randint(0, 29), hours=rng.randint(0, 9))
                rows.append(
                    (
                        uuid.uuid4().hex,
                        rng.choice(PLACES),
                        rng.choice(PLACES),
                        rng.choice(DISTRICTS),
                        20.98 + rng.random() * 0.06,
                        105.78 + rng.random() * 0.09,
                        20.98 + rng.random() * 0.06,
                        105.78 + rng.random() * 0.09,
                        2 + rng.random() * 14,
                        10 + rng.random() * 45,
                        mode,
                        rng.choice(PURPOSES),
                        rng.randint(0, 23),
                        rng.random() < 0.45,
                        top,
                        0.5 + rng.random() * 0.45,
                        float(rng.randint(5000, 95000)),
                        10 + rng.random() * 45,
                        rng.choice(mode_ids) if switched else None,
                        switched,
                        created,
                    )
                )
            for row_ in rows:
                conn.execute(
                    """
                    INSERT INTO trip_record (id, origin_name, dest_name, origin_district,
                        origin_lat, origin_lng, dest_lat, dest_lng, distance_km, duration_min,
                        vehicle_id, purpose, departure_hour, lez_affected, top_mode_id,
                        top_score, avg_cost_vnd, avg_time_min, chosen_mode_id, switched, created_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    row_,
                )
    print("Seed completed.")


if __name__ == "__main__":
    db.init_db()
    seed()
