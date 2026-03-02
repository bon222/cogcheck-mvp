# CogCheck - Game 1 Implementation (Corner Basket Swipe)

This repository now includes a complete Game 1 foundation:

- `backend/`: FastAPI + SQLAlchemy API for users, baseline status, attempts, raw events, and labels
- `ios/CogCheck/CogCheck/`: SwiftUI + SpriteKit source files for Game 1 with telemetry capture

## What is implemented now

- Simple profile model: first name + last name + persistent `device_user_id`
- Baseline gating rule: each user must complete 3 baseline attempts for `corner_basket_swipe`
- Attempt submission with:
  - summary metrics
  - raw touch stream (`touch_down`, `touch_move`, `touch_up`)
  - system events (`ball_completed`)
- Database tables:
  - `users`
  - `sessions`
  - `attempts`
  - `raw_events`
  - `labels`

## Backend setup

1. Create virtual environment and install dependencies:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Set database URL:

```bash
export DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/cogcheck"
```

For local quick testing only, default SQLite is already supported without setting `DATABASE_URL`.

3. Run API:

```bash
uvicorn app.main:app --reload
```

4. Verify health:

```bash
curl http://127.0.0.1:8000/health
```

## Easiest MVP setup (iPhone-friendly web link)

1. Start backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

2. Open this URL in your browser:

- [http://127.0.0.1:8000](http://127.0.0.1:8000)

3. In the page:
- enter first name + last name
- click `Save Profile`
- click `Start Game`
- complete 3 baseline attempts (required before normal runs)
- check that baseline moves from `0/3` to `3/3`

Behavior details:
- Session resumes automatically on same device for 2 hours.
- Use `Switch User (new profile)` to start fresh with a new identity on the same device.
- After baseline is complete, each normal run requires:
  - drinking level
  - sleep hours
- Game 1 mechanics:
  - max duration 30 seconds
  - one moving ball appears at a time
  - drag ball into matching corner
  - corner disappears when completed
  - next ball appears until all 4 are completed or timeout

This path avoids Xcode signing completely and is the fastest way to validate gameplay + data capture.

## Share as a link to friends (fastest)

Keep backend running, then open a second terminal and run:

```bash
ssh -R 80:localhost:8000 nokey@localhost.run
```

The terminal will print a public `https://...` URL. Send that link to friends on iPhone.

Important:
- Keep both terminals open while people are testing.
- Data will still save to your local [cogcheck.db](/Users/aaron/Desktop/YU%20Spring%202026/Predictive%20Models/Final%20Project/backend/cogcheck.db).

## Permanent cloud link (works when your computer is off)

Use Render for hosting and a managed Postgres database.

1. Push this project to GitHub.
2. In Render dashboard, click `New` -> `PostgreSQL`:
   - Name: `cogcheck-db`
   - Create database.
3. In Render dashboard, click `New` -> `Blueprint`:
   - Connect your GitHub repo.
   - Render reads [render.yaml](/Users/aaron/Desktop/YU%20Spring%202026/Predictive%20Models/Final%20Project/render.yaml) and creates service `cogcheck-mvp`.
4. Open service `cogcheck-mvp` -> `Environment` and set:
   - `DATABASE_URL` = Internal Database URL from `cogcheck-db`
5. Click `Manual Deploy` -> `Deploy latest commit`.
6. Open your service URL, for example:
   - `https://cogcheck-mvp.onrender.com`
7. Send this URL to friends on iPhone.

Your app and API are served from the same link:
- `/` serves the game page
- API endpoints remain at `/users/register`, `/attempts`, `/labels`, etc.

Quick post-deploy checks:
- `https://<your-service>.onrender.com/health` should return `{"status":"ok"}`
- `https://<your-service>.onrender.com` should open the game page

## iOS setup (optional next step)

1. Open [CogCheck.xcodeproj](/Users/aaron/Desktop/YU%20Spring%202026/Predictive%20Models/Final%20Project/ios/CogCheck/CogCheck.xcodeproj).
2. Select target `CogCheck` and run on an iPhone simulator.
3. If running on simulator, default backend URL in [APIClient.swift](/Users/aaron/Desktop/YU%20Spring%202026/Predictive%20Models/Final%20Project/ios/CogCheck/CogCheck/APIClient.swift) (`127.0.0.1`) is fine.
4. If running on physical iPhone, change `baseURL` to your computer's LAN IP (for example `http://192.168.1.20:8000`).

Note: If Xcode still shows signing prompts, use simulator only for now and continue with the browser MVP path above.

## Core API endpoints

- `POST /users/register`
- `GET /users/by-device/{device_user_id}`
- `GET /baseline/{user_id}/corner_basket_swipe`
- `POST /attempts`
- `POST /labels`

Payload examples are in `docs/game1_api_examples.md`.

## Physical database access (Excel + Python)

Database file (physical on disk):
- [cogcheck.db](/Users/aaron/Desktop/YU%20Spring%202026/Predictive%20Models/Final%20Project/backend/cogcheck.db)

Export all tables to Excel-ready CSV files:

```bash
"/Users/aaron/Desktop/YU Spring 2026/Predictive Models/Final Project/backend/.venv/bin/python" \
"/Users/aaron/Desktop/YU Spring 2026/Predictive Models/Final Project/backend/tools/export_sqlite_to_csv.py"
```

Exports are written to:
- `/Users/aaron/Desktop/YU Spring 2026/Predictive Models/Final Project/backend/exports/users.csv`
- `/Users/aaron/Desktop/YU Spring 2026/Predictive Models/Final Project/backend/exports/attempts.csv`
- `/Users/aaron/Desktop/YU Spring 2026/Predictive Models/Final Project/backend/exports/raw_events.csv`
- `/Users/aaron/Desktop/YU Spring 2026/Predictive Models/Final Project/backend/exports/sessions.csv`
- `/Users/aaron/Desktop/YU Spring 2026/Predictive Models/Final Project/backend/exports/labels.csv`

Python quick check:

```python
import sqlite3
db = "/Users/aaron/Desktop/YU Spring 2026/Predictive Models/Final Project/backend/cogcheck.db"
con = sqlite3.connect(db)
print(con.execute("select count(*) from attempts").fetchone())
```

## Next step

Once you confirm Game 1 data quality in Postgres, we can clone this telemetry pattern for Game 2 (`go_no_go_tap_burst`).
