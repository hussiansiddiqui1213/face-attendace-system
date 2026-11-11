# Face Attendance Project

This workspace contains the runnable MHHS attendance application, its project notes, and the original project archive.

## Workspace layout

```text
object-rcognization/
├── face-attendance/                 # Runnable FastAPI and browser application
│   ├── app/                          # Backend
│   ├── static/                       # Browser interface
│   ├── attendance.db                 # Existing local attendance data
│   ├── main.py                       # Compatibility entry point
│   ├── requirements.txt
│   └── README.md                     # Setup, usage, API, and limitations
├── docs/
│   └── face-attendance-notes.md      # Project background and planning notes
├── archives/
│   └── face-attendance-project.zip   # Original project archive
└── README.md
```

## Run the application

Open a terminal in `face-attendance` and run:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:ADMIN_PASSWORD = "replace-this-with-a-unique-password-of-at-least-12-characters"
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Then open http://127.0.0.1:8000. See [face-attendance/README.md](./face-attendance/README.md) for complete setup instructions, application details, API documentation, and privacy limitations.
