"""Application paths and runtime settings."""

import os
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("ATTENDANCE_DB", str(PROJECT_DIR / "attendance.db")))
STATIC_DIR = PROJECT_DIR / "static"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")

MATCH_THRESHOLD = 0.5
MIN_MATCH_GAP = 0.05
SESSION_SECONDS = 8 * 60 * 60
LOGIN_WINDOW_SECONDS = 15 * 60
MAX_LOGIN_FAILURES = 5
SCAN_WINDOW_SECONDS = 60
MAX_SCANS_PER_WINDOW = 120
