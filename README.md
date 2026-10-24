# MechanicPro

MechanicPro is a service-management app for equipment service companies. Managers create and assign jobs, technicians work through them and record what they did, and customers request service, follow progress and review completed work.

Built with React + TypeScript (Vite) on the frontend and Flask, SQLAlchemy, Alembic and JWT authentication on the backend. It runs on SQLite locally and PostgreSQL in production.

## Features

- **A public homepage with plans.** Companies sign up themselves and start a 14-day free trial; plans (Starter, Professional and Business, priced in Kenyan shillings) set how many technicians and how much storage they get. Payment runs in test mode until a real payment provider is connected.
- **Role-based dashboards** for managers (boss), technicians and customers, with every query scoped to the user's company.
- **Invite-only team accounts.** Managers issue single-use invitation codes for their technicians and customers that expire after 7 days.
- **A job workflow with enforced statuses:** Pending → Assigned → Accepted → In Progress ⇄ Paused → Completed. Technicians can't decline or cancel jobs.
- **Job worksheets.** Start, Pause and Resume run a timer automatically; technicians log work done, parts used (name and quantity) and the job type's checklist, on a phone-friendly screen. A job can't be completed until work is described and every required checklist item is ticked.
- **Clock in and out, with location.** Technicians clock in to start work, with their location shared only while clocked in, after they agree to it, and with a "Location on" sign always visible. Start, resume and complete are stamped with a position. Managers see a map of clocked-in technicians and every shift's hours, and can correct a forgotten clock-out.
- **Equipment by customer.** Each customer's page lists their equipment, the pieces that need work first, and why: an open job, an open service request, or a status of Under Maintenance or Under Repair. Managers can create a job for a piece of equipment in one click. The Equipment page groups equipment under its customer, with a "Needs work only" filter.
- **Photos, videos and customer sign-off.** Technicians add before and after photos (shrunk on the phone before upload) and short videos while they work. Completing a job takes the customer's signature on the phone, or a recorded reason they couldn't sign. Every completed job has a PDF report that can be shared straight from the phone. Files are stored on disk or in any S3-compatible bucket (Cloudflare R2, Backblaze B2, AWS S3).
- **A technician's phone view.** Today's jobs come first, each with one big **Start work**, **Resume** or **Open** button, and the main pages sit in a bottom bar within reach of a thumb.
- **Offline mode for technicians, and an installable app.** With no signal, a technician still does the whole day: clock in and out, start, pause, resume and complete jobs (with the customer's signature), time, parts, checklist ticks, the service summary, notes, photos and videos. Each change is saved on the phone, shown at once as "waiting to sync", and sent once (with its own ID, so a repeat is never saved twice) as soon as the signal returns, dated when it really happened. A sync sign shows what's waiting; anything the server refuses (a job reassigned or cancelled meanwhile, say) is listed with the reason. The app installs to the home screen on Android and iPhone and opens with no signal. Managers' and customers' screens stay online only. See [SETUP.md](SETUP.md#offline-mode-and-the-installable-app) for the rules and the limits.
- **English and Kiswahili, light and dark.** A language button on every screen; the choice belongs to the account, so screens, emails and notifications follow it. A first visit is in English unless the browser is set to Kiswahili, and visitors in East Africa are offered Kiswahili once. Managers set the company's language (new people start in it, and invitations are written in it), time zone, currency and units, and anyone can switch to dark mode. Layouts are ready for right-to-left languages.
- **Security and data rights.** Two-step sign-in with an authenticator app for everyone (with backup codes and "remember this device"), lockout after five wrong attempts, an activity log for managers, a one-click export of all the company's data, deleting the company with 30 days to change your mind, and privacy policy and terms pages with recorded agreement. A test checks that every route taking an ID refuses people from other companies.
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
- `backend/app/routes`: REST API (auth, jobs and worksheets, checklists, shifts and location, photos and files, customers and requests, machines (equipment), service records, reviews, notifications, users, company, reports)
- `backend/app/services`: rules shared by the routes (worksheets, location, file storage, signatures, the PDF report)
- `backend/app/utils`: role checks and input validation
- `backend/migrations`: Alembic database migrations
- `backend/tests`: pytest suite
- `frontend/src/pages`: role dashboards and workspace pages
- `frontend/src/components`: shared UI
- `frontend/src/services/api.ts`: API client (token refresh, error handling)
- `frontend/src/offline`: offline mode (the phone's database, the queue of changes, sending them) and the installable app; `frontend/src/sw.ts` is the service worker

## Status

Under active development. Production deployment configuration and a real payment provider haven't been built yet, and the privacy policy and terms are placeholders. Don't use the demo data or demo passwords outside local development.
