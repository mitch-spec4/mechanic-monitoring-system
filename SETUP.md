# MechanicPro setup

This guide covers running MechanicPro locally, running the checks, and the settings a production deployment needs. Deployment to a specific host will be added later.

## Requirements

- Python 3.11 or newer
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
| Technician | `mitch@mechanicpro.test` |
| Technician | `amina@mechanicpro.test` |
| Technician | `brian@mechanicpro.test` |
| Customer | `abc@example.com` |
| Customer | `kenya@example.com` |
| Customer | `xyz@example.com` |

`seed.py` refuses to run when `APP_ENV` is anything other than `development` or `test`, so these accounts can't end up in production.

**Try the demo.** The homepage's **Try the demo** button (and **Try it as…** on each role card) gives every visitor a private copy of the same demo company, built by `backend/app/services/demo.py`. A bar along the bottom switches between the boss, a technician and a customer. Copies have no usable passwords (the button is the only way in), never send email and never take real payments, and are deleted 24 hours after they're made: whenever someone starts a new one, and by the daily clean-up below. One visitor (IP address) can start 10 an hour, and at most 300 exist at once. Unlike `seed.py`, this is safe in production.

**New companies.** Signing up from the homepage sends the new manager an email to confirm their address (the link works for 48 hours). Until they open it, a banner offers to send it again, and inviting people is refused, so an unconfirmed account can't make the app email strangers. A **Get set up** guide on the dashboard walks them through confirming the email, inviting a customer, adding a piece of equipment, inviting a technician and creating a job; each step ticks itself off, and the guide can be closed. Accounts that existed before email confirmation count as confirmed.

New technicians and customers join by invitation. The manager invites them under **Customers** or **Technicians**: the invitation is emailed with a link that fills in the form, and the code is also shown to share another way (for example on WhatsApp). The person can also use **Have an invitation code?** on the sign-in page. Codes work once, are tied to one email address, and expire after 7 days.

**Worksheets and checklists.** Managers create a checklist for each job type under **Checklists** (the demo data includes Repair, Inspection and Preventive maintenance) and pick the job type when creating a job. When the technician presses **Start work**, the checklist is copied onto the job and the timer starts; **Pause** and **Resume** stop and restart it. Open a job's **Worksheet** to add work notes, parts used, checklist ticks and the customer's service summary. **Complete** is refused until work is described and every required checklist item is ticked; completing fills in the service record the customer can review. Click any job title to see its full worksheet and history.

**Clock in and location.** Technicians must clock in before they can start or resume a job, and clocking out pauses any job in progress. The first time they clock in, they are asked to agree to location sharing. Clocking in needs a position; clocking out never does. While clocked in, a **Location on** sign is shown. A position is recorded at clock-in and clock-out, when a job starts, resumes or completes, and every few minutes while a job is in progress and the app is open. Nothing is recorded while clocked out. Phones stop sending positions when the app is in the background; only a native app could track in the background. Managers see clocked-in technicians under **Team Map**, and hours under **Shifts**, where they can set the clock-out time of a forgotten shift. In the demo data, Mitch and Amina are clocked in, and Brian is clocked out and hasn't agreed yet.

**Photos, videos and sign-off.** While a job is in progress or paused, the technician adds before, after and other photos and short videos on the job's page. Photos are shrunk on the phone to 1600 px (as JPEG) before upload. Videos can be up to 60 seconds and 50 MB; the length is checked on the phone and the size on the server. **Complete job** opens a sign-off pad: the customer types their name and signs with a finger, or the technician ticks **Customer not present** and says why. Either way it is recorded in the job's history. A completed job's page has **Share report** and **Download PDF** for the customer's report: the work done, parts, checklist, photos and signature, without hours. In the demo data, the conveyor inspection was signed by Grace Wanjiru. Locally, files are saved in `backend/instance/uploads`.

**Language, time zone and dark mode.** The app is in English (left to right) unless someone picks another language under **Settings**; today that's Kiswahili. The choice belongs to the account, so the screens, the emails and the notifications a person receives all use it, and it follows them to any device. The sign-in, sign-up and home pages have a small language picker too, remembered on that device. Managers set the company's **time zone** (every time in the app and on PDF reports is shown in it), **currency** and **units** (metric or imperial; used for location accuracy today) under **Settings**. **Appearance** (light, dark or the device's setting) is kept per device and is light by default.

To change or add wording, wrap the English in `t("...")` (or `mark("...")` for lists) in the frontend, and `_("...")` (or `N_("...")`) in the backend; the checks below list any text without Kiswahili, which goes in `frontend/src/i18n/sw.ts` and `backend/app/i18n/sw.py`. The words "Technician", "Equipment" and "Site" are only on screen: the database and API still say mechanic, machine and location. Dark mode needs no extra CSS: write colours as usual and `frontend/scripts/dark-colors.mjs` gives each a dark partner at build time (mark a rule `/* light-only */` to keep it light, as the signature paper is). The look of the signed-in app (type, colours, cards, status pills, motion) is one layer, `frontend/src/styles/bold.css`, loaded after the page stylesheets: pages keep their layout CSS, and colour and type changes go in that file. The fonts (Inter and Plus Jakarta Sans) are bundled with the app, not loaded from Google.

**Testing location on a real phone.** Phones only share location with secure (https) pages. With the backend running, start the frontend with `npm run dev:phone` instead of `npm run dev`. Then open the `https://<your computer's IP>:5173` address it prints, on a phone on the same Wi-Fi. The certificate is self-signed, so the phone warns once: choose to continue. Also try it with location blocked for the site, and outdoors.

**Forgot password?** on the sign-in page emails a link to choose a new password. It works once, for 1 hour, and opening it also confirms the email address. The answer on screen is the same whether or not the address has an account. For someone who can't get to their email, the manager can still click **Reset password** next to them under **Technicians** or **Customers**; the person enters that one-time code under **Forgot password? → Have a reset code from your manager?** It expires after 24 hours. Anyone can change their own password under **Settings**. Changing or resetting a password signs that account out everywhere else.

**Emails while developing.** In development nothing is sent: each email is written to the backend's log (look for `Email not sent (EMAIL_BACKEND=log)`), links included. Open the link from there to confirm an email or reset a password. See [Email](#email) for sending real emails.

## Checks

```bash
# Backend tests (from backend/, with the virtual environment active)
pytest

# Confirm the migrations match the models
flask --app run.py db check

# Frontend type-check and production build (from frontend/)
npm run build

# Every text on screen is translatable and has Kiswahili (from frontend/)
npm run i18n:check

# Every message the server sends has Kiswahili (from backend/)
python -m app.i18n.check

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
| `STORAGE_BACKEND` | `local` | `s3` on any host whose disk doesn't last or that runs more than one server. See [File storage](#file-storage) |
| `STORAGE_LOCAL_DIR` | `backend/instance/uploads` | Where `local` mode keeps files |
| `S3_BUCKET` | | **Required** with `s3` |
| `S3_ENDPOINT_URL` | | R2: `https://<account-id>.r2.cloudflarestorage.com`; B2: `https://s3.<region>.backblazeb2.com`; empty for AWS S3 |
| `S3_REGION` | `auto` | `auto` for R2; the bucket's region for B2 and AWS (e.g. `us-west-004`, `eu-west-1`) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | | **Required** with `s3`. A key that can only read, write and delete objects in this bucket |
| `MAX_PHOTO_MB` / `MAX_VIDEO_MB` | `10` / `50` | Largest photo and video accepted |
| `MAX_VIDEO_SECONDS` | `60` | Longest video the phone will upload |
| `BILLING_PROVIDER` | `test` | Leave unset: `none` (free trials only). `test` is refused in production. See [Plans and payments](#plans-and-payments) |
| `APP_URL` | the first `CORS_ORIGINS` entry | **Required**: your site's `https://` address. Links in emails point here |
| `EMAIL_BACKEND` | `log` (emails are written to the log) | `smtp` (the default, and required). See [Email](#email) |
| `EMAIL_FROM` | `MechanicPro <no-reply@mechanicpro.test>` | **Required**, e.g. `MechanicPro <no-reply@yourdomain.com>`, on a domain your provider has verified |
| `SMTP_HOST` / `SMTP_PORT` | / `587` | **Required** host; port from your provider |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | | From your provider (often an API key as the password) |
| `SMTP_SECURITY` | `starttls` | `starttls` (port 587), `ssl` (port 465) or `none` |
| `EMAIL_RATE_LIMIT` | `1 per minute;5 per hour` | Verification and password-reset emails to one address |
| `DEMO_RATE_LIMIT` | `10 per hour` | "Try the demo" copies one IP address can start |
| `CRON_SECRET` | | A long random value that turns on `/api/cron/daily` for a scheduler. See [Daily clean-up](#daily-clean-up) |

Live positions taken during jobs are deleted after 30 days. The app removes old ones whenever new positions arrive; in production, also run the [daily clean-up](#daily-clean-up).

Generate secrets with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

The backend **fails closed**. If `APP_ENV` is not `development` or `test`, it refuses to start unless the secrets, database URL, CORS origins, `APP_URL` and email settings are all set properly. `postgres://` and `postgresql://` URLs are converted to the bundled `psycopg` driver automatically.

Frontend setting (`frontend/.env.local`, or the build environment):

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Optional. Defaults to `/api` on the same site. Set it only when the API is on another subdomain of the same site, e.g. `https://api.example.com/api` |
| `VITE_PROXY_TARGET` | Development only: where Vite forwards `/api` (default `http://127.0.0.1:5000`) |

## Email

The app sends three kinds of email: confirming a new manager's address, password-reset links, and invitations. Billing receipts and renewal reminders will use the same interface, in `backend/app/services/email.py`, chosen by `EMAIL_BACKEND`:

- **`log`** (development): nothing is sent; each email is written to the backend's log.
- **`smtp`** (production): sent through your email provider's SMTP server. Every major provider offers SMTP, so switching provider only means changing these settings.

To set up sending (you can wait until launch):

1. Create an account with an email provider, for example Resend or Postmark.
2. Verify your domain with them (they give you DNS records to add), so emails from `no-reply@yourdomain.com` aren't marked as spam.
3. Copy their SMTP settings into the environment. For Resend: `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587`, `SMTP_USERNAME=resend`, `SMTP_PASSWORD=<your API key>`. For Postmark: `SMTP_HOST=smtp.postmarkapp.com`, `SMTP_PORT=587`, and your server API token as both username and password. Check your provider's SMTP page for the current values.
4. Set `EMAIL_FROM` and `APP_URL`, then sign up a test company and check the confirmation email arrives.

If sending fails, the request still succeeds and the error is logged: signup carries on, and the manager can resend the confirmation from the banner. Accounts in demo companies never send email.

## Daily clean-up

Once a day, three things should be cleared away: demo companies whose 24 hours are up, uploads that were started but never finished, and live positions older than 30 days. Either:

- call `GET /api/cron/daily` with the header `Authorization: Bearer <CRON_SECRET>` from your host's scheduler (Vercel Cron sends exactly this header when `CRON_SECRET` is set), or
- run `flask --app run.py purge-demos`, `purge-uploads` and `purge-locations` from cron.

Without a `CRON_SECRET`, the URL doesn't exist.

## File storage

Photos, videos and signatures are stored in one of two ways, chosen by `STORAGE_BACKEND`:

- **`local`** (the default) saves files on the server's disk, under `backend/instance/uploads` or `STORAGE_LOCAL_DIR`. Use it for development, or a single server with a lasting disk; back that folder up with the database.
- **`s3`** uses any S3-compatible bucket: Cloudflare R2, Backblaze B2, AWS S3 or MinIO. Use it on serverless hosts (their disks don't last, and they cap request sizes) and whenever more than one server runs the app.

How an upload works, in both modes: the phone asks the app to add a file; the app checks the type and size and replies with a signed link that is valid for 15 minutes and only accepts that file. The phone uploads to the link (the bucket, in `s3` mode, so videos never pass through the app). The app then checks the stored size again before the file appears on the job. Files are only ever handed out by the app after it checks the viewer's company and role; in `s3` mode it redirects to a link that expires after 5 minutes. Keep the bucket private.

Setting up a bucket:

1. Create a private bucket, and an access key limited to that bucket with read and write (object) permissions.
2. Set `STORAGE_BACKEND=s3` and the `S3_*` variables above.
3. Allow your site to upload from the browser with a CORS rule on the bucket. For R2 (bucket **Settings → CORS policy**) and AWS S3 (bucket **Permissions → CORS**):

   ```json
   [
     {
       "AllowedOrigins": ["https://app.example.com"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   For B2, add a CORS rule for the same origin that allows the `s3_put` and `s3_get` operations and the `Content-Type` header. Without the rule, uploads fail in the browser with a network error.

Uploads that are started but never finished (the app was closed, the signal dropped) are removed after a day by the [daily clean-up](#daily-clean-up).

Photos in a format the phone's browser can't open (for example HEIC in most browsers other than Safari) are refused on the phone with a message to choose a JPEG.

## Plans and payments

The homepage (`/`) shows the plans; **Get started** (or **Choose** on a plan) creates a new company with its owner as the manager. Plans and prices are set in `backend/app/services/plans.py`, in Kenyan shillings; the homepage, signup and checkout all read them from there:

| Plan | Monthly | Yearly | Technicians | Storage |
| --- | --- | --- | --- | --- |
| Starter | KSh 1,500 | KSh 15,000 | 3 | 2 GB |
| Professional | KSh 4,500 | KSh 45,000 | 10 | 20 GB |
| Business | KSh 12,000 | KSh 120,000 | 30 | 100 GB |

Yearly billing charges ten months (two months free). Today every plan includes every feature that's built; plans differ in team size and storage. The extra features the homepage lists for Professional and Business are marked **Planned** until they exist (their wording is in `frontend/src/pages/Home.tsx`). Every new company starts with a 14-day free trial; no card is needed. During the trial and once paid, the plan's limits apply: inviting a technician is refused once the team (plus open invitations) reaches the limit, and uploads are refused once storage is full. When a trial or paid period runs out, nothing is deleted and work in progress carries on, but creating jobs and inviting people waits until the manager pays under **Billing**. Companies created before plans existed get the Business plan with no end date.

Payment goes through a provider set by `BILLING_PROVIDER`:

- **`test`** (the default in development) shows the app's own checkout page with a test card. No real money is taken, and the server refuses to start with it in production.
- **`none`** (the default in production) turns online payment off, so companies can only start free trials.

A real provider (for example Paystack or Flutterwave for cards and mobile money in Kenya, or Paddle) needs an account in your name and API keys. It plugs in behind the same interface in `backend/app/services/billing.py`; that's planned work (PR 13 in the plan), together with renewals and receipts by email.

To try it locally: open http://localhost:5173, choose a plan, and sign up with a new email. **Pay now and skip the trial** goes to the test checkout; **Try a declined card** shows what happens when a card fails.

## Production notes (until the deployment guide is written)

- Run `flask --app run.py db upgrade` on every deploy. Never run `seed.py`.
- Run the [daily clean-up](#daily-clean-up).
- Set up [email](#email) before launch: the app won't start in production without it.
- Use `STORAGE_BACKEND=s3` unless the app runs on one server with a lasting disk.
- Map tiles come from the free OpenStreetMap servers, which are not meant for heavy commercial use. Switch to a paid tile provider before launch.
- Serve the backend with a production WSGI server (for example gunicorn), not `flask run`.
- Build the frontend with `npm run build` and serve `frontend/dist/` as static files.
- Serve the frontend and the API from the same site over HTTPS (for example `app.example.com` with the API at `/api`). Sessions are httpOnly, `Secure` cookies with CSRF protection, so browsers won't send them to a different site.
- Behind a load balancer, set `TRUSTED_PROXY_COUNT` so rate limiting sees real client IPs.
- Never commit `.env` files; set the variables in your host's settings.
