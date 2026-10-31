"""PostgreSQL access layer — psycopg 3, connection-per-request.

The whole database schema is owned by this service (schema.sql + seed.py).
Business tables live in the 6 schemas from the "DB FINAL" design document
(core / gis / transportation / policy / trip / decision) — app SQL uses
fully-qualified table names so the `search_path` is only a safety net.
"""
import json
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from . import config

SCHEMA_FILE = Path(__file__).resolve().parent / "schema.sql"

# public first: PostGIS installs its objects there; unqualified DML then
# resolves business tables in the design-document schemas.
SEARCH_PATH = "public,core,policy,transportation,trip,decision"
CONNECT_OPTIONS = f"-c search_path={SEARCH_PATH}"


def dsn() -> str:
    return config.DATABASE_URL


@contextmanager
def get_conn():
    conn = psycopg.connect(
        dsn(), row_factory=dict_row, autocommit=True, options=CONNECT_OPTIONS
    )
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def tx():
    """Transactional connection (commit/rollback managed)."""
    conn = psycopg.connect(dsn(), row_factory=dict_row, options=CONNECT_OPTIONS)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init_db() -> None:
    """Create schema (idempotent) and attempt PostGIS enablement."""
    sql = SCHEMA_FILE.read_text(encoding="utf-8")
    with get_conn() as conn:
        conn.execute(sql)
        # Task 63 — multi-city: cột scope thành phố (idempotent, không đập bảng)
        conn.execute("ALTER TABLE policy.lez_zones ADD COLUMN IF NOT EXISTS city_id TEXT")
        conn.execute(
            "ALTER TABLE transportation.transportation_locations "
            "ADD COLUMN IF NOT EXISTS city_id TEXT"
        )
        # DB FINAL — policy.lez_zones.geometry là cột ranh giới chính thức;
        # chuyển dữ liệu từ các cột mirror của bản triển khai cũ rồi dọn chúng.
        _migrate_lez_zone_geometry(conn)
    enable_postgis_if_available()


def _lez_zone_geometry_is_postgis(conn) -> bool:
    row = conn.execute(
        "SELECT data_type FROM information_schema.columns "
        "WHERE table_schema='policy' AND table_name='lez_zones' "
        "AND column_name='geometry'"
    ).fetchone()
    return bool(row and row["data_type"] == "USER-DEFINED")


def _write_zone_geometry(conn, zone_id: int, geojson: str) -> None:
    """Ghi GeoJSON MultiPolygon vào policy.lez_zones.geometry — dual-mode:
    cột GEOMETRY (PostGIS) dùng ST_GeomFromGeoJSON, cột TEXT ghi thẳng."""
    if _lez_zone_geometry_is_postgis(conn):
        conn.execute(
            "UPDATE policy.lez_zones SET geometry = "
            "ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)) "
            "WHERE lez_zone_id = %s",
            (geojson, zone_id),
        )
    else:
        conn.execute(
            "UPDATE policy.lez_zones SET geometry = %s WHERE lez_zone_id = %s",
            (geojson, zone_id),
        )


def _migrate_lez_zone_geometry(conn) -> int:
    """Đưa policy.lez_zones về đúng DB FINAL: một cột `geometry` duy nhất.

    Xử lý cả 3 dạng volume có thể gặp:
      1. DB mới — schema.sql đã tạo cột geometry (TEXT), không làm gì thêm;
      2. Volume cũ có `coordinates` (JSON [[lat,lng],…]) — chuyển sang geometry
         (GeoJSON MultiPolygon) rồi DROP cột coordinates;
      3. Volume 10/2026 có `geometry` (PostGIS GEOMETRY hoặc TEXT GeoJSON) —
         giữ nguyên giá trị; chỉ DROP cột mirror dư (coordinates/geom).
    Idempotent — chạy lại vô hại. Trả về số dòng đã phải chuyển đổi (để log).
    """
    from .geojson_utils import (
        _pairs_from_geometry,
        multipolygon_geojson_from_pairs,
    )

    cols = {
        r["column_name"]
        for r in conn.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'policy' AND table_name = 'lez_zones'"
        ).fetchall()
    }
    if "geometry" not in cols:
        conn.execute("ALTER TABLE policy.lez_zones ADD COLUMN geometry TEXT")
        cols.add("geometry")

    migrated = 0
    # (a) các dòng còn thiếu geometry nhưng có coordinates/geom — chuyển đổi.
    # Chỉ SELECT những cột mirror thực sự tồn tại (DB mới không có cột nào).
    mirror_cols = [c for c in ("coordinates", "geom") if c in cols]
    rows = []
    if mirror_cols:
        rows = conn.execute(
            f"SELECT lez_zone_id, {', '.join(mirror_cols)} FROM policy.lez_zones "
            "WHERE geometry IS NULL OR btrim(geometry::text) = ''"
        ).fetchall()
    for r in rows:
        zid = int(r["lez_zone_id"])
        try:
            pairs = None
            raw = r.get("coordinates")
            if raw:
                try:
                    v = json.loads(raw) if isinstance(raw, str) else raw
                    if isinstance(v, list) and len(v) >= 3:
                        pairs = v
                except Exception:
                    pairs = None
            if pairs is None and r.get("geom") is not None:
                pairs = _pairs_from_geometry(r["geom"])
            if pairs:
                gj = multipolygon_geojson_from_pairs(pairs)
                if gj:
                    _write_zone_geometry(conn, zid, gj)
                    migrated += 1
        except Exception:
            continue  # một vùng hỏng không được chặn boot

    # (b) DROP cột mirror sau khi dữ liệu đã an toàn trong geometry
    if "coordinates" in cols:
        conn.execute("ALTER TABLE policy.lez_zones DROP COLUMN coordinates")
    if "geom" in cols:
        conn.execute("ALTER TABLE policy.lez_zones DROP COLUMN geom")
    return migrated


def postgis_available() -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS ok"
        ).fetchone()
        return bool(row and row["ok"])


def enable_postgis_if_available() -> bool:
    """Try CREATE EXTENSION postgis; nâng cột lez_zones.geometry đúng DB FINAL.

    Sandbox PostgreSQL chạy không có extension PostGIS (không root để cài
    libpostgis) nên phân tích không gian chạy ở lớp Python/Shapely và cột
    geometry giữ dạng TEXT GeoJSON. Bản docker-compose dùng image postgis/
    postgis — lúc đó cột được nâng thành GEOMETRY(MULTIPOLYGON,4326) + GIST
    đúng DB FINAL, phục vụ truy vấn không gian ở mức DB.
    """
    try:
        with get_conn() as conn:
            # PostGIS objects (spatial_ref_sys, ST_* functions) belong in
            # `public` — pin the search path for the install connection.
            conn.execute("SET search_path = public")
            conn.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    except Exception:
        return False
    try:
        with get_conn() as conn:
            if not _lez_zone_geometry_is_postgis(conn):
                # TEXT GeoJSON → GEOMETRY(MULTIPOLYGON,4326) (DB FINAL).
                # Giá trị do chính hệ thống sinh ra nên parse được; nếu volume
                # lạ có dòng hỏng thì bỏ qua nâng kiểu (giữ TEXT, mọi tính năng
                # vẫn chạy qua lớp Python).
                conn.execute(
                    "ALTER TABLE policy.lez_zones ALTER COLUMN geometry "
                    "TYPE geometry(MultiPolygon,4326) "
                    "USING ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(geometry),4326))"
                )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS lez_zones_geometry_gist "
                "ON policy.lez_zones USING gist (geometry)"
            )
    except Exception:
        return False
    return True


def sync_zone_geometry(conn, zone_id: int, coordinates_json: str) -> None:
    """Ghi ranh giới vùng LEZ vào cột `geometry` (DB FINAL) khi tạo/cập nhật.

    `coordinates_json` = JSON [[lat,lng],…]. Dual-mode TEXT/PostGIS — xem
    _write_zone_geometry. Không bao giờ raise (đã validate trước đó)."""
    from .geojson_utils import multipolygon_geojson_from_pairs

    try:
        gj = multipolygon_geojson_from_pairs(coordinates_json)
        if gj is None:
            return
        _write_zone_geometry(conn, zone_id, gj)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Small shared lookups (id maps for the BIGSERIAL layout)
# ---------------------------------------------------------------------------

def study_area_id(conn, code: str = "HN") -> int | None:
    row = conn.execute(
        "SELECT study_area_id FROM core.study_areas WHERE code = %s", (code,)
    ).fetchone()
    return int(row["study_area_id"]) if row else None


def vehicle_type_id_by_mode_code(conn, code: str) -> int | None:
    row = conn.execute(
        """
        SELECT vt.vehicle_type_id
        FROM policy.vehicle_types vt
        JOIN transportation.transportation_modes tm
          ON tm.transportation_mode_id = vt.transportation_mode_id
        WHERE tm.code = %s
        ORDER BY vt.is_default DESC
        LIMIT 1
        """,
        (code,),
    ).fetchone()
    return int(row["vehicle_type_id"]) if row else None


def region_id_by_name(conn, name: str) -> int | None:
    if not name:
        return None
    row = conn.execute(
        "SELECT region_id FROM gis.administrative_regions WHERE name = %s LIMIT 1",
        (name,),
    ).fetchone()
    return int(row["region_id"]) if row else None


def log_action(
    action: str,
    admin_id: int | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    description: str | None = None,
    ip: str | None = None,
    level: str = "info",
) -> None:
    """Append to core.system_logs (US audit trail). Never raises."""
    try:
        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO core.system_logs
                    (admin_id, level, action, entity_type, entity_id, description, ip_address)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (admin_id, level, action, entity_type, entity_id, description, ip),
            )
    except Exception:
        pass


def db_name() -> str:
    try:
        with get_conn() as conn:
            row = conn.execute("SELECT current_database() AS n").fetchone()
            return row["n"] if row else "?"
    except Exception as e:  # pragma: no cover
        return f"unavailable ({e.__class__.__name__})"
