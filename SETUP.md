# MechanicPro setup

This guide covers running MechanicPro locally, running the checks, and the settings a production deployment needs. Deployment to a specific host will be added later.

## Requirements

- Python 3.10 or newer
- Node.js 20 LTS or newer
- Git

## 1. Backend

From the repository root, in its own terminal.

**Windows (PowerShell)**

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
Copy-Item .env.example .env
py seed.py
py -m flask --app run.py run --debug --port 5000
```

If PowerShell blocks the activation script, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` and activate again.

**macOS / Linux**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
python seed.py
flask --app run.py run --debug --port 5000
```

`seed.py` applies the database migrations and then loads demo data. It is safe to run more than once. Check the backend at http://127.0.0.1:5000/api/health, which returns `{"status":"ok"}`.

> **Upgrading from an older checkout?** Earlier versions created the database without migrations. The backend now stops with a message telling you so. Delete `backend/instance/mechanic_pro.db` and run `seed.py` again.

## 2. Frontend

In a second terminal, from the repository root:

```bash
cd frontend
npm install
cp .env.example .env.local      # PowerShell: Copy-Item .env.example .env.local
npm run dev
```

Open http://localhost:5173. The frontend calls `/api` on its own address, and Vite forwards those calls to the backend at http://127.0.0.1:5000 (change it with `VITE_PROXY_TARGET`). Keeping one address lets the secure session cookies work.

## Demo accounts (local only)

`seed.py` creates one demo company. Every demo account uses the password `password`.

| Role | Email |
| --- | --- |
| Manager (boss) | `james@mechanicpro.test` |
| Mechanic | `mitch@mechanicpro.test` |
| Mechanic | `amina@mechanicpro.test` |
| Mechanic | `brian@mechanicpro.test` |
| Customer | `abc@example.com` |
| Customer | `kenya@example.com` |
| Customer | `xyz@example.com` |

`seed.py` refuses to run when `APP_ENV` is anything other than `development` or `test`, so these accounts can't end up in production.

New mechanics and customers join by invitation. The manager creates an invitation code under **Customers** or **Mechanics**. The person then uses **Have an invitation code?** on the sign-in page. Codes work once, are tied to one email address, and expire after 7 days.

**Worksheets and checklists.** Managers create a checklist for each job type under **Checklists** (the demo data includes Repair, Inspection and Preventive maintenance) and pick the job type when creating a job. When the mechanic presses **Start work**, the checklist is copied onto the job and the timer starts; **Pause** and **Resume** stop and restart it. Open a job's **Worksheet** to add work notes, parts used, checklist ticks and the customer's service summary. **Complete** is refused until work is described and every required checklist item is ticked; completing fills in the service record the customer can review. Click any job title to see its full worksheet and history.

**Clock in and location.** Mechanics must clock in before they can start or resume a job, and clocking out pauses any job in progress. The first time they clock in, they are asked to agree to location sharing. Clocking in needs a position; clocking out never does. While clocked in, a **Location on** sign is shown. A position is recorded at clock-in and clock-out, when a job starts, resumes or completes, and every few minutes while a job is in progress and the app is open. Nothing is recorded while clocked out. Phones stop sending positions when the app is in the background; only a native app could track in the background. Managers see clocked-in mechanics under **Team Map**, and hours under **Shifts**, where they can set the clock-out time of a forgotten shift. In the demo data, Mitch and Amina are clocked in, and Brian is clocked out and hasn't agreed yet.

**Testing location on a real phone.** Phones only share location with secure (https) pages. With the backend running, start the frontend with `npm run dev:phone` instead of `npm run dev`. Then open the `https://<your computer's IP>:5173` address it prints, on a phone on the same Wi-Fi. The certificate is self-signed, so the phone warns once: choose to continue. Also try it with location blocked for the site, and outdoors.

If someone forgets their password, the manager clicks **Reset password** next to them under **Mechanics** or **Customers**. The person enters that one-time code under **Forgot password?** on the sign-in page; it expires after 24 hours. Anyone can change their own password under **Settings**. Changing or resetting a password signs that account out everywhere else.

Until email delivery is added, both kinds of code are shared with **Copy code** or **Email this code**, which opens your own mail app with the message filled in.

## Checks

```bash
# Backend tests (from backend/, with the virtual environment active)
pytest

# Confirm the migrations match the models
flask --app run.py db check

# Frontend type-check and production build (from frontend/)
npm run build

# Browser tests (from frontend/): starts a fresh seeded API and Vite, then drives the real UI
npx playwright install chromium   # first time only
npm run test:e2e                  # Chromium; also: npx playwright test --project=firefox|webkit|mobile
```

The browser tests need ports 5000 and 5173 free, so stop your dev servers first. They use `python3` (`py` on Windows) to start the API. If the backend packages are only installed in `backend/.venv`, point `E2E_PYTHON` at that interpreter, e.g. `E2E_PYTHON=../backend/.venv/bin/python npm run test:e2e`.

CI runs all of these on every pull request: the browser tests in Chromium, Firefox, WebKit (Safari's engine) and a phone-sized Chromium; the migrations, seed and a job workflow against PostgreSQL; and the Windows PowerShell steps above on a Windows machine.

## Database migrations

The schema is managed with Alembic (via Flask-Migrate). After changing a model:

```bash
flask --app run.py db migrate -m "Describe the change"   # review the generated file in migrations/versions/
flask --app run.py db upgrade
```

Commit the new migration file together with the model change.

## Environment variables

All backend settings live in `backend/.env` (see `backend/.env.example`).

| Variable | Development default | Production |
| --- | --- | --- |
| `APP_ENV` | `development` (set in `.env.example`) | Leave unset or set `production` |
| `SECRET_KEY` | built-in development value | **Required**, random, 32+ characters |
| `JWT_SECRET_KEY` | built-in development value | **Required**, random, 32+ characters |
| `DATABASE_URL` | `sqlite:///mechanic_pro.db` (stored in `backend/instance/`) | **Required**, e.g. `postgresql://user:pass@host:5432/db` |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | **Required**, your frontend origin(s); `*` is rejected |
| `JWT_ACCESS_MINUTES` | `30` | Access token lifetime |
| `JWT_REFRESH_MINUTES` | `10080` (7 days) | Refresh token lifetime |
| `LOGIN_RATE_LIMIT` | `10 per minute;50 per hour` | Failed sign-ins per IP and per email; invitation and reset attempts per IP. Stored in the database |
| `TRUSTED_PROXY_COUNT` | `0` | Number of proxies/load balancers in front of the app, so rate limiting sees the real client IP |

Live positions taken during jobs are deleted after 30 days. The app removes old ones whenever new positions arrive; in production, also run `flask --app run.py purge-locations` once a day (for example from cron).

Generate secrets with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

The backend **fails closed**. If `APP_ENV` is not `development` or `test`, it refuses to start unless the secrets, database URL and CORS origins are all set properly. `postgres://` and `postgresql://` URLs are converted to the bundled `psycopg` driver automatically.

Frontend setting (`frontend/.env.local`, or the build environment):

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Optional. Defaults to `/api` on the same site. Set it only when the API is on another subdomain of the same site, e.g. `https://api.example.com/api` |
| `VITE_PROXY_TARGET` | Development only: where Vite forwards `/api` (default `http://127.0.0.1:5000`) |

## Production notes (until the deployment guide is written)

- Run `flask --app run.py db upgrade` on every deploy. Never run `seed.py`.
- Run `flask --app run.py purge-locations` daily.
- Map tiles come from the free OpenStreetMap servers, which are not meant for heavy commercial use. Switch to a paid tile provider before launch.
- Serve the backend with a production WSGI server (for example gunicorn), not `flask run`.
- Build the frontend with `npm run build` and serve `frontend/dist/` as static files.
- Serve the frontend and the API from the same site over HTTPS (for example `app.example.com` with the API at `/api`). Sessions are httpOnly, `Secure` cookies with CSRF protection, so browsers won't send them to a different site.
- Behind a load balancer, set `TRUSTED_PROXY_COUNT` so rate limiting sees real client IPs.
- Never commit `.env` files; set the variables in your host's settings.
