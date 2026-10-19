"""Admin authentication — sha256+salt passwords, DB-backed session cookie.

Identical scheme to the original implementation (US-21 login, US-30 logout):
password hash stored as `SALT$sha256(SALT:password)`, session token in
core.admin_sessions, httpOnly cookie `rs_admin_session` valid for 8 hours.
Logins/logouts are recorded in core.system_logs and core.admins.last_login_at.
"""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, Response

from . import config, db


def hash_password(password: str) -> str:
    digest = hashlib.sha256(f"{config.SALT}:{password}".encode("utf-8")).hexdigest()
    return f"{config.SALT}${digest}"


def verify_password(password: str, stored: str) -> bool:
    return secrets.compare_digest(hash_password(password), stored)


def create_session(conn, admin_id: int) -> tuple[str, datetime]:
    token = secrets.token_hex(32)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=config.SESSION_TTL_SECONDS)
    conn.execute(
        "INSERT INTO core.admin_sessions (admin_id, token, expires_at) VALUES (%s, %s, %s)",
        (admin_id, token, expires_at),
    )
    conn.execute(
        "UPDATE core.admins SET last_login_at = now(), updated_at = now() WHERE admin_id = %s",
        (admin_id,),
    )
    return token, expires_at


def destroy_session(conn, token: str) -> None:
    conn.execute("DELETE FROM core.admin_sessions WHERE token = %s", (token,))


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        config.SESSION_COOKIE,
        token,
        max_age=config.SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.set_cookie(
        config.SESSION_COOKIE, "", max_age=0, httponly=True, samesite="lax", path="/"
    )


def get_admin(request: Request) -> dict | None:
    """Resolve the admin identity from the session cookie (or None)."""
    token = request.cookies.get(config.SESSION_COOKIE)
    if not token:
        return None
    with db.get_conn() as conn:
        row = conn.execute(
            """
            SELECT s.session_id, s.expires_at, a.admin_id, a.username, a.full_name
            FROM core.admin_sessions s JOIN core.admins a ON a.admin_id = s.admin_id
            WHERE s.token = %s
            """,
            (token,),
        ).fetchone()
    if not row:
        return None
    if row["expires_at"] < datetime.now(timezone.utc):
        try:
            with db.get_conn() as conn:
                conn.execute("DELETE FROM core.admin_sessions WHERE session_id = %s", (row["session_id"],))
        except Exception:
            pass
        return None
    return {"id": row["admin_id"], "username": row["username"], "fullName": row["full_name"]}


def require_admin(request: Request) -> dict:
    admin = get_admin(request)
    if not admin:
        raise HTTPException(status_code=401, detail="Cần xác thực quyền quản trị.")
    return admin


AdminDep = Depends(require_admin)
