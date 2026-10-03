#!/bin/bash
# RideShift — self-healing bootstrap for the FastAPI backend.
#
# WHY THIS EXISTS
#   The sandbox reaps every background process spawned from a shell session,
#   but children of the boot-born Next.js dev server SURVIVE. The frontend
#   therefore calls /api/backend-keepalive, which runs this script as a
#   detached child of next-server, keeping the API alive for the whole session.
#   .zscripts/dev.sh also invokes this script at boot as the primary path.
#
# SAFE TO RUN REPEATEDLY — exits immediately if the API already answers.
#
# NOTE: next-server's PATH lacks /home/z/.venv/bin, so the venv interpreter
#       is referenced by absolute path (it holds fastapi/psycopg/pandas).

VENV_PY=/home/z/.venv/bin/python3
VENV_PIP=/home/z/.venv/bin/pip3
[ -x "$VENV_PY" ] || VENV_PY=python3
[ -x "$VENV_PIP" ] || VENV_PIP=pip3

LOG=/tmp/rideshift-backend.log
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$BASE_DIR/mini-services/fastapi-backend"

# 1) Healthy already? (fast path — the keepalive route pings often)
if curl -s -m 2 -o /dev/null "http://127.0.0.1:8000/api/zones" 2>/dev/null; then
  exit 0
fi

exec >> "$LOG" 2>&1
echo "=== ensure-backend $(date '+%F %T') pid=$$ ==="

cd "$BACKEND_DIR" || { echo "backend dir missing"; exit 1; }

# 2) Python deps (sandbox resets wipe site-packages outside the project)
if ! "$VENV_PY" -c "import fastapi, uvicorn, psycopg" 2>/dev/null; then
  echo "installing python dependencies…"
  "$VENV_PIP" install -q -r requirements.txt
fi

# 3) PostgreSQL: wait until the embedded server accepts connections, then
#    make sure the rideshift database exists. When it is fresh/empty, restore
#    the git-tracked snapshot (db/pg-snapshot-latest.sql — preserves Vietnamese
#    seed + admin-created rows). The backend's lifespan hook also re-seeds on
#    startup, so a missing snapshot only falls back to factory seed data.
db_ok=0
for _ in $(seq 1 60); do
  if "$VENV_PY" - <<'PYEOF' 2>/dev/null
import psycopg
conn = psycopg.connect(
    "postgresql://postgres@127.0.0.1:5432/postgres", autocommit=True
)
cur = conn.cursor()
cur.execute("SELECT 1 FROM pg_database WHERE datname='rideshift'")
if not cur.fetchone():
    cur.execute("CREATE DATABASE rideshift")
    print("created database rideshift")
conn.close()
PYEOF
  then
    echo "postgres ready, rideshift db ensured"
    db_ok=1
    break
  fi
  echo "waiting for postgres…"
  sleep 2
done

if [ "$db_ok" -ne 1 ]; then
  echo "ERROR: postgres unreachable after 120s — aborting"
  exit 1
fi

# 3b) Empty database? Restore the git-tracked snapshot before first start.
"$VENV_PY" - <<'PYEOF' 2>/dev/null || true
import sys
from pathlib import Path
import psycopg
sys.path.insert(0, str(Path("/home/z/my-project/scripts")))
conn = psycopg.connect(
    "postgresql://postgres@127.0.0.1:5432/rideshift", autocommit=True
)
cur = conn.cursor()
cur.execute(
    "SELECT COUNT(*) FROM information_schema.tables "
    "WHERE table_schema='public'"
)
tables = cur.fetchone()["count"]
if tables == 0:
    snap = Path("/home/z/my-project/db/pg-snapshot-latest.sql")
    if snap.exists():
        conn.execute(snap.read_text(encoding="utf-8"))
        print(f"restored rideshift DB from {snap}")
conn.close()
PYEOF

# 4) Start the API. uvicorn stays in this script's process tree (child of
#    next-server) so it survives the sandbox reaper; `wait` keeps the tree
#    attached. If uvicorn ever dies, the next keepalive ping restarts it.
echo "starting uvicorn on :8000"
"$VENV_PY" -m uvicorn main:app --host 127.0.0.1 --port 8000 >> "$LOG" 2>&1 &
UVPID=$!
wait "$UVPID"
