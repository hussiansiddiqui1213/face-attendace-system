"""Authentication state and validation helpers."""

import base64
import hashlib
import math
import secrets
import time
from collections import defaultdict, deque
from datetime import date
from typing import Deque, Dict, List, Optional

from fastapi import HTTPException, Request

from app.config import ADMIN_PASSWORD
from app.database import read_setting


tokens: Dict[str, float] = {}
login_failures: Dict[str, Deque[float]] = defaultdict(deque)
scan_requests: Dict[str, Deque[float]] = defaultdict(deque)


def hash_admin_password(password: str) -> str:
    iterations = 310_000
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "$".join((
        "pbkdf2_sha256",
        str(iterations),
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    ))


def verify_admin_password(password: str) -> bool:
    stored_hash = read_setting("admin_password_hash")
    if stored_hash is None:
        return bool(ADMIN_PASSWORD) and secrets.compare_digest(password, ADMIN_PASSWORD)
    try:
        algorithm, iteration_text, salt_text, digest_text = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_text.encode("ascii"))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iteration_text))
        return secrets.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def require_admin(token: Optional[str]):
    expires_at = tokens.get(token or "")
    if expires_at is None or expires_at <= time.monotonic():
        tokens.pop(token or "", None)
        raise HTTPException(status_code=401, detail="Admin login required")


def validate_descriptor(descriptor: List[float]):
    if len(descriptor) != 128 or any(not math.isfinite(value) or abs(value) > 2 for value in descriptor):
        raise HTTPException(status_code=422, detail="Expected 128 finite face descriptor values")


def client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def prune_times(times: Deque[float], now: float, window: int):
    while times and now - times[0] >= window:
        times.popleft()


def validate_iso_date(value: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Date must use YYYY-MM-DD format") from exc
