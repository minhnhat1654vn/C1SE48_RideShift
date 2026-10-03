"""PostgreSQL access layer — psycopg 3, connection-per-request.

The database schema is owned by this service (schema.sql + seed.py);
Prisma is no longer used at runtime.
"""
import json
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from . import config

SCHEMA_FILE = Path(__file__).resolve().parent / "schema.sql"


def dsn() -> str:
    return config.DATABASE_URL


@contextmanager
def get_conn():
    conn = psycopg.connect(dsn(), row_factory=dict_row, autocommit=True)
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def tx():
    """Transactional connection (commit/rollback managed)."""
    conn = psycopg.connect(dsn(), row_factory=dict_row)
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
    enable_postgis_if_available()


def postgis_available() -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS ok"
        ).fetchone()
        return bool(row and row["ok"])


def enable_postgis_if_available() -> bool:
    """Try CREATE EXTENSION postgis; populate a GIST-indexed geometry column.

    In this sandbox PostgreSQL runs without the PostGIS extension (no root to
    install libpostgis), so spatial analysis runs in the Python/Shapely layer.
    The docker-compose deployment uses the postgis/postgis image where this
    succeeds and lez_zone.geom is kept in sync for DB-level spatial queries.
    """
    try:
        with get_conn() as conn:
            conn.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    except Exception:
        return False
    try:
        with get_conn() as conn:
            conn.execute(
                "ALTER TABLE lez_zone ADD COLUMN IF NOT EXISTS geom geometry(Polygon,4326)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS lez_zone_geom_gist ON lez_zone USING gist (geom)"
            )
            _backfill_zone_geom(conn)
    except Exception:
        return False
    return True


def _backfill_zone_geom(conn) -> None:
    """Populate lez_zone.geom from the canonical coordinates JSON."""
    zones = conn.execute("SELECT id, coordinates FROM lez_zone").fetchall()
    for z in zones:
        try:
            pts = json.loads(z["coordinates"])
        except Exception:
            continue
        if not isinstance(pts, list) or len(pts) < 3:
            continue
        ring = [[float(p[1]), float(p[0])] for p in pts]
        ring.append(ring[0])
        geojson = json.dumps({"type": "Polygon", "coordinates": [ring]})
        conn.execute(
            "UPDATE lez_zone SET geom = ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) WHERE id = %s",
            (geojson, z["id"]),
        )


def sync_zone_geom(conn, zone_id: str, coordinates_json: str) -> None:
    """Keep geom in sync on zone create/update when PostGIS is present."""
    if not postgis_available():
        return
    try:
        pts = json.loads(coordinates_json)
        if not isinstance(pts, list) or len(pts) < 3:
            return
        ring = [[float(p[1]), float(p[0])] for p in pts]
        ring.append(ring[0])
        geojson = json.dumps({"type": "Polygon", "coordinates": [ring]})
        conn.execute(
            "UPDATE lez_zone SET geom = ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) WHERE id = %s",
            (geojson, zone_id),
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
