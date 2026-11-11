"""SQLite connection management, schema setup, and application settings."""

import sqlite3
from contextlib import contextmanager
from typing import Optional

from app.config import DB_PATH


@contextmanager
def db():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 10000")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS people(
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                descriptor TEXT NOT NULL,
                center TEXT NOT NULL DEFAULT '',
                group_name TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS roster(
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                center TEXT NOT NULL,
                group_name TEXT NOT NULL DEFAULT '',
                consent_at TEXT
            );
            CREATE TABLE IF NOT EXISTS attendance(
                rid INTEGER PRIMARY KEY AUTOINCREMENT,
                person_id TEXT,
                name TEXT,
                role TEXT,
                date TEXT,
                time TEXT,
                type TEXT,
                conf INTEGER,
                distance REAL,
                center TEXT NOT NULL DEFAULT '',
                group_name TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT 'face',
                note TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS app_settings(
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        migrations = (
            ("people", "center", "ALTER TABLE people ADD COLUMN center TEXT NOT NULL DEFAULT ''"),
            ("people", "group_name", "ALTER TABLE people ADD COLUMN group_name TEXT NOT NULL DEFAULT ''"),
            ("roster", "consent_at", "ALTER TABLE roster ADD COLUMN consent_at TEXT"),
            ("attendance", "distance", "ALTER TABLE attendance ADD COLUMN distance REAL"),
            ("attendance", "center", "ALTER TABLE attendance ADD COLUMN center TEXT NOT NULL DEFAULT ''"),
            ("attendance", "group_name", "ALTER TABLE attendance ADD COLUMN group_name TEXT NOT NULL DEFAULT ''"),
            ("attendance", "source", "ALTER TABLE attendance ADD COLUMN source TEXT NOT NULL DEFAULT 'face'"),
            ("attendance", "note", "ALTER TABLE attendance ADD COLUMN note TEXT NOT NULL DEFAULT ''"),
        )
        for table, column, statement in migrations:
            columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
            if column not in columns:
                connection.execute(statement)
        connection.execute(
            "INSERT OR IGNORE INTO roster(id, name, role, center, group_name) "
            "SELECT id, name, role, center, group_name FROM people"
        )


def read_setting(key: str) -> Optional[str]:
    with db() as connection:
        row = connection.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def write_setting(key: str, value: str):
    with db() as connection:
        connection.execute(
            "INSERT INTO app_settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )
