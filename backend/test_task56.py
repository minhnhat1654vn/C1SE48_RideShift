"""Task 56 E2E test: init_db + seed + trend pipeline against scratch PG."""
import json
import os
import sys

BACKEND = "/home/z/my-project/C1SE48_RideShift/backend"
DBNAME = "rideshift_schema_test"
os.environ["DATABASE_URL"] = f"postgresql://postgres@127.0.0.1:5432/{DBNAME}"
sys.path.insert(0, BACKEND)

import psycopg

from app import db, seed
from app.services import trend

admin = psycopg.connect("postgresql://postgres@127.0.0.1:5432/postgres", autocommit=True)
admin.execute(f"DROP DATABASE IF EXISTS {DBNAME}")
admin.execute(f"CREATE DATABASE {DBNAME}")
admin.close()
print("== scratch DB created")

# ---- Step 1: simulate LEGACY layout (old zip): flat public tables + camelCase ----
leg = psycopg.connect(
    f"postgresql://postgres@127.0.0.1:5432/{DBNAME}", autocommit=True,
    options="-c search_path=public",
)
leg.execute("CREATE TABLE admin_user (id text PRIMARY KEY, username text UNIQUE, password_hash text, full_name text, created_at timestamptz DEFAULT now())")
leg.execute("CREATE TABLE lez_zone (id text PRIMARY KEY, name text, description text, coordinates text, active bool DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())")
leg.execute("INSERT INTO admin_user VALUES ('legacy1','admin','x','old',now())")
leg.execute('CREATE TABLE "AdminUser" ("id" text PRIMARY KEY, "username" text UNIQUE, "passwordHash" text, "fullName" text, "createdAt" timestamptz DEFAULT now())')
leg.execute('CREATE TABLE "_prisma_migrations" (id text PRIMARY KEY)')
leg.execute("CREATE SCHEMA tiger")
leg.execute("CREATE SCHEMA tiger_data")
leg.execute("CREATE SCHEMA topology")
leg.close()
print('== legacy layout simulated (public.admin_user + "AdminUser" + _prisma_migrations + tiger/tiger_data/topology schemas)')

# ---- Step 2: boot path — init_db + seed + pipeline (as backend lifespan does) ----
db.init_db()
seed.seed()
try:
    with db.get_conn() as conn:
        n = conn.execute("SELECT count(*) AS c FROM dataset_trend").fetchone()["c"]
    if n == 0:
        trend.run_pipeline()
    trend.latest_trend_map()
    print("== init_db + seed + pipeline OK")
except Exception:
    import traceback
    traceback.print_exc()
    sys.exit(1)

# ---- Step 3-6: inspect final layout ----
with db.get_conn() as conn:
    rows = conn.execute(
        """
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog','information_schema')
        ORDER BY table_schema, table_name
        """
    ).fetchall()
    print("== final table layout:")
    for r in rows:
        print(f"   {r['table_schema']}.{r['table_name']}")

    counts = {
        "core.admin_user": "SELECT count(*) c FROM core.admin_user",
        "core.admin_session": "SELECT count(*) c FROM core.admin_session",
        "policy.lez_zone": "SELECT count(*) c FROM policy.lez_zone",
        "policy.policy_rule": "SELECT count(*) c FROM policy.policy_rule",
        "transportation.transport_mode": "SELECT count(*) c FROM transportation.transport_mode",
        "transportation.transportation_location": "SELECT count(*) c FROM transportation.transportation_location",
        "trip.trip_record": "SELECT count(*) c FROM trip.trip_record",
        "decision.criteria_weight": "SELECT count(*) c FROM decision.criteria_weight",
        "decision.dataset_trend": "SELECT count(*) c FROM decision.dataset_trend",
        "decision.dataset_run": "SELECT count(*) c FROM decision.dataset_run",
    }
    print("== row counts:")
    for tbl, q in counts.items():
        row = conn.execute(q).fetchone()
        print(f"   {tbl}: {row['c']}")

    leftover = conn.execute(
        """
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name NOT IN ('spatial_ref_sys')
        """
    ).fetchall()
    print(f"== leftover tables in public (expect []): {[r['table_name'] for r in leftover]}")

    leftover_schemas = conn.execute(
        "SELECT nspname FROM pg_namespace WHERE nspname IN ('tiger','tiger_data','topology')"
    ).fetchall()
    print(f"== leftover extension schemas (expect []): {[r['nspname'] for r in leftover_schemas]}")

    zones = conn.execute("SELECT id, name, active FROM policy.lez_zone ORDER BY id").fetchall()
    rules = conn.execute("SELECT zone_id, count(*) c FROM policy.policy_rule GROUP BY zone_id").fetchall()
    u = conn.execute("SELECT username, password_hash FROM core.admin_user WHERE username='admin'").fetchone()

print("== zones:", json.dumps(zones, ensure_ascii=False))
print("== rules per zone:", json.dumps(rules, ensure_ascii=False))

from app.auth import verify_password
print("== admin user:", u["username"], "verify(admin123):", verify_password("admin123", u["password_hash"]))
print("ALL TESTS DONE")
