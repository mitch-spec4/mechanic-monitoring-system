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

> **Upgrading from an older checkout?** Earlier versions created the database without migrations. Delete `backend/instance/mechanic_pro.db` and run `seed.py` again.

## 2. Frontend

In a second terminal, from the repository root:

```bash
cd frontend
npm install
cp .env.example .env.local      # PowerShell: Copy-Item .env.example .env.local
npm run dev
```

Open http://localhost:5173. The frontend reads the backend URL from `VITE_API_BASE_URL` in `.env.local`. Restart Vite after changing it.

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

## Checks

```bash
# Backend tests (from backend/, with the virtual environment active)
pytest

# Confirm the migrations match the models
flask --app run.py db check

# Frontend type-check and production build (from frontend/)
npm run build
```

CI runs all of these on every pull request, and also runs the migrations, seed and a job workflow against PostgreSQL.

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
| `LOGIN_RATE_LIMIT` | `10 per minute;50 per hour` | Login and invitation attempts per client IP |
| `RATELIMIT_STORAGE_URI` | `memory://` | Use a shared store such as `redis://…` when running more than one server process |

Generate secrets with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

The backend **fails closed**. If `APP_ENV` is not `development` or `test`, it refuses to start unless the secrets, database URL and CORS origins are all set properly. `postgres://` and `postgresql://` URLs are converted to the bundled `psycopg` driver automatically.

Frontend setting (`frontend/.env.local`, or the build environment):

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Backend API URL, e.g. `https://api.example.com/api` |

## Production notes (until the deployment guide is written)

- Run `flask --app run.py db upgrade` on every deploy. Never run `seed.py`.
- Serve the backend with a production WSGI server (for example gunicorn), not `flask run`.
- Build the frontend with `npm run build` and serve `frontend/dist/` as static files.
- Never commit `.env` files; set the variables in your host's settings.
