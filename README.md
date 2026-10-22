# MechanicPro

MechanicPro is a service-management app for equipment service companies. Managers create and assign jobs, mechanics work through them and record what they did, and customers request service, follow progress and review completed work.

Built with React + TypeScript (Vite) on the frontend and Flask, SQLAlchemy, Alembic and JWT authentication on the backend. It runs on SQLite locally and PostgreSQL in production.

## Features

- **Role-based dashboards** for managers (boss), mechanics and customers, with every query scoped to the user's company.
- **Invite-only accounts.** Managers issue single-use invitation codes that expire after 7 days.
- **A job workflow with enforced statuses:** Pending → Assigned → Accepted → In Progress ⇄ Paused → Completed. Mechanics can't decline or cancel jobs.
- **Job worksheets.** Start, Pause and Resume run a timer automatically; mechanics log work done, parts used (name and quantity) and the job type's checklist, on a phone-friendly screen. A job can't be completed until work is described and every required checklist item is ticked.
- **Job history.** Every status change, assignment, edit, part, checklist tick and note is logged with who and when, and managers see it as a timeline.
- **Permanent service history.** Records, reviews and customer service requests can't be deleted; finished jobs lock their worksheet.
- **Notifications** for assignments, status changes, requests and reviews.

## Quick start

See **[SETUP.md](SETUP.md)** for the full local setup on Windows, macOS and Linux, the demo accounts, the checks and every environment variable. In short:

```bash
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt && cp .env.example .env
python seed.py && flask --app run.py run --port 5000

cd frontend && npm install && cp .env.example .env.local && npm run dev
```

Then open http://localhost:5173.

## Project structure

- `backend/app/models`: SQLAlchemy models
- `backend/app/routes`: REST API (auth, jobs, customers and requests, machines, service records, reviews, notifications, users, company, reports)
- `backend/app/utils`: role checks and input validation
- `backend/migrations`: Alembic database migrations
- `backend/tests`: pytest suite
- `frontend/src/pages`: role dashboards and workspace pages
- `frontend/src/components`: shared UI
- `frontend/src/services/api.ts`: API client (token refresh, error handling)

## Status

Under active development. Production deployment configuration, email delivery and two-factor authentication haven't been built yet. Don't use the demo data or demo passwords outside local development.
