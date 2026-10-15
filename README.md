# MechanicPro

MechanicPro is a service-management application built with React, TypeScript, Flask, SQLAlchemy, and JWT authentication. It includes role-based dashboards for company managers, mechanics, and customers.

## Run locally on Windows 11

Install **Python 3.10+**, **Node.js LTS**, and **Git** first. Open the repository folder in VS Code or PowerShell.

### 1. Start the backend

In Terminal 1, from the repository root:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
py seed.py
py -m flask --app run.py run --debug --port 5000
```

If PowerShell blocks virtual-environment activation, run this for the current terminal only, then activate again:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

The backend health check is available at http://127.0.0.1:5000/api/health and should return `{"status":"ok"}`.

### 2. Start the frontend

Open Terminal 2 at the repository root:

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open http://localhost:5173 in your browser. The frontend reads its backend URL from `VITE_API_BASE_URL` in `.env.local`. Restart Vite after changing that value.

## Local demo accounts

Running `py seed.py` creates sample data for local development. The seeded demo accounts use the password `password`:

| Role | Email |
| --- | --- |
| Manager | `james@mechanicpro.test` |
| Mechanic | `mitch@gmail.com` |
| Mechanic | `amina@mechanicpro.test` |
| Mechanic | `brian@mechanicpro.test` |
| Customer | `abc@example.com` |
| Customer | `kenya@example.com` |
| Customer | `xyz@example.com` |

**Development-only credentials:** never deploy the seeded demo accounts or the shared demo password to a public production environment. Use a fresh database and create secure, unique credentials for any real deployment. The seed script is intended for local demo/testing.

## Environment configuration

Backend settings are documented in `backend/.env.example`:

- `SECRET_KEY`: Flask secret.
- `JWT_SECRET_KEY`: JWT signing secret.
- `DATABASE_URL`: SQLite by default; PostgreSQL is supported when configured with a valid connection URL.
- `APP_ENV=production`: enables production configuration checks.
- `CORS_ORIGINS`: comma-separated frontend origins, required in production.

For production, set strong random secrets and your actual database URL and frontend origin. Do not commit `.env` or `.env.local` files.

## Build check

From the repository root:

```powershell
cd frontend
npm ci
npm run build
```

For the backend, activate its virtual environment and install `backend/requirements.txt`. The application exposes `/api/health` for a basic availability check.

## Project structure

- `backend/app/models`: SQLAlchemy data models.
- `backend/app/routes`: authentication, jobs, customers, machines, services, notifications, reviews, users, and reports APIs.
- `backend/app/services`: business logic.
- `backend/app/utils`: authentication and role helpers.
- `frontend/src/pages`: role-specific dashboards.
- `frontend/src/components`: reusable UI.
- `frontend/src/services/api.ts`: frontend API client.

## Release status

This repository is under active hardening. Before a public production launch, complete automated API/UI tests, verify the entire role-based workflow against a clean database, review invitation delivery, configure deployment and database migrations, and remove all development-only sample credentials from the production environment.
