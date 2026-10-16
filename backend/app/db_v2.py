"""Lớp truy cập DB v2 — schema 7 nhóm (core/gis/transportation/policy/trip/decision/survey).

Giai đoạn chuyển đổi: bảng v1 (public.*) và schema v2 sống song song —
routers v1 vẫn chạy trên bảng cũ, code mới viết dần trên schema v2.
 Khi xong migration thì public.* sẽ được dỡ.

Chạy lúc boot qua main.py lifespan: init_v2() áp schema (một lần) + seed (một lần).
File schema_v2.sql KHÔNG idempotent (BEGIN/COMMIT, không IF NOT EXISTS)
-> phải kiểm tra to_regclass('core.study_areas') trước khi áp.
"""
from pathlib import Path

from . import db, seed_v2

SCHEMA_V2_FILE = Path(__file__).resolve().parent / "schema_v2.sql"


def schema_v2_applied(conn) -> bool:
    return seed_v2.schema_applied(conn)


def init_v2() -> None:
    """Áp schema v2 + seed nếu chưa có. Rẻ khi đã áp (2 query kiểm tra)."""
    with db.get_conn() as conn:
        if not seed_v2.schema_applied(conn):
            conn.execute(SCHEMA_V2_FILE.read_text(encoding="utf-8"))
            print("Schema v2 đã được áp (21 bảng / 7 schema).")
        if not seed_v2.already_seeded(conn):
            seed_v2.seed(conn)
            print("Seed v2 hoàn tất (HN, admin bcrypt, modes, LEZ Vành đai 1, criteria).")
