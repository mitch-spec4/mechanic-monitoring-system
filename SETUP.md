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

`seed.py` creates one demo company. Every demo account uses the password `password`, and has two-step sign-in turned on with the same authenticator key, `MECHANICPRODEMO2`. Add that key to an authenticator app on your phone (Google Authenticator, Microsoft Authenticator...: "enter a setup key", time-based) to get the codes; tick **Remember this device for 30 days** to be asked less often. A database seeded before two-step sign-in existed has no key: each account sets one up at its next sign-in.

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

**Service requests and booking.** A customer sends a request from their dashboard (**Request service**): the equipment, what's wrong and how urgent. Its page opens with the free times for an inspection, a day at a time; they pick one and **Book**. The visit becomes a job assigned to a free technician (the one with the fewest visits that day), and the customer, the managers and the technician are told. A request goes Submitted → Inspection booked → Inspected → Repair booked → Completed: completing the inspection job shares what was found and its photos with the customer and offers times for the repair; completing the repair completes the request. Until a visit starts, the customer can move it to another free time or cancel the request; a manager can set the repair's length after the inspection, decline or cancel the request, or move a request on by hand (an inspection done outside the app, say). Cancelling a visit that hasn't started sends the request back a step, and the customer picks a new time. Managers find requests on the dashboard and under **Service Requests**.

Which times are offered is set under **Settings → Online booking** (managers): the days and hours visits can start in (Monday to Friday, 08:00 to 17:00 by default), how long an inspection takes (2 hours) and a repair usually takes (4 hours), the travel time kept free before and after each visit of a technician (30 minutes), the notice needed (24 hours) and how far ahead customers can book (14 days). Times start on the hour from the opening time and must end by closing time. A time is free while a technician has no other booked visit within the travel time of it; a visit with no technician yet takes one technician. Jobs a manager plans with just a due date don't block times. Bookings for one company are made one at a time on PostgreSQL, so two customers can't take the last free technician at once. A visit has to fit in one working day: longer repairs are planned by a manager.

The technician taps **On my way** on a booked visit (it works offline too, and is dated when it was tapped); the customer sees "On the way since 08:40" on the request's page and gets an email. Technician locations are never shown to customers. Customers also get an email and a notification when a visit is booked or moved, when work starts (notification only), when the inspection findings are ready, when the repair is done, and when a visit or the request is cancelled or declined. The daily run (below) sends a reminder the day before each visit, a reminder to book the repair 3 days after an inspection, and a follow-up the day after the work is done. Emails link to the request's page (`#/requests/12`), which asks to sign in first if needed.

**Messages.** Customers and managers talk under **Messages**: quotes, prices and changes of plan go there, not in the app's records. A manager sees every customer's conversation (unread ones marked) and can start one with any customer; a customer sees their own, with the company. Technicians aren't in it. Each message notifies the other side in the app; a manager's message is also emailed to the customer, once until they've read it, so a run of messages sends one email. The screen checks for new messages every 15 seconds. In the demo data, Kenya Motors has a visit booked for an inspection of its pump (Amina), XYZ Factory's mixer has been inspected and is waiting for the repair to be booked, and XYZ Factory has an unread message for James.

**Equipment, sites and planned maintenance.** A customer's page (managers) lists their **Sites**, the places they have equipment, with an address and notes for the technicians. Equipment has a type (Generator, Pump, or anything typed), a manufacturer, a site, an install date and notes; a new job on equipment with a site gets the site as its location. Click a piece of equipment's name, anywhere it's listed, for its page: its details, maintenance plans, documents, faults, every job on it, photos from those jobs, and its service history. Managers see everything; a customer sees their own equipment's page (plans shown, not changed); a technician sees the page of equipment they have or had a job on, from the job's page, and can open only their own jobs from it.

Documents (PDF, Word, Excel, text or photos, up to `MAX_DOCUMENT_MB`, 25 MB by default) can be added by managers, the customer and technicians who can see the equipment. They count towards the company's storage, download rather than open (photos open), and can be removed by a manager or whoever added them.

A **maintenance plan** says what's done and how often: every N days, weeks or months from its next due date (months keep the day, or the month's last day: 31 January + 1 month is 28 February). When a plan comes within its lead time of the due date (7 days by default), the daily run creates its job (Pending, for a manager to assign, at the equipment's site) unless there is already one for that due date, and tells the managers and the customer by notification and email, once per due date. A manager can also **Create the job now**, or **Mark done** a service done outside the app. Completing a plan's job, or marking it done, moves the next due date on from the day it was done. Switching a plan off pauses it; removing it keeps the jobs it made. Plans due or overdue show on the equipment's card as a reason it needs work.

A **repeat fault** is equipment that needed fixing twice or more in 90 days: completed jobs that weren't routine maintenance (no plan, and "maintenance" isn't in the job type), with an inspection and a repair for the same request counted once, plus older service records with a problem written down. It's flagged on the equipment's card and its page, so a manager can look for the cause. In the demo data, ABC Engineering has two sites, the generator's oil change is due in four days, the compressor's half-year service is weeks away, and XYZ Factory's mixer has a repeat fault.

**Insights (managers).** **Reports** starts with the company's totals, then **Insights** for a range of days on the company's calendar: the last 7, 30 or 90 days, this month, or any range up to a year. Everything on it follows the range:

- **Jobs completed**, created and cancelled. A job counts on the day its history says it was completed, which for work done offline is when it really happened, not when it synced.
- **Time to complete**: the median time from a job's creation to its completion, what the customer waited. The Excel file also has the average, and the hours worked per job.
- **Hours per technician**: time clocked in and time on jobs (worksheet time), each counting only the part inside the range (a night shift across the first midnight counts from midnight), with jobs completed, their median time to complete and their rating from reviews left in the range. Open shifts and running timers count up to now.
- **Jobs completed each day** (each week, by the Monday it starts, for ranges over 31 days), and by job type. Every column shows its number on hover or focus, and **Show as a table** lists them.
- **Repeat faults**: equipment fixed twice or more in the 90 days up to the range's last day (see Equipment above).

**Excel** downloads a workbook with a sheet each for the summary, the technicians, every completed job (customer, equipment, technician, created and completed times, hours), completed jobs over time, job types and repeat faults. **PDF** is the same page for sending on. Both are in the manager's own language with times on the company's clock, and each download is noted in **Activity**.

**Margin** (on Insights, and in both downloads): what the completed jobs in the range were charged, less what they cost. Jobs with nothing charged yet don't count towards it, and the tile says how many jobs are missing a pay rate or a part cost (their cost leaves those out).

**Team Map** asks for positions every 15 seconds while it's open. A position older than 15 minutes is faded: the technician's phone has stopped sending (the app is closed, or there's no signal).

**Long lists.** Jobs, service requests, service records, reviews and notifications load 25 at a time, newest first, with **Previous** and **Next**. Their search runs on the server, over the whole list (a job is also found by its customer's or equipment's name). Customers, technicians and equipment load whole and show 25 (or 10 customers' equipment) a page. A technician's own jobs load whole, because their phone keeps them for working offline. For the API: `GET /api/jobs?page=2&per_page=25&q=pump` returns `jobs` with `page`, `per_page`, `total` and `pages`; without `page`, the whole list comes back as before.

**A technician's phone.** On a phone, technicians get a bar along the bottom (**Today**, **Jobs**, **Shifts**, **Alerts**, and **More** for everything else) instead of the sidebar; managers and customers keep the sidebar. The dashboard opens with **Today's jobs**: the job in progress (**Open**), paused jobs (**Resume**), then jobs due today or overdue (**Start work**). In the demo data, Mitch's generator job is in progress and Brian's mixer job is paused.

**Clock in and location.** Technicians must clock in before they can start or resume a job, and clocking out pauses any job in progress. The first time they clock in, they are asked to agree to location sharing. Clocking in needs a position; clocking out never does. While clocked in, a **Location on** sign is shown. A position is recorded at clock-in and clock-out, when a job starts, resumes or completes, and every few minutes while a job is in progress and the app is open. Nothing is recorded while clocked out. Phones stop sending positions when the app is in the background; only a native app could track in the background. Managers see clocked-in technicians under **Team Map**, and hours under **Shifts**, where they can set the clock-out time of a forgotten shift. In the demo data, Mitch and Amina are clocked in, and Brian is clocked out and hasn't agreed yet.

**Photos, videos and sign-off.** While a job is in progress or paused, the technician adds before, after and other photos and short videos on the job's page. Photos are shrunk on the phone to 1600 px (as JPEG) before upload. Videos can be up to 60 seconds and 50 MB; the length is checked on the phone and the size on the server. **Complete job** opens a sign-off pad: the customer types their name and signs with a finger, or the technician ticks **Customer not present** and says why. Either way it is recorded in the job's history. A completed job's page has **Share report** and **Download PDF** for the customer's report: the work done, parts, checklist, photos and signature, without hours. In the demo data, the conveyor inspection was signed by Grace Wanjiru. Locally, files are saved in `backend/instance/uploads`.

**Language, time zone and dark mode.** The app is in English (left to right) unless someone picks another language; today that's Kiswahili. Every signed-in screen has a language button in the top corner (**EN** / **SW**), and **Settings** has the same choice. It belongs to the account, so the screens, the emails and the notifications a person receives all use it, and it follows them to any device. The sign-in, sign-up and home pages have a small language picker too, remembered on that device.

On a first visit the app is in English, unless the phone or browser is set to Kiswahili (no location is looked up). If the device's clock is set to an East African time zone (Kenya, Tanzania, Uganda, Rwanda), a small card offers Kiswahili once; **Keep English** or **Tumia Kiswahili** and it isn't shown again on that device.

Managers set the company's **language** under **Settings**: invitations are written in it, and people who join start in it unless they picked a language on the join page. Everyone can still choose their own. A new company starts in the language its owner signed up in. Managers also set the **time zone** (every time in the app and on PDF reports is shown in it), **currency** and **units** (metric or imperial; used for location accuracy today). **Appearance** (light, dark or the device's setting) is kept per device and is light by default.

To change or add wording, wrap the English in `t("...")` (or `mark("...")` for lists) in the frontend, and `_("...")` (or `N_("...")`) in the backend; the checks below list any text without Kiswahili, which goes in `frontend/src/i18n/sw.ts` and `backend/app/i18n/sw.py`. Every form field uses `frontend/src/components/Field.tsx`, which ties the visible label, hint and error to the input for screen readers. What the API sends back is typed in `frontend/src/services/types.ts`; the `any` type isn't allowed (`npm run types:check`).

**Right-to-left languages.** None is offered yet, but the screens are ready: stylesheets use logical sides (`margin-inline-start`, `inset-inline-end`, `text-align: start`...) instead of left and right, so a language added with `rtl: true` in `frontend/src/i18n/index.ts` and `backend/app/i18n/__init__.py` mirrors the whole layout, arrows included. `npm run rtl:check` fails on a physical left or right; one that must stay (centring with `left: 50%`) says why in a `/* physical: ... */` comment on the same line. Sideways movement (`translateX`) is multiplied by `var(--inline-direction)`, which is -1 right to left.

**Kiswahili review (you do).** The Kiswahili was drafted without a native speaker; have one review it before launch. From `backend/`, `python -m app.i18n.review export kiswahili-review.csv` writes every text (app screens and server messages and emails) to one spreadsheet: where it shows, the English, the Kiswahili now, and empty **Better Kiswahili** and **Notes** columns. It opens in Excel or Google Sheets. The reviewer fills in **Better Kiswahili** only where the wording should change, keeping every `{placeholder}` as it is. Then `python -m app.i18n.review import kiswahili-review.csv` writes those changes into both files; it changes nothing if a row drops or adds a placeholder, or names a text that no longer exists, and says which rows to fix. Check the result with `git diff` and the two i18n checks below. The words "Technician", "Equipment" and "Site" are only on screen: the database and API still say mechanic, machine and location. Dark mode needs no extra CSS: write colours as usual and `frontend/scripts/dark-colors.mjs` gives each a dark partner at build time (mark a rule `/* light-only */` to keep it light, as the signature paper is). The look of the signed-in app (type, colours, cards, status pills, motion) is one layer, `frontend/src/styles/bold.css`, loaded after the page stylesheets: pages keep their layout CSS, and colour and type changes go in that file. The fonts (Inter and Plus Jakarta Sans) are bundled with the app, not loaded from Google.

**Testing location on a real phone.** Phones only share location with secure (https) pages. With the backend running, start the frontend with `npm run dev:phone` instead of `npm run dev`. Then open the `https://<your computer's IP>:5173` address it prints, on a phone on the same Wi-Fi. The certificate is self-signed, so the phone warns once: choose to continue. Also try it with location blocked for the site, and outdoors.

**Forgot password?** on the sign-in page emails a link to choose a new password. It works once, for 1 hour, and opening it also confirms the email address. The answer on screen is the same whether or not the address has an account. For someone who can't get to their email, the manager can still click **Reset password** next to them under **Technicians** or **Customers**; the person enters that one-time code under **Forgot password? → Have a reset code from your manager?** It expires after 24 hours. Anyone can change their own password under **Settings**. Changing or resetting a password signs that account out everywhere else.

**Two-step sign-in.** Everyone signs in with their password and a 6-digit code from an authenticator app on their phone. Anyone without it set up (new managers, people who just joined) is taken to a setup screen before anything else: scan the QR code (or type the key), confirm a code, and save the 10 backup codes shown once, each usable one time instead of a code. **Remember this device for 30 days** skips the code on that browser; changing or resetting the password forgets every remembered device. Under **Settings** people see whether it's on and how many backup codes are left, make new backup codes (asks for the password), or set it up on a new phone. A manager can **Reset two-step sign-in** next to a technician or customer who lost their phone and backup codes; the person is signed out and sets it up again at their next sign-in. A manager who lost both is reset from the server with `flask --app run.py reset-2fa their@email`. "Try the demo" copies don't ask for it. Outside production it can be turned off with `TWO_FACTOR_REQUIRED=0`; in production it's always on.

**Lockout.** Five wrong passwords or codes in a row lock the account for 15 minutes, and its owner gets an email saying so. A right password and code resets the count.

**Activity log.** Managers see **Activity** in the sidebar: sign-ins, wrong attempts and lockouts, password and two-step sign-in changes, invitations, people joining and being removed, deleted jobs, customers and equipment, plan payments, exports and deletion requests, with who, when and from which IP address. Entries are kept for 12 months.

**Export your data.** Under **Settings**, a manager downloads everything the company has (after typing their password) as a ZIP: a CSV per kind of record (opens in Excel or Google Sheets), the same as one `data.json`, and a `files.csv` listing every photo, video and signature with a download link that works for 7 days. The files aren't inside the ZIP, as a company can have up to 100 GB. Passwords, two-step keys and backup codes are never exported. Three exports an hour per company (`EXPORT_RATE_LIMIT`).

**Deleting a company.** Under **Settings → Delete your company**, a manager types the company's name and their password. Everyone is signed out at once, a banner shows the deletion date to anyone who signs in, and any manager can **Cancel the deletion** for 30 days. After that, the daily clean-up deletes the company, its people and every file. Demo companies can't be deleted this way (they delete themselves).

**Privacy policy and terms.** `#/privacy` and `#/terms` show `backend/legal/privacy.md` and `backend/legal/terms.md`, linked from the homepage footer. **Both are placeholder text: replace them with your own before launch.** The first line of each is `Version: ...`; change it whenever the text changes. Signing up and joining a company need an **I agree** tick, and the version agreed to and when are saved on the account.

**Emails while developing.** In development nothing is sent: each email is written to the backend's log (look for `Email not sent (EMAIL_BACKEND=log)`), links included. Open the link from there to confirm an email or reset a password. See [Email](#email) for sending real emails.

## Routes and job costing

**Pins.** Routes need to know where things are. A manager puts the company's base (yard or office) on a map under **Settings**, and each customer site on the customer's page: click or tap the map, drag the pin, use the device's location, or type the coordinates. A job is where its equipment's site is.

**Planning a day (managers).** **Routes**, then a technician and a day. The plan takes that technician's unfinished jobs due on or before the day (or with no due date, or already under way) whose site has a pin. Visits with a booked time keep their times and are listed apart; jobs whose site has no pin are listed under **Not on the map**. The order: the nearest stop first, then any stretch of the route reversed while that shortens it (2-opt), which for a day's handful of stops is at or near the best. The day starts where the technician was last seen (clocked in, with a position from the last 2 hours), else at the base, else at the first stop, and ends at the last stop. The page shows the stops numbered on a map, each leg's distance and time, and what the order saves against the order the jobs are in now. **Use this order** saves it: the technician gets a notification, their Today's jobs follow it with **Stop 1**, **Stop 2**…, and **Today's route in Maps** opens the stops in order in Google Maps (the first 10: map apps take no more in one link). Every job's page has **Directions** to its site.

**Drive times.** With `ROUTING_API_KEY` set (a free key from [openrouteservice.org](https://openrouteservice.org/dev/#/signup): 500 route matrices a day), distances and times are real driving ones. Without a key, distances are straight lines × 1.3 driven at `ROUTE_AVERAGE_KMH` (25 km/h, city traffic): good enough to order the stops, but the times are rough and the page says so. If the service fails or is slow (8 seconds), the plan falls back to straight lines and says that too.

**Job costing (managers).** On the **Technicians** page, **Pay rate** sets what an hour of each technician's time costs the company. On a job's page, **Costs and margin** lists each technician's time on the job (from the worksheet) × their pay rate, each part × its unit cost (typed there), the total, what the customer was charged, and the margin. Anything without a rate or a cost is left out of the total and listed, so a gap never looks free. Amounts are in the company's currency (KSh), typed like `1500` or `1500.50`. Technicians and customers never see costs, rates or margins. The Excel download of **Insights** has each completed job's labour, parts, charged and margin columns.

In the demo data, routes start from DK Engineering's workshop in Industrial Area, every site has a pin, Mitch has the generator job under way and the compressor job due today, and the technicians' pay rates are KSh 600, 650 and 550 an hour. The conveyor inspection was charged KSh 12,000 and the mixer inspection KSh 6,500; the generator's thermostat has no cost yet.

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

# No `any` types, and stylesheets that mirror for right-to-left languages (from frontend/)
npm run types:check
npm run rtl:check

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
| `MAX_DOCUMENT_MB` | `25` | Largest equipment document (manual, certificate) accepted |
| `MAX_VIDEO_SECONDS` | `60` | Longest video the phone will upload |
| `BILLING_PROVIDER` | `test` | Leave unset: `none` (free trials only). `test` is refused in production; `paystack` takes test keys only. See [Plans and payments](#plans-and-payments) |
| `PAYSTACK_SECRET_KEY` | | With `paystack`: the **test** secret key (`sk_test_...`) from the Paystack dashboard |
| `APP_URL` | the first `CORS_ORIGINS` entry | **Required**: your site's `https://` address. Links in emails point here |
| `EMAIL_BACKEND` | `log` (emails are written to the log) | `smtp` (the default, and required). See [Email](#email) |
| `EMAIL_FROM` | `MechanicPro <no-reply@mechanicpro.test>` | **Required**, e.g. `MechanicPro <no-reply@yourdomain.com>`, on a domain your provider has verified |
| `SMTP_HOST` / `SMTP_PORT` | / `587` | **Required** host; port from your provider |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | | From your provider (often an API key as the password) |
| `SMTP_SECURITY` | `starttls` | `starttls` (port 587), `ssl` (port 465) or `none` |
| `EMAIL_RATE_LIMIT` | `1 per minute;5 per hour` | Verification and password-reset emails to one address |
| `DEMO_RATE_LIMIT` | `10 per hour` | "Try the demo" copies one IP address can start |
| `CRON_SECRET` | | A long random value that turns on `/api/cron/daily` for a scheduler. See [Daily clean-up](#daily-clean-up) |
| `TWO_FACTOR_REQUIRED` | on | `0` turns two-step sign-in off outside production. Always on in production |
| `EXPORT_RATE_LIMIT` | `3 per hour` | "Export your data" downloads per company |
| `ROUTING_API_KEY` | | Optional. An OpenRouteService key for real drive times in route plans; without it, straight-line estimates. See [Routes and job costing](#routes-and-job-costing) |
| `ROUTING_PROVIDER` | `openrouteservice` | The routing service (the only one for now) |
| `ROUTE_AVERAGE_KMH` | `25` | The speed straight-line estimates assume |

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

Once a day, six things should be cleared away: demo companies whose 24 hours are up, uploads that were started but never finished, live positions older than 30 days, activity-log entries older than 12 months, the IDs of changes sent from phones' offline queues more than 30 days ago, and companies whose 30 days after a deletion request are up (with all their files). The same run sends the booking reminders: for visits today or tomorrow (in the company's time zone) not reminded yet, for repairs not booked 3 days after the inspection, and the follow-up a day after the work is done. It also creates the jobs for maintenance plans coming due, with their reminders, and renews paid plans ending within a day with the saved card (see [Plans and payments](#plans-and-payments)), with reminders of trials and cancelled plans ending soon. Each is sent once. Either:

- call `GET /api/cron/daily` with the header `Authorization: Bearer <CRON_SECRET>` from your host's scheduler (Vercel Cron sends exactly this header when `CRON_SECRET` is set), or
- run `flask --app run.py purge-demos`, `purge-uploads`, `purge-locations`, `purge-activity`, `purge-sync-requests`, `delete-due-companies`, `send-reminders`, `send-service-due` and `renew-plans` from cron.

Run it in the morning, company time, so "tomorrow's visit" reminders arrive the day before.

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

The homepage (`/`) shows the plans; **Get started** (or **Choose** on a plan) creates a new company with its owner as the manager. Plans, prices and what each plan includes are set in `backend/app/services/plans.py`, in Kenyan shillings; the homepage, signup, Billing and checkout all read them from there:

| Plan | Monthly | Yearly | Technicians | Storage | Also includes |
| --- | --- | --- | --- | --- | --- |
| Starter | KSh 1,500 | KSh 15,000 | 3 | 2 GB | Everything else in the app |
| Professional | KSh 4,500 | KSh 45,000 | 10 | 20 GB | Insights and exports; planned maintenance and reminders |
| Business | KSh 12,000 | KSh 120,000 | 30 | 100 GB | Also route planning; job costing and margins |

**Extra technicians**, on any plan, are KSh 500 a month each (KSh 5,000 a year), chosen on Billing before paying. Yearly billing charges ten months (two months free).

**What every plan includes**: jobs, worksheets (time, parts, checklists, notes), equipment and customers, photos, videos, the customer's sign-off and PDF reports, clock-in and the team map, customer requests with booking and chat, offline mode, two languages, and everything in Settings.

**Features a plan doesn't include** are locked for that company: the API refuses them (403, saying which plan has it), the sidebar shows a lock, and the page shows what it is with a **See plans** button. Nothing already made is lost by moving to a smaller plan: existing maintenance plans stay listed but stop creating jobs; costs, pay rates and planned routes stay saved, out of view. A smaller plan must still fit the team (technicians plus open invitations) and the files, or checkout says what to change. Companies created before plans existed have no limits and every feature.

**Trials.** Every new company starts with a 14-day free trial of the plan it chose; no card is needed. Managers see the days left in a banner on every page, and get a reminder (in the app and by email) three days before it ends.

**Renewals.** Paying saves the card or wallet with the payment provider (the app stores only the provider's token and "Visa •••• 4081"). A day before a paid period ends, the daily run (`flask --app run.py renew-plans`, or `/api/cron/daily`) charges it for the next period and emails a receipt. If the charge is declined, it's retried once a day (three tries in all), and the managers get a notification and an email. With no saved card, they're asked to pay under **Billing**.

**When payment fails or a plan is cancelled.** After an unpaid period ends, everything keeps working for 7 more days (the banner says until when). After that the company is limited like an ended trial: work in progress carries on (technicians finish jobs, customers sign), but creating jobs and inviting people waits until a plan is paid. Nothing is deleted. **Cancel renewal** on Billing stops renewals; the plan then ends with its paid period, without the 7 days. **Turn renewal back on** undoes it before then.

### Payment providers

Payment goes through a provider set by `BILLING_PROVIDER`, behind one interface in `backend/app/services/billing.py` (start a checkout, charge the saved card, confirm a checkout, read webhooks). Whatever a provider reports becomes a "paid", "failed", "cancelled" or "plan changed" event, handled the same way for every provider, and each webhook event counts once however often it's resent.

- **`test`** (the default in development) shows the app's own checkout page with test cards: one that pays, **Try a declined card**, and **Pay with a card that will decline at renewal**. On Billing, **Renew now (test)** charges the saved test card straight away, to try a renewal (or a failed one) without waiting a month. No real money is taken, and the server refuses to start with it in production.
- **`paystack`**: [Paystack](https://paystack.com), for cards and M-Pesa in Kenyan shillings. **Test keys only**: the server refuses to start with a live key (`sk_live_...`) until live payments are deliberately switched on.
- **`none`** (the default in production) turns online payment off, so companies can only start free trials.

To try Paystack in test mode:

1. Create a Paystack account. Test mode works at once; live payments need Paystack to approve your business, so check that it accepts businesses in your country (it lists Kenya among its countries).
2. In the Paystack dashboard, **Settings → API Keys & Webhooks**: copy the **test secret key** into `PAYSTACK_SECRET_KEY`, and set `BILLING_PROVIDER=paystack`.
3. Set the **test webhook URL** to `https://<your API>/api/billing/webhooks/paystack`. Paystack signs each webhook with your secret key; the app refuses any that isn't signed. Locally, Paystack can't reach `localhost`: payments still complete when the manager comes back from Paystack's page (the app asks Paystack how it went), but renewals declined after the fact need the webhook.
4. Pay from **Billing** with one of Paystack's [test cards](https://paystack.com/docs/payments/test-payments/) or test mobile money numbers.

Before switching to live payments: confirm Paystack (or another provider) accepts your business, agree the fees, and **ask an accountant about VAT and receipts** for selling subscriptions in Kenya. The app's receipts are payment confirmations, not tax invoices. Another provider (Flutterwave, Paddle, Lemon Squeezy...) plugs in by implementing the same four methods.

To try it locally with the test provider: open http://localhost:5173, choose a plan, and sign up with a new email. **Pay now and skip the trial** goes to the test checkout; **Try a declined card** shows what happens when a card fails.

## Offline mode and the installable app

Technicians can do their whole day with no signal; managers' and customers' screens stay online only and say "You're offline" when there's no connection.

**What works offline:** clocking in and out (with location sharing agreed), starting, pausing, resuming and completing jobs (with the customer's signature), time entries, parts, checklist ticks, the service summary, notes, photos and videos, and the position stamps that go with them.

**How it works:**

- While online, the technician's job list and the worksheet of every job assigned to them are kept on the phone, in a database of their own (IndexedDB) that is deleted when they sign out. Offline, screens show that copy with "Offline · last updated 10:42".
- Every change goes into a queue on the phone and shows at once, marked "waiting to sync". Online it's sent straight away; offline it waits. Changes are sent one at a time, oldest first, when the signal returns, when the app opens, and every 30 seconds while any are waiting. On Android, Chrome can also send them with the app closed (Background Sync); iPhones can't.
- Each change carries its own ID (`Idempotency-Key`) and the time it was made (`X-Client-Time`), corrected for a phone whose clock is wrong (measured against the server's clock while online). The server saves a change once however often it arrives, records the time it happened, and refuses times in the future (5 minutes of drift allowed) or older than 30 days. History lines made offline say "Done offline at 10:42, synced at 13:05".
- Photos and videos are shrunk and kept on the phone, then uploaded on a good connection (online, not 2G, data saver off; iPhones: whenever online), retrying with longer and longer waits, up to 15 minutes apart. The app asks the browser to keep its storage, and warns when the phone is nearly out of space.
- The sync sign shows "All synced", "Offline · 3 waiting", "Syncing 2 of 5…" or "1 needs attention". Tapping it lists what's waiting; a change the server refused shows why, with **Discard** (and, for a photo or video, **Save to phone** first).
- Signing out with changes waiting asks first ("3 changes haven't synced", **Sign out anyway**). If the session runs out while offline, the changes wait and are sent when the same person signs in again, never under someone else.

**When the job changed meanwhile:**

| What happened | Result |
| --- | --- |
| The job was reassigned or cancelled | Work from before (time, photos, notes, parts, ticks) is kept; anything after it, and any start, pause or completion, is refused with what happened ("Reassigned to Amina at 11:05"). |
| The same item was changed in two places (summary, time entry, tick) | The most recent change, by when it was made, wins; the other version goes into the job's history. |
| A part was removed twice | Adds are always kept; removing a part that's already gone does nothing. |
| Clocked in or out on another phone too | Treated as already done. |
| A status change or clock-in dated before the job's or shift's last update | Refused: it would be out of order. |
| Completing was refused | The list says exactly what's missing. |

**Limits:** iPhones delete the data of sites that haven't been opened for 7 days, unless the app was added to the Home Screen; a phone whose clock is changed while it's offline can shift the times of its changes; the first sign-in (with its two-step code), the team map and its tiles, and photos already on the server need a connection.

**The installable app:** a production build (`npm run build`) adds the web app manifest, icons and a service worker (`src/sw.ts`) that keeps the app's own files so it opens with no signal. It never keeps API data. Android shows an **Install app** button on the technician's dashboard; iPhones show the steps (Share, then Add to Home Screen). When a new version is deployed, a bar offers **Reload**; nothing reloads on its own, so nobody loses a half-filled form.

To try it on a computer: `npm run build && npm run preview` (with the backend running), open http://localhost:4173 in Chrome, sign in as a technician, then turn the network off in DevTools (Network → Offline) and keep working. The development server (`npm run dev`) has offline mode too, but no service worker, so it can't be reloaded while offline.

## Production notes (until the deployment guide is written)

- Run `flask --app run.py db upgrade` on every deploy. Never run `seed.py`.
- Run the [daily clean-up](#daily-clean-up): it is also what finally deletes companies whose owners asked for it.
- Replace the placeholder `backend/legal/privacy.md` and `backend/legal/terms.md` with your own, reviewed text.
- `SECRET_KEY` also encrypts the two-step sign-in keys. Changing it makes every authenticator app's codes stop working (backup codes still do, and people can then set up their phone again under **Settings**, or be reset), so keep it stable.
- Set up [email](#email) before launch: the app won't start in production without it.
- Use `STORAGE_BACKEND=s3` unless the app runs on one server with a lasting disk.
- Map tiles come from the free OpenStreetMap servers, which are not meant for heavy commercial use. Switch to a paid tile provider before launch.
- Serve the backend with a production WSGI server (for example gunicorn), not `flask run`.
- Build the frontend with `npm run build` and serve `frontend/dist/` as static files. Serve `sw.js` and `index.html` without long caching, so phones find new versions.
- Serve the frontend and the API from the same site over HTTPS (for example `app.example.com` with the API at `/api`). Sessions are httpOnly, `Secure` cookies with CSRF protection, so browsers won't send them to a different site.
- Behind a load balancer, set `TRUSTED_PROXY_COUNT` so rate limiting sees real client IPs.
- Never commit `.env` files; set the variables in your host's settings.
