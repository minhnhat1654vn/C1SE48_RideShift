"""Import GeoJSON 126 phường/xã Hà Nội → gis.administrative_regions.

Task 51 — YÊU CẦU CHÍNH: map các cột trong file GeoJSON cho khớp DB v2.

Nguồn: public/data/hanoi-wards.geojson (FeatureCollection, 126 feature,
MultiPolygon, WGS84/EPSG:4326 — theo RFC 7946, không có member crs).

BẢNG ÁNH XẠ CỘT (file GeoJSON → DB v2):
  ┌─────────────┬──────────────────────────────────────────────────────────┐
  │ ma_xa       │ gis.administrative_regions.code        (NOT NULL, UNIQUE │
  │             │   theo (study_area_id, code))                            │
  │ ten_xa      │ gis.administrative_regions.name                          │
  │ loai        │ gis.administrative_regions.region_type ("Phường"/"Xã")   │
  │ geometry    │ gis.administrative_regions.geometry (ST_Multi, 4326)     │
  │ (tạo mới)   │ parent_region_id → region_id của cấp THÀNH PHỐ "Hà Nội"  │
  │             │   (row cap-thành-phố được tạo nếu chưa có, parent NULL)  │
  │ (hằng số)   │ source = 'public/data/hanoi-wards.geojson (2025, 34 đơn' │
  │             │   'vị hành chính)'                                       │
  │ ma_tinh,    │ KHÔNG có cột tương ứng trong schema v2 — bản ghi đầy đủ  │
  │ ten_tinh,   │ vẫn nằm trong file tĩnh mà bản đồ (map-view.tsx) fetch   │
  │ cap, stt,   │ trực tiếp; DB chỉ giữ phần cần cho tra cứu không gian    │
  │ dtich_km2,  │ (ST_Contains region lookup) và thống kê theo khu vực.    │
  │ dan_so,     │ Muốn lưu thêm phải ALTER SCHEMA — cần nhóm đồng thuận    │
  │ matdo_km2,  │ (rules.md điều 3).                                       │
  │ sap_nhap,   │                                                          │
  │ tru_so      │                                                          │
  └─────────────┴──────────────────────────────────────────────────────────┘

Chạy: python3 -c "from app.services.geoimport import import_admin_regions;
import_admin_regions()" — hoặc tự chạy khi boot nếu bảng rỗng (seed_v2).
"""
import json
from pathlib import Path

from .. import config, db

CITY_CODE = "01"
CITY_NAME = "Hà Nội"
SOURCE_TAG = "public/data/hanoi-wards.geojson (2025, 34 đơn vị hành chính)"


def _city_region(conn) -> int:
    """Region cấp thành phố (cấp cha của 126 phường/xã); idempotent."""
    row = conn.execute(
        "SELECT region_id FROM gis.administrative_regions WHERE code = %s AND study_area_id = 1",
        (CITY_CODE,),
    ).fetchone()
    if row:
        return int(row["region_id"])
    row = conn.execute(
        """
        INSERT INTO gis.administrative_regions
            (study_area_id, parent_region_id, code, name, region_type,
             geometry, source, status)
        VALUES (1, NULL, %s, %s, 'Thành phố', ST_SetSRID(ST_GeomFromText(
                    'POLYGON((105.27 20.95, 106.07 20.95,
                              106.07 21.38, 105.27 21.38, 105.27 20.95))'),
                    4326), %s, 'ACTIVE')
        RETURNING region_id
        """,
        (CITY_CODE, CITY_NAME, SOURCE_TAG),
    ).fetchone()
    return int(row["region_id"])


def import_admin_regions(geojson_path: Path | None = None, force: bool = False) -> dict:
    """Idempotent import 126 phường/xã; bỏ qua khi bảng đã có ward (trừ force)."""
    path = Path(geojson_path) if geojson_path else config.WARDS_GEOJSON
    with db.get_conn() as conn:
        existing = conn.execute(
            """
            SELECT count(*) AS c FROM gis.administrative_regions
            WHERE region_type IN ('Phường', 'Xã')
            """
        ).fetchone()["c"]
    if existing and not force:
        return {"imported": 0, "existing": int(existing), "skipped": True}
    if not path.exists():
        return {"imported": 0, "existing": int(existing), "skipped": True,
                "reason": f"GeoJSON không tồn tại: {path}"}

    data = json.loads(path.read_text(encoding="utf-8"))
    features = data.get("features") or []
    imported, errors = 0, []
    with db.tx() as conn:
        city_id = _city_region(conn)
        for f in features:
            props = f.get("properties") or {}
            geom = f.get("geometry") or {}
            code = str(props.get("ma_xa") or "").strip()
            name = str(props.get("ten_xa") or "").strip()
            rtype = str(props.get("loai") or "").strip() or None
            if not code or not name or geom.get("type") not in ("Polygon", "MultiPolygon"):
                errors.append(f"feature thiếu ma_xa/ten_xa/geometry: {props}")
                continue
            try:
                conn.execute(
                    """
                    INSERT INTO gis.administrative_regions
                        (study_area_id, parent_region_id, code, name, region_type,
                         geometry, source, status)
                    VALUES (1, %s, %s, %s, %s,
                            ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)),
                            %s, 'ACTIVE')
                    ON CONFLICT (study_area_id, code) DO UPDATE SET
                        name = EXCLUDED.name,
                        region_type = EXCLUDED.region_type,
                        geometry = EXCLUDED.geometry,
                        parent_region_id = EXCLUDED.parent_region_id
                    """,
                    (city_id, code, name, rtype, json.dumps(geom), SOURCE_TAG),
                )
                imported += 1
            except Exception as e:  # geometry lỗi (tự cắt, ST_IsValid fail)
                errors.append(f"{code} {name}: {e!r}")
    return {"imported": imported, "existing": int(existing), "skipped": False,
            "city_region_id": city_id, "errors": errors[:10]}
