"""People enrollment and roster routes."""

import csv
import io
import json
import sqlite3
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from app.database import db
from app.models import Person, RosterUpload
from app.security import require_admin, validate_descriptor


router = APIRouter()


@router.get("/api/people")
def people(x_token: Optional[str] = Header(default=None, alias="X-Token")):
    require_admin(x_token)
    with db() as connection:
        return [dict(row) for row in connection.execute(
            "SELECT id, name, role, center, group_name FROM people ORDER BY name"
        )]


@router.get("/api/roster")
def get_roster(
    center: str = "",
    group_name: str = "",
    x_token: Optional[str] = Header(default=None, alias="X-Token"),
):
    require_admin(x_token)
    query = """
        SELECT r.id, r.name, r.role, r.center, r.group_name, r.consent_at,
               EXISTS(SELECT 1 FROM people p WHERE p.id = r.id) AS face_enrolled
        FROM roster r WHERE 1=1
    """
    parameters = []
    if center:
        query += " AND r.center = ?"
        parameters.append(center)
    if group_name:
        query += " AND r.group_name = ?"
        parameters.append(group_name)
    query += " ORDER BY r.center, r.group_name, r.name"
    with db() as connection:
        return [dict(row) for row in connection.execute(query, parameters)]


@router.delete("/api/roster/{person_id}")
def erase_person_data(person_id: str, x_token: Optional[str] = Header(default=None, alias="X-Token")):
    require_admin(x_token)
    with db() as connection:
        exists = connection.execute("SELECT 1 FROM roster WHERE id = ?", (person_id,)).fetchone()
        if exists is None:
            raise HTTPException(status_code=404, detail="Roster person not found")
        attendance_count = connection.execute(
            "SELECT COUNT(*) FROM attendance WHERE person_id = ?", (person_id,)
        ).fetchone()[0]
        connection.execute("DELETE FROM attendance WHERE person_id = ?", (person_id,))
        connection.execute("DELETE FROM people WHERE id = ?", (person_id,))
        connection.execute("DELETE FROM roster WHERE id = ?", (person_id,))
    return {"ok": True, "deleted_attendance_records": attendance_count}


@router.post("/api/roster/import")
def import_roster(upload: RosterUpload, x_token: Optional[str] = Header(default=None, alias="X-Token")):
    require_admin(x_token)
    try:
        reader = csv.DictReader(io.StringIO(upload.csv_text.lstrip("\ufeff")))
        headers = {str(header).strip().lower(): header for header in (reader.fieldnames or [])}
        required = {"id", "name", "role", "center"}
        missing = sorted(required - headers.keys())
        if missing:
            raise HTTPException(status_code=422, detail=f"CSV is missing required columns: {', '.join(missing)}")
        group_header = headers.get("class") or headers.get("group") or headers.get("group_name")
        role_names = {"student": "Student", "faculty": "Faculty", "office staff": "Office staff"}
        rows = []
        seen_ids = set()
        row_errors = []
        for line_number, raw in enumerate(reader, start=2):
            if line_number > 5001:
                row_errors.append("CSV exceeds the 5,000-row limit")
                break
            person_id = str(raw.get(headers["id"]) or "").strip()
            name = str(raw.get(headers["name"]) or "").strip()
            role = role_names.get(str(raw.get(headers["role"]) or "").strip().lower())
            center = str(raw.get(headers["center"]) or "").strip()
            group_name = str(raw.get(group_header) or "").strip() if group_header else ""
            problems = []
            if not person_id or len(person_id) > 64:
                problems.append("ID is required and must be 64 characters or fewer")
            if not name or len(name) > 120:
                problems.append("name is required and must be 120 characters or fewer")
            if role is None:
                problems.append("role must be Student, Faculty, or Office staff")
            if not center or len(center) > 120:
                problems.append("center is required and must be 120 characters or fewer")
            if len(group_name) > 120:
                problems.append("class/group must be 120 characters or fewer")
            if person_id in seen_ids:
                problems.append("ID appears more than once in this CSV")
            if problems:
                row_errors.append(f"Row {line_number}: {'; '.join(problems)}")
                continue
            seen_ids.add(person_id)
            rows.append((person_id, name, role, center, group_name))
        if row_errors:
            raise HTTPException(
                status_code=422,
                detail={"message": "No rows imported. Fix the CSV and try again.", "errors": row_errors[:20]},
            )
        if not rows:
            raise HTTPException(status_code=422, detail="CSV has a header but no people to import")
    except csv.Error as exc:
        raise HTTPException(status_code=422, detail=f"Could not parse CSV: {exc}") from exc

    with db() as connection:
        connection.executemany(
            "INSERT INTO roster(id, name, role, center, group_name) VALUES(?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=excluded.role, "
            "center=excluded.center, group_name=excluded.group_name",
            rows,
        )
        connection.executemany(
            "UPDATE people SET name=?, role=?, center=?, group_name=? WHERE id=?",
            [(name, role, center, group_name, person_id) for person_id, name, role, center, group_name in rows],
        )
    return {"imported": len(rows), "message": f"Imported {len(rows)} roster rows."}


@router.post("/api/people")
def add_person(person: Person, x_token: Optional[str] = Header(default=None, alias="X-Token")):
    require_admin(x_token)
    validate_descriptor(person.descriptor)
    if not person.consent_recorded:
        raise HTTPException(status_code=422, detail="Confirm that informed consent has been recorded")
    person_id = person.id.strip()
    name = person.name.strip()
    center = person.center.strip()
    group_name = person.group_name.strip()
    if not person_id or not name:
        raise HTTPException(status_code=422, detail="ID and name cannot be blank")
    if not center:
        raise HTTPException(status_code=422, detail="School/centre is required")
    try:
        with db() as connection:
            connection.execute(
                "INSERT INTO people(id, name, role, descriptor, center, group_name) VALUES(?, ?, ?, ?, ?, ?)",
                (person_id, name, person.role, json.dumps(person.descriptor, allow_nan=False), center, group_name),
            )
            connection.execute(
                "INSERT INTO roster(id, name, role, center, group_name, consent_at) VALUES(?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=excluded.role, "
                "center=excluded.center, group_name=excluded.group_name, consent_at=excluded.consent_at",
                (person_id, name, person.role, center, group_name, datetime.now().isoformat(timespec="seconds")),
            )
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="That ID is already enrolled") from exc
    return {"ok": True}


@router.delete("/api/people/{person_id}")
def delete_person(person_id: str, x_token: Optional[str] = Header(default=None, alias="X-Token")):
    require_admin(x_token)
    with db() as connection:
        result = connection.execute("DELETE FROM people WHERE id = ?", (person_id,))
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Person not found")
    return {"ok": True}
