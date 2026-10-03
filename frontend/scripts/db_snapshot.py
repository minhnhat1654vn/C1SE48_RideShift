#!/usr/bin/env python3
"""RideShift DB snapshot — dump/restore ALL public tables as portable SQL.

Uses psycopg (same driver as the backend). The bundled PostgreSQL 18 has no
pg_dump, so we generate INSERTs ourselves (with proper quoting via psycopg.sql
and session_replication_role=replica to bypass FK ordering).

Usage:
  python3 scripts/db_snapshot.py dump  [out.sql]     # default: backups/db-snapshot-<ts>.sql
  python3 scripts/db_snapshot.py restore <file.sql>  # TRUNCATE + re-insert
  python3 scripts/db_snapshot.py tables              # list tables + row counts

Connection: DATABASE_URL env or postgresql://postgres@127.0.0.1:5432/rideshift
"""

import os
import sys
from datetime import datetime, date, time
from decimal import Decimal
from pathlib import Path

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_DSN = "postgresql://postgres@127.0.0.1:5432/rideshift"
_env_url = os.environ.get("DATABASE_URL", "")
# The sandbox shell may export a legacy SQLite-style DATABASE_URL (file:...)
# — only honor PostgreSQL URLs and fall back to the known local cluster.
DSN = _env_url if _env_url.startswith("postgresql://") else _DEFAULT_DSN


def get_tables(conn: psycopg.Connection) -> list[str]:
    rows = conn.execute(
        """
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
        """
    ).fetchall()
    return [r[0] for r in rows]


def cmd_tables() -> None:
    with psycopg.connect(DSN) as conn:
        for t in get_tables(conn):
            n = conn.execute(sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(t))).fetchone()[0]
            print(f"{t:32s} {n:>8d} rows")


def cmd_dump(out_path: str | None) -> None:
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = Path(out_path) if out_path else ROOT / "backups" / f"db-snapshot-{ts}.sql"
    out.parent.mkdir(parents=True, exist_ok=True)

    with psycopg.connect(DSN) as conn:
        tables = get_tables(conn)
        lines: list[str] = [
            f"-- RideShift PostgreSQL snapshot — {datetime.now().isoformat(timespec='seconds')}",
            f"-- DSN: {DSN}",
            "BEGIN;",
            "SET session_replication_role = replica;",  # bypass FK checks on insert
            sql.SQL("TRUNCATE TABLE {};").format(
                sql.SQL(", ").join(sql.Identifier(t) for t in tables)
            ).as_string(conn),
        ]
        total = 0
        for t in tables:
            cur = conn.execute(sql.SQL("SELECT * FROM {}").format(sql.Identifier(t)))
            cols = [d[0] for d in cur.description]
            col_sql = sql.SQL(", ").join(sql.Identifier(c) for c in cols)
            for row in cur.fetchall():
                vals = sql.SQL(", ").join(sql.Literal(v) for v in row)
                lines.append(
                    sql.SQL("INSERT INTO {} ({}) VALUES ({});").format(
                        sql.Identifier(t), col_sql, vals
                    ).as_string(conn)
                )
                total += 1
        lines.append("COMMIT;")

    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Dumped {total} rows across {len(tables)} tables -> {out}")


def cmd_restore(src: str) -> None:
    p = Path(src)
    if not p.exists():
        sys.exit(f"Snapshot not found: {p}")
    sql_text = p.read_text(encoding="utf-8")
    with psycopg.connect(DSN, autocommit=False) as conn:
        conn.execute(sql_text)  # single multi-statement script, atomic
    print(f"Restored DB from {p}")


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "tables"
    if cmd == "dump":
        cmd_dump(sys.argv[2] if len(sys.argv) > 2 else None)
    elif cmd == "restore":
        if len(sys.argv) < 3:
            sys.exit("Usage: db_snapshot.py restore <file.sql>")
        cmd_restore(sys.argv[2])
    elif cmd == "tables":
        cmd_tables()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
