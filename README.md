# Mechanic Pro - Ready Project
Full-stack service management starter using React + TypeScript, Flask, SQLAlchemy, PostgreSQL-ready database layer, JWT authentication, role-based access control and notifications.

## Backend
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env
python seed.py
flask --app run.py run --debug --port 5000

## Frontend
cd frontend
npm install
npm run dev

Open http://localhost:5173

Demo:
Boss: james@mechanicpro.test / password
Mechanic: mitch@gmail.com / password
Customer: abc@example.com / password
Invitation: DK-DEMO-2026

Customer access is invite-only in the API. Staff can register normally.

## Architecture
backend/app/models      SQLAlchemy models
backend/app/routes      auth, jobs, customers, machines, services, notifications
backend/app/services    business logic
backend/app/utils       JWT/RBAC helpers
frontend/src/pages      role dashboards
frontend/src/components reusable UI
frontend/src/services   API client
