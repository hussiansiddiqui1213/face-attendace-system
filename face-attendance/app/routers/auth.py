"""Admin login and password routes."""

import secrets
import time
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request

from app.config import LOGIN_WINDOW_SECONDS, MAX_LOGIN_FAILURES, SESSION_SECONDS
from app.database import write_setting
from app.models import Login, PasswordChange
from app.security import (
    client_key,
    hash_admin_password,
    login_failures,
    prune_times,
    require_admin,
    tokens,
    verify_admin_password,
)


router = APIRouter()


@router.post("/api/login")
def login(body: Login, request: Request):
    now = time.monotonic()
    key = client_key(request)
    failures = login_failures[key]
    prune_times(failures, now, LOGIN_WINDOW_SECONDS)
    if len(failures) >= MAX_LOGIN_FAILURES:
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")
    if not verify_admin_password(body.password):
        failures.append(now)
        raise HTTPException(status_code=401, detail="Wrong password")
    login_failures.pop(key, None)
    token = secrets.token_urlsafe(32)
    tokens[token] = now + SESSION_SECONDS
    return {"token": token, "expires_in": SESSION_SECONDS}


@router.post("/api/admin/password")
def change_admin_password(
    body: PasswordChange,
    x_token: Optional[str] = Header(default=None, alias="X-Token"),
):
    require_admin(x_token)
    if not verify_admin_password(body.current_password):
        raise HTTPException(status_code=403, detail="Current password is incorrect")
    if secrets.compare_digest(body.current_password, body.new_password):
        raise HTTPException(status_code=422, detail="New password must be different from the current password")
    write_setting("admin_password_hash", hash_admin_password(body.new_password))
    tokens.clear()
    return {"ok": True, "message": "Password changed. All admin sessions have been signed out."}
