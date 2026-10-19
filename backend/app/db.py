"""PostgreSQL access layer — psycopg 3, connection-per-request.

The whole database schema is owned by this service (schema.sql + seed.py).
Business tables live in the 6 schemas from the "DB FINAL" design document
(core / gis / transportation / policy / trip / decision) — app SQL uses
fully-qualified table names so the `search_path` is only a safety net.

Per DB FINAL every shape column is a real PostGIS GEOMETRY type. The wire
format between backend and frontend stays GeoJSON, so writes go through
ST_SetSRID(ST_GeomFromGeoJSON(…),4326) and reads through ST_AsGeoJSON —
use the geom_write()/geom_read() builders below instead of hand-writing
the ST_* expressions.
"""
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
    """Create/upgrade the schema (idempotent).

    schema.sql now owns everything PostGIS-related: it requires the extension,
    defines the DB FINAL GEOMETRY columns, upgrades interim TEXT volumes in
    place and creates the GIST spatial indexes.
    """
    sql = SCHEMA_FILE.read_text(encoding="utf-8")
    with get_conn() as conn:
        conn.execute(sql)


def postgis_available() -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS ok"
        ).fetchone()
        return bool(row and row["ok"])


# ---------------------------------------------------------------------------
# Geometry column helpers (DB FINAL: GEOMETRY columns, GeoJSON on the wire)
# ---------------------------------------------------------------------------

def geom_write(multi: bool = False) -> str:
    """Value expression for INSERT/UPDATE of a geometry column.

    The GeoJSON text travels in the NEXT %s parameter, e.g.::

        sql = f"INSERT INTO policy.lez_zones (geometry) "
              f"VALUES ({db.geom_write(multi=True)})"
        conn.execute(sql, (geojson_text,))

    multi=True wraps the parsed shape with ST_Multi so both Polygon and
    MultiPolygon GeoJSON satisfy the geometry(MultiPolygon,4326) columns.
    """
    inner = "ST_GeomFromGeoJSON(%s)"
    if multi:
        inner = f"ST_Multi({inner})"
    return f"ST_SetSRID({inner}, 4326)"


def geom_read(col: str, alias: str | None = None) -> str:
    """SELECT expression returning a shape column as GeoJSON text.

    PostGIS would otherwise render the column as hex EWKB in text protocol.
    Pass alias to bind the result to a named key, e.g. 'geometry_json'.
    """
    expr = f"ST_AsGeoJSON({col})"
    return f"{expr} AS {alias}" if alias else expr


# ---------------------------------------------------------------------------
# Small shared lookups (id maps for the BIGSERIAL layout)
# ---------------------------------------------------------------------------

def study_area_id(conn, code: str = "HN") -> int | None:
    row = conn.execute(
        "SELECT study_area_id FROM core.study_areas WHERE code = %s", (code,)
    ).fetchone()
    return int(row["study_area_id"]) if row else None


def mode_id_by_code(conn, code: str) -> int | None:
    row = conn.execute(
        "SELECT transportation_mode_id FROM transportation.transportation_modes WHERE code = %s",
        (code,),
    ).fetchone()
    return int(row["transportation_mode_id"]) if row else None


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
