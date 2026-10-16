"""Xác thực Admin v2 — core.admins (bcrypt) + phiên lưu DB (core.admin_sessions).

Đáp ứng rules.md §7: hash bcrypt/argon2, cookie HttpOnly + SameSite + có hạn,
đăng xuất thu hồi phiên (xóa dòng), giới hạn số lần thử sai (chống dò mật khẩu).
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import bcrypt
import psycopg
from fastapi import HTTPException, Request

from . import db

COOKIE = "rs2_admin_session"
TTL_HOURS = 8
MAX_FAILS = 5
FAIL_WINDOW_MIN = 15

_fails: dict[str, list[datetime]] = {}  # ip -> các mốc đăng nhập sai (in-memory, prototype)


@lru_cache(maxsize=1)
def _salt() -> str:
    from . import config
    return config.SALT


def _too_many_fails(ip: str) -> bool:
    now = datetime.now(timezone.utc)
    window = [t for t in _fails.get(ip, []) if now - t < timedelta(minutes=FAIL_WINDOW_MIN)]
    _fails[ip] = window
    return len(window) >= MAX_FAILS


def _record_fail(ip: str) -> None:
    _fails.setdefault(ip, []).append(datetime.now(timezone.utc))


def login(email: str, password: str, ip: str) -> tuple[str, datetime, dict]:
    """Trả về (token, expires_at, admin). Ném 429/401 đúng luật."""
    if _too_many_fails(ip):
        raise HTTPException(429, detail="Quá nhiều lần đăng nhập sai. Thử lại sau 15 phút.")
    with db.get_conn() as conn:
        admin = conn.execute(
            "SELECT * FROM core.admins WHERE lower(email) = lower(%s) AND status = 'ACTIVE'",
            (email,),
        ).fetchone()
        ok = False
        if admin is not None:
            ok = bcrypt.checkpw(password.encode(), admin["password_hash"].encode())
        if not ok:
            _record_fail(ip)
            raise HTTPException(401, detail="Email hoặc mật khẩu không đúng.")
        _fails.pop(ip, None)
        token = secrets.token_hex(32)
        expires = datetime.now(timezone.utc) + timedelta(hours=TTL_HOURS)
        conn.execute(
            """INSERT INTO core.admin_sessions (admin_id, token, expires_at)
               VALUES (%s, %s, %s)""",
            (admin["admin_id"], token, expires),
        )
        return token, expires, admin


def logout(token: str) -> None:
    with db.get_conn() as conn:
        conn.execute("DELETE FROM core.admin_sessions WHERE token = %s", (token,))


def require_admin(request: Request) -> dict:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, detail="Cần xác thực quyền quản trị.")
    try:
        with db.get_conn() as conn:
            row = conn.execute(
                """SELECT a.* FROM core.admin_sessions s
                   JOIN core.admins a ON a.admin_id = s.admin_id
                   WHERE s.token = %s AND s.expires_at > now() AND a.status = 'ACTIVE'""",
                (token,),
            ).fetchone()
    except psycopg.Error:
        raise HTTPException(401, detail="Cần xác thực quyền quản trị.")
    if row is None:
        raise HTTPException(401, detail="Cần xác thực quyền quản trị.")
    return row
