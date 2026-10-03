#!/usr/bin/env python3
"""Task 29 — Cập nhật DB theo file quy_dinh_vanh_dai_1.txt (Chỉ thị 20/CT-TTg):

1. UPDATE zone-ring-road-1: polygon Vành đai 1 mới + mô tả theo file.
2. DELETE zone-ring-road-2 (Vành đai 2 năm sau mới áp dụng — user yêu cầu bỏ),
   zone-hoan-kiem-lake, zone-old-quarter (nếu còn).
3. Policy rules mới (xoá toàn bộ rule cũ của vùng quản lý):
   - gasoline_motorbike: BANNED 24/7 toàn bộ Vành đai 1 (hiệu lực 01/07/2026).
   - private_car: CONDITIONAL — chưa cấm, chỉ phí cao hơn (trước bạ, biển số,
     trông giữ) từ Quý III/2025.
4. Đồng bộ geom PostGIS nếu có.

Chạy: /home/z/.venv/bin/python3 scripts/update_ring1_task29.py
"""
import json
import sys
import uuid

sys.path.insert(0, "/home/z/my-project/mini-services/fastapi-backend")
from app.db import get_conn, postgis_available  # noqa: E402

POLY = json.load(open("/tmp/overpass/ring1_v2.json"))

DESC_R1 = (
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

ALL_DAYS = "Mon,Tue,Wed,Thu,Fri,Sat,Sun"

NEW_RULES = [
    (
        "zone-ring-road-1",
        "gasoline_motorbike",
        "banned",
        "Cấm hoàn toàn xe mô tô, xe gắn máy (hai bánh) sử dụng nhiên liệu hóa "
        "thạch (xăng, dầu) trong phạm vi Vành đai 1 — 24/7, có hiệu lực từ "
        "01/07/2026 theo Chỉ thị số 20/CT-TTg.",
        "00:00",
        "23:59",
        ALL_DAYS,
    ),
    (
        "zone-ring-road-1",
        "private_car",
        "conditional",
        "Ô tô chạy xăng/dầu chưa bị cấm hoàn toàn ở giai đoạn Vành đai 1, "
        "nhưng chịu mức phí trước bạ, phí cấp biển số và phí trông giữ cao "
        "hơn tại khu vực trung tâm theo lộ trình tăng dần từ Quý III/2025.",
        "00:00",
        "23:59",
        ALL_DAYS,
    ),
]

MANAGED_ZONES = (
    "zone-ring-road-1",
    "zone-ring-road-2",
    "zone-hoan-kiem-lake",
    "zone-old-quarter",
)


def sync_geom(conn, zone_id: str, coords: list) -> None:
    if not postgis_available():
        return
    try:
        ring = [[float(p[1]), float(p[0])] for p in coords]
        ring.append(ring[0])
        geojson = json.dumps({"type": "Polygon", "coordinates": [ring]})
        conn.execute(
            "UPDATE lez_zone SET geom = ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) "
            "WHERE id = %s",
            (geojson, zone_id),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"  geom sync skipped for {zone_id}: {exc!r}")


def main() -> None:
    poly_json = json.dumps(POLY, ensure_ascii=False)

    with get_conn() as conn:
        # 1) Vành đai 1: polygon + mô tả mới
        conn.execute(
            "UPDATE lez_zone SET coordinates=%s, description=%s, active=true, "
            "updated_at=now() WHERE id='zone-ring-road-1'",
            (poly_json, DESC_R1),
        )
        row = conn.execute(
            "SELECT id FROM lez_zone WHERE id='zone-ring-road-1'"
        ).fetchone()
        print("zone-ring-road-1:",
              "updated" if row else "CREATED",
              f"({len(POLY)} đỉnh)")
        if not row:
            conn.execute(
                "INSERT INTO lez_zone (id, name, description, coordinates, active) "
                "VALUES ('zone-ring-road-1', 'Vùng phát thải thấp Vành đai 1', %s, %s, true)",
                (DESC_R1, poly_json),
            )

        # 2) Xoá các vùng khác (Vành đai 2 — năm sau mới áp dụng; các vùng cũ)
        for zid in ("zone-ring-road-2", "zone-hoan-kiem-lake", "zone-old-quarter"):
            deleted = conn.execute(
                "DELETE FROM lez_zone WHERE id=%s RETURNING id", (zid,)
            ).fetchall()
            print(f"lez_zone '{zid}':", "deleted" if deleted else "not present")

        # 3) Đồng bộ policy rules của vùng quản lý
        deleted_rules = conn.execute(
            "DELETE FROM policy_rule WHERE zone_id = ANY(%s) RETURNING id",
            (list(MANAGED_ZONES),),
        ).fetchall()
        print(f"policy_rule: deleted {len(deleted_rules)} rule cũ")
        for (zone_id, mode_id, rtype, cond, start, end, days) in NEW_RULES:
            conn.execute(
                "INSERT INTO policy_rule (id, zone_id, mode_id, restriction_type, "
                "condition, start_time, end_time, days, active) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, true)",
                (uuid.uuid4().hex, zone_id, mode_id, rtype, cond, start, end, days),
            )
        print(f"policy_rule: inserted {len(NEW_RULES)} rule mới")

        # 4) geom PostGIS (nếu có)
        sync_geom(conn, "zone-ring-road-1", POLY)

        # Xác nhận
        print("\n=== Zones hiện tại ===")
        for z in conn.execute(
            "SELECT id, name, active FROM lez_zone ORDER BY id"
        ).fetchall():
            print(f"  {z['id']:24s} active={z['active']}  {z['name']}")
        print("\n=== Policy rules ===")
        for r in conn.execute(
            "SELECT zone_id, mode_id, restriction_type, start_time, end_time, days "
            "FROM policy_rule ORDER BY zone_id, mode_id"
        ).fetchall():
            print(f"  {r['zone_id']:22s} {r['mode_id']:20s} {r['restriction_type']:11s} "
                  f"{r['start_time']}-{r['end_time']} [{r['days']}]")
        print("\n=== Transport modes ===")
        for m in conn.execute(
            "SELECT id, name FROM transport_mode ORDER BY sort_order"
        ).fetchall():
            print(f"  {m['id']:22s} {m['name']}")


if __name__ == "__main__":
    main()
