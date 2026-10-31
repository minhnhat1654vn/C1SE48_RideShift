"""Import GeoJSON phường/xã 3 thành phố → gis.administrative_regions.

Task 65 — ĐẨY ĐÀ NẴNG + TP.HCM VÀO CÙNG BẢNG VỚI HÀ NỘI (yêu cầu user:
"đưa các file geojson vào table gis.administrative_regions đã có").

CẤU TRÚC CÂY (adjacency list theo DB FINAL tr.4):
  [root] Hà Nội         code='01' (ma_tinh)  parent NULL  study_area_id=<HN>
    ├── 126 phường/xã  parent → root Hà Nội        (hanoi.geojson)
    └── 31 dòng DISTRICT legacy (seed đầu dự án, vẫn được FK tham chiếu bởi
        trips/vehicle_survey_responses → KHÔNG xoá, gắn parent về root HN)
  [root] Đà Nẵng        code='48'            parent NULL  study_area_id=<DN>
    └── 94 phường/xã   parent → root Đà Nẵng       (danang.geojson)
  [root] TP. Hồ Chí Minh code='79'            parent NULL  study_area_id=<SGN>
    └── 168 phường/xã  parent → root TP.HCM        (hcm.geojson)

BẢNG ÁNH XẠ CỘT (file GeoJSON → bảng):
  ┌─────────────┬────────────────────────────────────────────────────────────┐
  │ ma_xa       │ gis.administrative_regions.code (UNIQUE theo study_area)   │
  │ ten_xa      │ gis.administrative_regions.name                            │
  │ loai        │ gis.administrative_regions.region_type ("Phường"/"Xã")     │
  │ geometry    │ gis.administrative_regions.geometry                        │
  │ ma_tinh     │ code của row cấp thành phố (root)                          │
  │ (tạo mới)   │ parent_region_id → region_id của root thành phố            │
  │ (hằng số)   │ source = '<tên file> (bộ máy hành chính 2025)'             │
  │ dtich_km2   │ Task 86 (gộp A′): area_km2 / population / density_km2 /    │
  │ dan_so,     │ merged_from + boundary_simple (Douglas-Peucker 0.0005°     │
  │ sap_nhap…   │ port từ seed.ts) — public."Ward" đã bỏ, bản đồ đọc thẳng   │
  │             │ bảng này qua /api/cities/{code}/wards                      │
  └─────────────┴────────────────────────────────────────────────────────────┘

GEOMETRY 2 CHẾ ĐỘ (cùng một file chạy ở cả 2 môi trường):
  - PostGIS (docker-compose deliverable): ST_Multi(ST_SetSRID(
    ST_GeomFromGeoJSON(...), 4326)) — đúng DB FINAL GEOMETRY(MULTIPOLYGON,4326).
  - Không PostGIS (sandbox demo): lưu chuỗi GeoJSON vào cột TEXT — spatial
    analysis chạy ở lớp Python/Shapely.

Idempotent: unique index (study_area_id, code) + ON CONFLICT DO UPDATE; mỗi
thành phố bỏ qua nếu study_area của nó đã có phường/xã (trừ force=True).

Chạy: python3 -c "from app.services.geoimport import import_admin_regions;
import_admin_regions()" — hoặc tự chạy khi boot (main.py lifespan).
"""
import json
from pathlib import Path

from .. import config, db

# Thứ tự sắp xếp = thứ tự trong cổng chọn thành phố (City.sortOrder)
# center dùng cho fallback seed public."City" khi seed chính chưa chạy.
CITIES = [
    {"slug": "hanoi", "name": "Hà Nội", "file": "hanoi.geojson", "fallback_code": "01", "sort_order": 1, "center": (21.0278, 105.8342)},
    {"slug": "danang", "name": "Đà Nẵng", "file": "danang.geojson", "fallback_code": "48", "sort_order": 2, "center": (16.0544, 108.2022)},
    {"slug": "hcm", "name": "TP. Hồ Chí Minh", "file": "hcm.geojson", "fallback_code": "79", "sort_order": 3, "center": (10.7757, 106.7004)},
]
STUDY_AREA_CODES = {"hanoi": "HN", "danang": "DN", "hcm": "SGN"}

_postgis: bool | None = None

_UPSERT_PG = """
    INSERT INTO gis.administrative_regions
        (study_area_id, parent_region_id, code, name, region_type,
         geometry, source, status,
         boundary_simple, area_km2, population, density_km2, merged_from)
    VALUES (%s, %s, %s, %s, %s,
            ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)),
            %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (study_area_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        region_type = EXCLUDED.region_type,
        geometry = EXCLUDED.geometry,
        parent_region_id = EXCLUDED.parent_region_id,
        boundary_simple = EXCLUDED.boundary_simple,
        area_km2 = EXCLUDED.area_km2,
        population = EXCLUDED.population,
        density_km2 = EXCLUDED.density_km2,
        merged_from = EXCLUDED.merged_from
"""
_UPSERT_TEXT = """
    INSERT INTO gis.administrative_regions
        (study_area_id, parent_region_id, code, name, region_type,
         geometry, source, status,
         boundary_simple, area_km2, population, density_km2, merged_from)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (study_area_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        region_type = EXCLUDED.region_type,
        geometry = EXCLUDED.geometry,
        parent_region_id = EXCLUDED.parent_region_id,
        boundary_simple = EXCLUDED.boundary_simple,
        area_km2 = EXCLUDED.area_km2,
        population = EXCLUDED.population,
        density_km2 = EXCLUDED.density_km2,
        merged_from = EXCLUDED.merged_from
"""


def _has_postgis() -> bool:
    """PostGIS detection (cache) — quyết định cách ghi geometry."""
    global _postgis
    if _postgis is None:
        try:
            _postgis = bool(db.postgis_available())
        except Exception:
            _postgis = False
    return _postgis


def _ensure_indexes(conn) -> None:
    """Unique index cho ON CONFLICT (study_area_id, code) — idempotent.

    Dòng legacy có code NULL: Postgres btree coi NULL phân biệt nhau nên
    không bao giờ xung đột index này.
    """
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS administrative_regions_study_code_uq
        ON gis.administrative_regions (study_area_id, code)
        """
    )


def _bbox_polygon_geojson(features: list) -> dict | None:
    """Polygon bbox bao mọi feature của thành phố (cho root + study_area)."""
    min_lat = min_lng = max_lat = max_lng = None
    for f in features:
        g = f.get("geometry") or {}
        polys: list = []
        if g.get("type") == "Polygon":
            polys = [g.get("coordinates") or []]
        elif g.get("type") == "MultiPolygon":
            polys = g.get("coordinates") or []
        for poly in polys:
            for ring in poly:
                for lng, lat in ring:
                    if min_lat is None or lat < min_lat:
                        min_lat = lat
                    if max_lat is None or lat > max_lat:
                        max_lat = lat
                    if min_lng is None or lng < min_lng:
                        min_lng = lng
                    if max_lng is None or lng > max_lng:
                        max_lng = lng
    if min_lat is None:
        return None
    pad = 0.01
    return {
        "type": "Polygon",
        "coordinates": [[
            [min_lng - pad, min_lat - pad],
            [max_lng + pad, min_lat - pad],
            [max_lng + pad, max_lat + pad],
            [min_lng - pad, max_lat + pad],
            [min_lng - pad, min_lat - pad],
        ]],
    }


def _perp_dist(p: tuple, a: tuple, b: tuple) -> float:
    """Khoảng cách vuông góc điểm-đoạn (Douglas-Peucker) — port seed.ts."""
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return ((x - (x1 + t * dx)) ** 2 + (y - (y1 + t * dy)) ** 2) ** 0.5


def _simplify_ring(ring: list, tol: float = 0.0005) -> list:
    if len(ring) <= 5:
        return ring
    keep = [False] * len(ring)
    keep[0] = keep[-1] = True
    stack = [(0, len(ring) - 1)]
    while stack:
        s, e = stack.pop()
        max_d, idx = -1.0, -1
        for i in range(s + 1, e):
            d = _perp_dist(ring[i], ring[s], ring[e])
            if d > max_d:
                max_d, idx = d, i
        if max_d > tol and idx > 0:
            keep[idx] = True
            stack.append((s, idx))
            stack.append((idx, e))
    out = [ring[i] for i in range(len(ring)) if keep[i]]
    return out if len(out) >= 4 else ring


def _simplify_geometry(geom: dict) -> dict:
    """Giản lược đa giác (tol 0.0005° ≈ 55 m) — cùng tham số seed.ts đã dùng
    cho public."Ward".boundary cũ → kích thước payload bản đồ giữ nguyên."""
    gtype = geom.get("type")
    if gtype == "Polygon":
        return {
            "type": "Polygon",
            "coordinates": [_simplify_ring(r) for r in (geom.get("coordinates") or [])],
        }
    if gtype == "MultiPolygon":
        return {
            "type": "MultiPolygon",
            "coordinates": [
                [_simplify_ring(r) for r in poly]
                for poly in (geom.get("coordinates") or [])
            ],
        }
    return geom


def _num(v) -> float | None:
    """Ép số an toàn cho thuộc tính geojson (dtich_km2/dan_so/matdo_km2)."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _geom_param_mode() -> bool:
    return _has_postgis()


def _ensure_study_area(conn, city: dict, bbox: dict | None) -> int:
    """Study area cho thành phố (core.study_areas) — idempotent theo code."""
    sa_code = STUDY_AREA_CODES[city["slug"]]
    row = conn.execute(
        "SELECT study_area_id FROM core.study_areas WHERE code = %s",
        (sa_code,),
    ).fetchone()
    if row:
        return int(row["study_area_id"])
    bbox_json = json.dumps(bbox) if bbox else None
    if _geom_param_mode():
        row = conn.execute(
            """
            INSERT INTO core.study_areas
                (code, name, area_type, country_code, description, geometry, status)
            VALUES (%s, %s, 'CITY', 'VN', %s,
                    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), 'active')
            RETURNING study_area_id
            """,
            (
                sa_code,
                city["name"],
                f"Khu vực nghiên cứu {city['name']} (demo scalability đa thành phố)",
                bbox_json,
            ),
        ).fetchone()
    else:
        row = conn.execute(
            """
            INSERT INTO core.study_areas
                (code, name, area_type, country_code, description, geometry, status)
            VALUES (%s, %s, 'CITY', 'VN', %s, %s, 'active')
            RETURNING study_area_id
            """,
            (
                sa_code,
                city["name"],
                f"Khu vực nghiên cứu {city['name']} (demo scalability đa thành phố)",
                bbox_json,
            ),
        ).fetchone()
    return int(row["study_area_id"])


def _ensure_root(conn, study_id: int, city: dict, city_code: str, bbox: dict | None) -> int:
    """Region cấp thành phố (root, parent NULL) — idempotent theo (study, code)."""
    row = conn.execute(
        """
        SELECT region_id FROM gis.administrative_regions
        WHERE study_area_id = %s AND code = %s
        """,
        (study_id, city_code),
    ).fetchone()
    if row:
        return int(row["region_id"])
    source = f"{city['file']} (bộ máy hành chính 2025)"
    bbox_json = json.dumps(bbox) if bbox else None
    if _geom_param_mode():
        row = conn.execute(
            """
            INSERT INTO gis.administrative_regions
                (study_area_id, parent_region_id, code, name, region_type,
                 geometry, source, status)
            VALUES (%s, NULL, %s, %s, 'Thành phố',
                    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)),
                    %s, 'active')
            RETURNING region_id
            """,
            (study_id, city_code, city["name"], bbox_json, source),
        ).fetchone()
    else:
        row = conn.execute(
            """
            INSERT INTO gis.administrative_regions
                (study_area_id, parent_region_id, code, name, region_type,
                 geometry, source, status)
            VALUES (%s, NULL, %s, %s, 'Thành phố', %s, %s, 'active')
            RETURNING region_id
            """,
            (study_id, city_code, city["name"], bbox_json, source),
        ).fetchone()
    return int(row["region_id"])


def _attach_legacy_districts(conn, root_id: int) -> int:
    """Gắn các dòng DISTRICT legacy (seed đầu dự án) vào root Hà Nội.

    Các dòng này vẫn được FK tham chiếu (trips.origin_region_id,
    vehicle_survey_responses.region_id) nên KHÔNG được xoá — chỉ cập nhật
    parent để cây hành chính liền mạch một cấp cha duy nhất.
    """
    rows = conn.execute(
        """
        UPDATE gis.administrative_regions
        SET parent_region_id = %s
        WHERE region_type = 'DISTRICT'
          AND parent_region_id IS NULL
          AND region_id <> %s
        RETURNING region_id
        """,
        (root_id, root_id),
    ).fetchall()
    return len(rows)


def _rename_legacy_collisions(conn, ward_names: set[str]) -> int:
    """Đổi tên dòng legacy trùng tên phường/xã mới (hậu tố ' (cũ)').

    Unique index (study_area_id, name) của DB FINAL khiến tên trùng (VD
    'Thanh Oai' ASCII của quận/huyện cũ vs xã mới) chặn INSERT phường/xã —
    dòng legacy không thể xoá (đang được FK tham chiếu) nên đổi tên là cách
    giữ FK nguyên vẹn mà vẫn nạp đủ bộ máy 2025.
    """
    if not ward_names:
        return 0
    rows = conn.execute(
        """
        SELECT region_id, name FROM gis.administrative_regions
        WHERE region_type = 'DISTRICT' AND name = ANY(%s)
          AND name NOT LIKE '%% (cũ)'
        """,
        (sorted(ward_names),),
    ).fetchall()
    for r in rows:
        conn.execute(
            "UPDATE gis.administrative_regions SET name = %s || ' (cũ)' WHERE region_id = %s",
            (r["name"], r["region_id"]),
        )
    return len(rows)


def import_admin_regions(geo_dir: Path | None = None, force: bool = False) -> dict:
    """Idempotent import phường/xã 3 thành phố; mỗi thành phố chỉ chạy 1 lần."""
    directory = Path(geo_dir) if geo_dir else config.CITIES_GEO_DIR
    report: dict = {"imported": 0, "existing": 0, "skipped": True, "cities": []}
    if not directory.exists():
        report["reason"] = f"Thư mục GeoJSON không tồn tại: {directory}"
        return report

    with db.get_conn() as conn:
        _ensure_indexes(conn)

    total_imported = 0
    total_existing = 0
    for city in CITIES:
        path = directory / city["file"]
        city_report: dict = {"city": city["slug"], "imported": 0}
        if not path.exists():
            city_report.update(skipped=True, reason=f"Không tìm thấy {path}")
            report["cities"].append(city_report)
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        features = data.get("features") or []
        bbox = _bbox_polygon_geojson(features)
        props0 = (features[0].get("properties") or {}) if features else {}
        city_code = str(props0.get("ma_tinh") or "").strip() or city["fallback_code"]
        source = f"{city['file']} (bộ máy hành chính 2025)"

        with db.tx() as conn:
            study_id = _ensure_study_area(conn, city, bbox)
            # Cầu nối City ↔ study area (Task 63/65): /api/cities và
            # /api/cities/{id}/wards đọc qua public."City"."studyAreaId".
            # Upsert để kể cả seed chưa chạy (thủ công) City vẫn đầy đủ.
            # bbox [[s,w],[n,e]] suy từ polygon bbox đã tính phía trên.
            if bbox:
                pts = bbox["coordinates"][0]  # [0]=(w,s) [2]=(e,n)
                min_lng_p, min_lat_p = pts[0]
                max_lng_p, max_lat_p = pts[2]
            else:
                min_lng_p = min_lat_p = max_lng_p = max_lat_p = 0.0
            c_lat, c_lng = city["center"]
            conn.execute(
                """
                INSERT INTO public."City"
                    (id, name, "centerLat", "centerLng", "defaultZoom", bbox,
                     active, "sortOrder", "studyAreaId", "updatedAt")
                VALUES (%s, %s, %s, %s, 12, %s, TRUE, %s, %s, now())
                ON CONFLICT (id) DO UPDATE SET
                    "studyAreaId" = EXCLUDED."studyAreaId",
                    active = TRUE,
                    "updatedAt" = now()
                """,
                (
                    city["slug"],
                    city["name"],
                    c_lat,
                    c_lng,
                    json.dumps([[min_lat_p, min_lng_p], [max_lat_p, max_lng_p]]) if bbox else json.dumps([[c_lat - 0.55, c_lng - 0.55], [c_lat + 0.55, c_lng + 0.55]]),
                    city["sort_order"],
                    study_id,
                ),
            )
            existing = int(
                conn.execute(
                    """
                    SELECT count(*) AS c FROM gis.administrative_regions
                    WHERE study_area_id = %s
                      AND region_type IN ('Phường', 'Xã', 'Đặc khu')
                    """,
                    (study_id,),
                ).fetchone()["c"]
            )
            city_report["existing"] = existing
            if existing and not force:
                city_report["skipped"] = True
                report["cities"].append(city_report)
                total_existing += existing
                continue
            root_id = _ensure_root(conn, study_id, city, city_code, bbox)
            legacy = 0
            if city["slug"] == "hanoi":
                ward_names = {
                    str((f.get("properties") or {}).get("ten_xa") or "").strip()
                    for f in features
                    if str((f.get("properties") or {}).get("ten_xa") or "").strip()
                }
                _rename_legacy_collisions(conn, ward_names)
                legacy = _attach_legacy_districts(conn, root_id)
            if legacy:
                city_report["legacy_attached"] = legacy
            imported, errors = 0, []
            for f in features:
                props = f.get("properties") or {}
                geom = f.get("geometry") or {}
                code = str(props.get("ma_xa") or "").strip()
                name = str(props.get("ten_xa") or "").strip()
                rtype = str(props.get("loai") or "").strip() or None
                if not code or not name or geom.get("type") not in ("Polygon", "MultiPolygon"):
                    errors.append(f"feature thiếu ma_xa/ten_xa/geometry: {props}")
                    continue
                # SAVEPOINT từng dòng: 1 row lỗi (geometry/unique) không được
                # phép kéo cả transaction thành phố rollback theo (psycopg3
                # COMMIT trên transaction aborted = ROLLBACK toàn bộ)
                sp = f"sp_ward_{code}"
                conn.execute(f"SAVEPOINT {sp}")
                try:
                    conn.execute(
                        _UPSERT_PG if _geom_param_mode() else _UPSERT_TEXT,
                        (
                            study_id,
                            root_id,
                            code,
                            name,
                            rtype,
                            json.dumps(geom),
                            source,
                            "active",
                            json.dumps(_simplify_geometry(geom)),
                            _num(props.get("dtich_km2")),
                            _num(props.get("dan_so")),
                            _num(props.get("matdo_km2")),
                            str(props["sap_nhap"]) if props.get("sap_nhap") is not None else None,
                        ),
                    )
                    conn.execute(f"RELEASE SAVEPOINT {sp}")
                    imported += 1
                except Exception as e:  # geometry lỗi (tự cắt, ST_IsValid fail)
                    conn.execute(f"ROLLBACK TO SAVEPOINT {sp}")
                    conn.execute(f"RELEASE SAVEPOINT {sp}")
                    errors.append(f"{code} {name}: {e!r}")
            city_report.update(imported=imported, errors=errors[:5])
            total_imported += imported
        report["cities"].append(city_report)

    report["imported"] = total_imported
    report["existing"] = total_existing
    report["skipped"] = total_imported == 0
    return report
