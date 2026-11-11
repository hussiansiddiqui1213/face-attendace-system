# MHHS Attendance System: Project Notes

A web-based face-recognition attendance system for **students, faculty and office staff** across MHHS schools and centres.

---

## 1. Conversation summary

### Goal
Build a website where people mark attendance by face instead of a biometric device.

### Users and roles
| Group | How attendance is tracked |
|---|---|
| Students | Marked "Present" (per day now; per class/lecture is a planned upgrade) |
| Faculty | Check-in and check-out times per day |
| Office staff | Check-in and check-out times per day |
| Admin | Enrolls/removes people, views and exports all records |

### How face attendance works
1. **Enrollment:** the admin captures 5 face samples. They are averaged into one 128-number "embedding" (face descriptor). Raw photos are not stored.
2. **Recognition:** at check-in the camera computes an embedding and compares it with stored ones. If the distance is below the threshold (0.5), the person is identified.
3. **Recording:** attendance is saved with date, time, type, centre/class and descriptor distance. Distance is not a probability or confidence percentage.
4. **Reports:** admins compare a date's attendance against an uploaded centre/class roster, review present/absent lists, and export reports to CSV (opens in Excel).

### Decisions made
- First, a quick **single-file browser prototype** (`face-attendance.html`) to test the idea.
- Then, a **proper VS Code project** (`face-attendance-project.zip`) with a Python backend, because the user wanted a separate project.

### Final project structure
```
face-attendance/
├── app/
│   ├── routers/
│   │   ├── auth.py      # Login and password management
│   │   ├── people.py    # Enrollment and roster management
│   │   └── attendance.py # Check-in, manual records, and reports
│   ├── config.py        # Paths and runtime settings
│   ├── database.py      # SQLite connections, schema, and settings
│   ├── main.py          # FastAPI app, lifecycle, and static files
│   ├── models.py        # API request models
│   └── security.py      # Passwords, sessions, and validation
├── main.py              # Backward-compatible Uvicorn entry point
├── requirements.txt   # fastapi, uvicorn
├── README.md
├── .gitignore
├── attendance.db      # created automatically on first run
└── static/
    ├── index.html     # web interface
    ├── style.css
    └── app.js         # camera, face detection, admin panel
```

### How to run (VS Code)
1. Unzip and open the `face-attendance` folder in VS Code.
2. Create a virtual environment:
   - Windows: `python -m venv .venv` then `.venv\Scripts\activate`
   - Mac/Linux: `python3 -m venv .venv` then `source .venv/bin/activate`
3. Install: `pip install -r requirements.txt`
4. Set an `ADMIN_PASSWORD` of at least 12 characters, then start with `uvicorn app.main:app --host 127.0.0.1 --port 8000`.
5. Open `http://localhost:8000` and allow camera access (internet is needed on first load for the face models).

There is no default admin password. Set a unique password with at least 12 characters before starting:
- Windows (PowerShell): `$env:ADMIN_PASSWORD="your-unique-long-password"; uvicorn app.main:app --host 127.0.0.1 --port 8000`
- Mac/Linux: `ADMIN_PASSWORD="your-unique-long-password" uvicorn app.main:app --host 127.0.0.1 --port 8000`

### API endpoints
| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/login` | Public | Admin login, returns a token |
| GET | `/api/people` | Admin | List enrolled people |
| POST | `/api/people` | Admin | Enroll a person with face data |
| DELETE | `/api/people/{id}` | Admin | Remove a person |
| GET | `/api/roster` | Admin | List expected people, optionally filtered by centre/class |
| POST | `/api/roster/import` | Admin | Validate and upload a roster CSV |
| DELETE | `/api/roster/{id}` | Admin | Erase roster, face descriptor and attendance history |
| POST | `/api/checkin` | Public | Match a face and record attendance |
| POST | `/api/attendance/manual` | Admin | Add a manual record with a reason |
| GET | `/api/attendance?date_filter=` | Admin | Get records |
| GET | `/api/attendance/summary?date_filter=&center=&group_name=` | Admin | Compare roster against attendance and list absent people |

---

## 2. Resources

### Software (all free and open source)
| Resource | Used for |
|---|---|
| Python 3.9+ | Backend language |
| FastAPI | Web framework / API |
| Uvicorn | Server that runs FastAPI |
| SQLite | Database (built into Python, no install) |
| face-api.js (@vladmandic fork) | Face detection and 128-number face descriptors in the browser |
| VS Code | Code editor |
| A modern browser (Chrome, Edge, Firefox) | Camera access via `getUserMedia` |

### Hardware
- A computer or tablet at each check-in point, with a **webcam** (720p or better recommended).
- Good, even lighting at the camera position.
- Reliable network between the kiosk and the server (or run both on the same machine).

### People and knowledge needed
- Basic Python and JavaScript to maintain it.
- Someone to act as admin (enrolls people, exports reports).
- Written consent process for storing face data.

### Useful learning links
- FastAPI docs: https://fastapi.tiangolo.com
- face-api.js (vladmandic): https://github.com/vladmandic/face-api
- MDN `getUserMedia`: https://developer.mozilla.org/docs/Web/API/MediaDevices/getUserMedia
- SQLite: https://www.sqlite.org/docs.html

### Cost
- **Software: free.**
- Hardware: only webcams/tablets. This is usually far cheaper than a commercial biometric terminal per door.
- Hosting (optional): a small VPS or a spare office PC is enough for a few hundred users.

---

## 3. Drawbacks and limitations

### Security
- **No liveness or presentation-attack detection.** A photo or video may be accepted as a live person. A blink or head-turn challenge can help a prototype but is not a dependable production defense by itself.
- **Simple admin login.** One configured password and process-local tokens (reset when the server restarts). Tokens expire after eight hours; login attempts are rate limited. There are no individual admin accounts.
- **`/api/checkin` is public.** Anyone who can reach the server may submit requests. Descriptors sent by the browser do not prove a live camera scan; keep the server bound to localhost and do not expose it to a network.
- **Admin privacy controls:** the console shows the consent confirmation date and can erase an individual's roster row, face descriptor, and attendance history. The saved date is an administrator's confirmation, not proof of consent.
- **Database is not encrypted.** Face embeddings in `attendance.db` are biometric data and need protection. Limit database and backup access, define retention and deletion rules, and consider encryption at rest.
- **HTTP only on localhost.** Real deployment needs HTTPS (browsers also require it for the camera). Restrict network access to authorized kiosks where possible.
- **No audit trail for changes.** Manual attendance entries store a reason and source, but this prototype does not provide a complete tamper-evident audit log.

### Accuracy
- Affected by **poor lighting, angles, masks, glasses, heavy beard changes** and low-quality webcams.
- **Look-alikes and twins** can cause false matches. The 0.5 threshold is not universal; calibrate it using representative local tests. A descriptor distance is a distance score, not a probability or confidence percentage.
- **Averaging five descriptors is not automatically reliable.** Reject poor-quality samples, validate the combined descriptor against held-out captures, and test whether re-enrollment improves results.
- Measure false accepts and false rejects in realistic conditions before a pilot. Do not use face matching as the sole basis for attendance; provide human review and a correction process.
- Matching compares against everyone in the database one by one. This is fine for hundreds of people but slow for tens of thousands.
- Models are small and fast, so they are less accurate than heavy server-side models such as InsightFace/ArcFace.
- Faces change over time (age, appearance), so re-enrollment may be needed.

### Functional gaps
- Students are tracked **per day, not per class or lecture**.
- No late/absent rules, holidays, leave management or shift settings.
- No self-service view for students or faculty to see their own attendance.
- CSV roster import is supported, but bulk face enrollment and photo import are not.
- Daily present/absent reports can be filtered by centre and class/group; there are no class-period schedules, school-calendar/holiday rules, charts or monthly summaries.
- No email or SMS notifications.
- A forgotten check-out cannot be corrected by the admin yet.

### Technical
- Face models load from a **CDN**, so internet is needed unless the model files are hosted locally.
- Each kiosk needs a browser tab left open with camera permission.
- **SQLite** is fine for small to medium use but not for many simultaneous kiosks writing at once; move to PostgreSQL/MySQL for scale.
- Not tested with a real camera in this environment, so expect small fixes during your first run.

### Privacy and legal
- Face data is **sensitive biometric data**. A descriptor is not a photo, but it can still identify a person and must be protected. Many regions require explicit consent, a clear purpose, secure storage and a deletion process.
- Students who are minors may need parental consent.
- Provide a practical alternative (for example manual entry) for people who decline or cannot be recognised, without penalizing them. Set a retention period and process for deleting both active records and backups.
- Face enrollment requires an admin consent confirmation; roster CSV import does not imply biometric consent. Admins can erase a person's local roster, face descriptor, and attendance history from the console.
- Camera frames are processed in the browser; descriptors are sent to the server and stored. Document who can access descriptors and how a person can challenge or correct an attendance record.
- Check your local data-protection law and institutional policy before going live.

---

## 4. Recommended next steps (priority order)
1. **Pilot safeguards:** provide a non-biometric alternative, manual review/correction, clear consent and retention/deletion rules, and do not make face matching the sole attendance authority.
2. **Validate recognition:** collect representative test captures, measure false accepts and false rejects, calibrate the threshold, and document the conditions where matching fails.
3. **Secure the deployment:** individual admin accounts, HTTPS, expiring tokens, stronger rate limiting, kiosk/request controls, audit logs, and protected database backups. Require a configured admin secret instead of shipping a known default.
4. **Assess liveness:** evaluate presentation-attack detection for the actual kiosk setup; a blink or head-turn check alone is not sufficient for a high-stakes deployment.
5. **Class-wise attendance:** extend the current daily centre/class roster report with timetables, courses and per-lecture marking for students and faculty.
6. **Rules and reports:** late/absent thresholds, holidays, monthly summaries, PDF/Excel exports, and admin correction workflows.
7. **Role dashboards:** students and faculty log in to see their own attendance percentage.
8. **Scale and operations:** consider PostgreSQL for concurrent writes, local model hosting for offline use, and bulk enrollment only after validation and access controls are in place.

---

## 5. Quick FAQ
**Does it store photos?** No. It stores only a 128-number embedding per person, which can still be treated as biometric data.

**Can it work offline?** Only if you download the face-api model files and serve them locally instead of from the CDN.

**Can it replace a biometric machine today?** It works as a prototype or pilot. For a full replacement, add liveness detection, security hardening and the missing attendance rules first.
