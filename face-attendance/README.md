# MHHS Attendance System

A local-first attendance pilot for students, faculty, and office staff. It uses FastAPI and SQLite on the server and face-api.js in the browser. It is not a production biometric system and must not be the sole basis for attendance decisions.

## Run on Windows

Open the `face-attendance` folder in VS Code, then run these commands in its terminal:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:ADMIN_PASSWORD = "replace-this-with-a-unique-password-of-at-least-12-characters"
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. Camera access is requested only when you choose to start a camera. Choose your own long admin password in the environment command on the first start. The app deliberately refuses to initialize without one; there is no default password.

For macOS/Linux, activate the environment with `source .venv/bin/activate`, set `ADMIN_PASSWORD="your-unique-long-password"`, then run the same `uvicorn` command. The original `uvicorn main:app` entry point remains available for existing launch configurations.

## Use

- **Kiosk:** choose **Start attendance camera** to scan one face at a time; stop it with the same button. Students are recorded once per day; staff scans alternate between check-in and check-out. If camera access fails, allow it in the browser and retry. **Enter attendance manually** opens the admin sign-in and manual-entry form for a non-biometric alternative.
- **Admin:** choose **Start enrollment camera** separately when adding a face; stop it with the same button. Upload a school/centre roster CSV, filter a daily present/absent report by centre and class, export it to CSV, add manual attendance with a reason, review consent/data status, and erase personal data.
- **Project settings:** use the gear menu in the top bar to switch between dark and light themes. Admins can change the password from the security settings panel.
- Admin sessions expire after eight hours. Five failed logins from the same address within 15 minutes are temporarily rate limited.

After a password change, the new credential is stored as a salted PBKDF2 hash in SQLite and takes precedence over `ADMIN_PASSWORD`; restarting the app does not reset it. All existing admin sessions are revoked when the password changes.

### Roster upload

Download the CSV template from the admin console or prepare a UTF-8 CSV with these columns:

```csv
id,name,role,center,class
STU-001,Jordan Lee,Student,North Campus,Grade 8 A
STU-002,Sam Patel,Student,North Campus,Grade 8 A
```

`id`, `name`, `role`, and `center` are required; `class` is optional. Allowed roles are `Student`, `Faculty`, and `Office staff`. IDs must be unique within the file. Uploads are validated completely before any rows are saved; an existing ID is updated, otherwise a roster-only person is added. A person needs face enrollment for automatic recognition, but not for roster tracking or manual attendance.

The daily report counts a roster member as present when an attendance record exists for that date (students: `Present`; staff: `Check-in` or `Check-out`). Everyone else in the selected centre/class is shown as absent. The prototype does not know school calendars, holidays, leave, or class schedules, so review those before acting on an absence list. The report is daily, not per lecture.

The manual form appends a record; it does not edit or delete earlier records. **Remove** in the face directory deletes only the enrolled descriptor. In **Privacy & personal data**, **Erase all** permanently deletes that person's roster entry, face descriptor, and attendance history.

The face-enrollment consent checkbox is required and its confirmation date is shown in the privacy directory. A CSV roster import does not claim or record biometric consent. Keep a documented consent process outside the prototype as well; the saved date records an admin confirmation, not proof of consent.

## Data and limitations

- Camera frames are processed in the browser. The browser sends 128-value face descriptors to the server for matching; descriptors are sensitive biometric data, even though raw photos are not stored by this application.
- Face models and the face-api.js script load from jsDelivr, and fonts load from Google Fonts. Internet access is required on first load. The app does not intentionally upload camera frames to those services; host and verify assets locally before any restricted or offline deployment.
- There is no liveness or presentation-attack detection. A photo or video may be accepted. A distance threshold of 0.5 is only a starting point and must be calibrated using representative test data; the displayed distance is not a probability.
- Public check-in requests accept descriptors and cannot prove that a live camera produced them. Rate limiting is basic and in-memory. Keep the server bound to localhost; do not expose it to a network or use real attendance data without a security and privacy review.
- Provide a practical non-biometric option, human review, and a way to challenge and correct records. Obtain informed consent, define retention and deletion rules (including backups), protect `attendance.db`, and check institutional policy and local law before a pilot.
- SQLite and this prototype's process-local session/rate-limit state are intended for a single local instance, not multi-kiosk or high-availability deployments.

## API

| Method | Path | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/login` | Public | Admin login; returns an expiring token |
| `POST` | `/api/admin/password` | Admin | Change password with the current password; revoke active sessions |
| `GET` | `/api/people` | Admin | List enrolled people, without descriptors |
| `POST` | `/api/people` | Admin | Enroll a 128-value descriptor |
| `DELETE` | `/api/people/{person_id}` | Admin | Delete enrolled descriptor; keep attendance history |
| `GET` | `/api/roster` | Admin | List expected people; optionally filter by `center` and `group_name` |
| `POST` | `/api/roster/import` | Admin | Validate and upsert roster rows from `{ "csv_text": "..." }` |
| `DELETE` | `/api/roster/{person_id}` | Admin | Erase roster, face descriptor, and attendance history |
| `POST` | `/api/checkin` | Public | Match a submitted descriptor and record attendance |
| `POST` | `/api/attendance/manual` | Admin | Append a manual record with a reason |
| `GET` | `/api/attendance?date_filter=YYYY-MM-DD` | Admin | List records for a date; omit filter for all dates |
| `GET` | `/api/attendance/summary?date_filter=YYYY-MM-DD&center=...&group_name=...` | Admin | Compare the expected roster with daily attendance |

Admin endpoints use the `X-Token` header returned by `/api/login`. FastAPI's interactive API documentation is available at `/docs` while the local server is running.

## Project structure

```text
face-attendance/
├── app/
│   ├── routers/
│   │   ├── auth.py      # Login and password management
│   │   ├── people.py    # Enrollment and roster management
│   │   └── attendance.py  # Check-in, manual records, and reports
│   ├── config.py        # Paths and runtime settings
│   ├── database.py      # SQLite connections, schema, and settings
│   ├── main.py          # FastAPI app, lifecycle, and static files
│   ├── models.py        # API request models
│   └── security.py      # Passwords, sessions, rate-limit state, validation
├── main.py              # Backward-compatible Uvicorn entry point
├── static/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js       # Browser interface and camera flow
├── attendance.db        # Created on first start; excluded from Git
├── requirements.txt
└── README.md
```

The database remains beside the project files so existing `attendance.db` data is preserved. Set `ATTENDANCE_DB` to use a different location.