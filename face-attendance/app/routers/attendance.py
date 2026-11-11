"""Face check-in and attendance-report routes."""

import json
import math
import time
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request

from app.config import (
    MATCH_THRESHOLD,
    MAX_SCANS_PER_WINDOW,
    MIN_MATCH_GAP,
    SCAN_WINDOW_SECONDS,
)
from app.database import db
from app.models import ManualEntry, Scan
from app.security import (
    client_key,
    prune_times,
    require_admin,
    scan_requests,
    validate_descriptor,
    validate_iso_date,
)


router = APIRouter()


@router.post("/api/checkin")
def checkin(scan: Scan, request: Request):
    validate_descriptor(scan.descriptor)
    now_mono = time.monotonic()
    requests = scan_requests[client_key(request)]
    prune_times(requests, now_mono, SCAN_WINDOW_SECONDS)
    if len(requests) >= MAX_SCANS_PER_WINDOW:
        raise HTTPException(status_code=429, detail="Scan rate limit reached. Wait a minute and try again.")
    requests.append(now_mono)

    best = None
    best_distance = float("inf")
    second_distance = float("inf")
    with db() as connection:
        enrolled = connection.execute("SELECT * FROM people").fetchall()
        for person in enrolled:
            stored = json.loads(person["descriptor"])
            distance = math.dist(scan.descriptor, stored)
            if distance < best_distance:
                best, second_distance = person, best_distance
                best_distance = distance
            elif distance < second_distance:
                second_distance = distance

        if best is None or best_distance > MATCH_THRESHOLD:
            return {"status": "unknown"}
        if second_distance < float("inf") and second_distance - best_distance < MIN_MATCH_GAP:
            return {"status": "ambiguous"}

        now = datetime.now()
        today = now.strftime("%Y-%m-%d")
        records = connection.execute(
            "SELECT time, type FROM attendance WHERE person_id = ? AND date = ? ORDER BY rid DESC",
            (best["id"], today),
        ).fetchall()
        if best["role"] == "Student":
            if records:
                return {"status": "already_recorded", "name": best["name"]}
            record_type = "Present"
        else:
            if records:
                last_time = datetime.strptime(records[0]["time"], "%H:%M:%S")
                if (now - last_time.replace(year=now.year, month=now.month, day=now.day)).total_seconds() < 60:
                    return {"status": "cooldown", "name": best["name"]}
            record_type = "Check-out" if records and records[0]["type"] == "Check-in" else "Check-in"

        record_time = now.strftime("%H:%M:%S")
        connection.execute(
            "INSERT INTO attendance(person_id, name, role, date, time, type, distance, center, group_name, source) "
            "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'face')",
            (best["id"], best["name"], best["role"], today, record_time, record_type,
             best_distance, best["center"], best["group_name"]),
        )
        return {
            "status": "ok",
            "name": best["name"],
            "type": record_type,
            "time": record_time,
            "distance": round(best_distance, 4),
        }


@router.post("/api/attendance/manual")
def add_manual_entry(entry: ManualEntry, x_token: Optional[str] = Header(default=None, alias="X-Token")):
    require_admin(x_token)
    record_date = validate_iso_date(entry.date)
    note = entry.note.strip()
    if len(note) < 3:
        raise HTTPException(status_code=422, detail="Add a short reason for the manual record")
    with db() as connection:
        person = connection.execute(
            "SELECT id, name, role, center, group_name FROM roster WHERE id = ?", (entry.person_id,)
        ).fetchone()
        if person is None:
            raise HTTPException(status_code=404, detail="Person not found")
        if person["role"] == "Student" and entry.type != "Present":
            raise HTTPException(status_code=422, detail="Students can only be marked Present")
        if person["role"] != "Student" and entry.type == "Present":
            raise HTTPException(status_code=422, detail="Staff must be marked Check-in or Check-out")
        connection.execute(
            "INSERT INTO attendance(person_id, name, role, date, time, type, distance, center, group_name, source, note) "
            "VALUES(?, ?, ?, ?, ?, ?, NULL, ?, ?, 'manual', ?)",
            (person["id"], person["name"], person["role"], record_date,
             datetime.now().strftime("%H:%M:%S"), entry.type, person["center"], person["group_name"], note),
        )
    return {"ok": True}


@router.get("/api/attendance")
def attendance(date_filter: str = "", x_token: Optional[str] = Header(default=None, alias="X-Token")):
    require_admin(x_token)
    query = "SELECT rid, person_id, name, role, date, time, type, distance, center, group_name, source, note FROM attendance"
    parameters = ()
    if date_filter:
        query += " WHERE date = ?"
        parameters = (validate_iso_date(date_filter),)
    with db() as connection:
        return [dict(row) for row in connection.execute(query + " ORDER BY rid DESC", parameters)]


@router.get("/api/attendance/summary")
def attendance_summary(
    date_filter: str = "",
    center: str = "",
    group_name: str = "",
    x_token: Optional[str] = Header(default=None, alias="X-Token"),
):
    require_admin(x_token)
    report_date = validate_iso_date(date_filter) if date_filter else date.today().isoformat()
    query = """
        SELECT r.id, r.name, r.role, r.center, r.group_name,
               EXISTS(
                   SELECT 1 FROM attendance a
                   WHERE a.person_id = r.id AND a.date = ?
                     AND ((r.role = 'Student' AND a.type = 'Present')
                       OR (r.role != 'Student' AND a.type IN ('Check-in', 'Check-out')))
               ) AS present
        FROM roster r
        WHERE 1=1
    """
    parameters = [report_date]
    if center:
        query += " AND r.center = ?"
        parameters.append(center)
    if group_name:
        query += " AND r.group_name = ?"
        parameters.append(group_name)
    query += " ORDER BY r.center, r.group_name, r.name"
    with db() as connection:
        records = [dict(row) for row in connection.execute(query, parameters)]
    present_count = sum(bool(record["present"]) for record in records)
    return {
        "date": report_date,
        "total": len(records),
        "present": present_count,
        "absent": len(records) - present_count,
        "people": records,
    }
