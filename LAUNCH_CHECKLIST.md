# Launch checklist

Everything to do before MechanicPro takes real customers. The steps are in [SETUP.md](SETUP.md); this list only makes sure none is missed. Tick each one in a copy of this file, or in an issue.

## Running

- [ ] Deployed from `render.yaml` (or another host with the same settings), and `/api/health` answers `"status": "ok"` with the deployed commit as `version`.
- [ ] **Try the demo** works on the live site, as a manager, a technician and a customer.
- [ ] The daily run works: **mechanicpro-daily → Trigger Run** succeeds, and its log lists every part (`demo_companies`, `reminders`, `maintenance`, `billing`, `deleted_companies`...) with no `failed` entry. A failed part makes the run fail, so turn on Render's failure emails for the cron job.
- [ ] `APP_ENV=production` (not `staging`), and the app starts with it, which means the secrets, `APP_URL` and email are set properly.
- [ ] `SECRET_KEY` and `JWT_SECRET_KEY` are the generated values, kept somewhere safe outside Render (a password manager). `SECRET_KEY` must never change: it encrypts the two-step sign-in keys.
- [ ] `seed.py` has never been run on the live database (it has a known demo password).

## Domain and email

- [ ] Your domain points at the app (Render: **Custom Domains**), with its `https` certificate issued.
- [ ] `APP_URL` is `https://` + your domain, on the app **and** on the daily run.
- [ ] Your email provider has verified the domain (SPF and DKIM records added), and `EMAIL_FROM` is on it.
- [ ] Sign up a test company with a real address: the confirmation email arrives (not in spam) and its link opens your domain. Try a password reset and an invitation too.

## Payments

- [ ] The payment provider accepts your business, the fees are agreed, and test payments work end to end, including the webhook (SETUP.md, Payment providers).
- [ ] An accountant has confirmed VAT, receipts and invoices for selling subscriptions in Kenya.
- [ ] Live payments switched on deliberately (the code refuses live keys until then), and one real payment made and refunded.
- [ ] Prices in `backend/app/services/plans.py` are the ones you mean to charge.

## Legal and data

- [ ] `backend/legal/privacy.md` and `backend/legal/terms.md` replaced with your own text, reviewed by a lawyer, with the `Version:` line at the top changed, so people who signed up earlier are asked to agree to the new text.
- [ ] You know how you'll answer a request to export or delete a company's data (the app does both, under **Settings**: **Export your data** and **Delete your company**).
- [ ] Registered with the Office of the Data Protection Commissioner, if the Kenya Data Protection Act requires it for your business (it does for most businesses handling customers' personal data at scale; check with the lawyer).

## Backups and monitoring

- [ ] The backup secrets are set, and **Actions → Backup** and **Restore test** both pass (SETUP.md, Backups and the restore test).
- [ ] You've restored a backup once yourself, into a scratch database, and opened the app against it.
- [ ] Error reports go somewhere you'll see them: `SENTRY_DSN` set, with Sentry's emails on.
- [ ] An uptime monitor checks `https://<your domain>/api/health` and alerts you.
- [ ] Render's billing alerts are on, and the plan sizes (app, database, disk) fit the expected use.

## Files and maps

- [ ] Uploads: the 5 GB disk is enough for now, or `STORAGE_BACKEND=s3` with a private bucket and its CORS rule (SETUP.md, File storage). Required before running more than one copy of the app.
- [ ] Map tiles from a paid provider (or an agreement with one): the free OpenStreetMap servers don't allow heavy commercial use.
- [ ] Optional: `ROUTING_API_KEY` for real drive times in route plans.

## Security

- [ ] Two-step sign-in works for every role on a real phone, and the backup codes were tested.
- [ ] Nobody shares the Render, GitHub, email-provider or payment-provider accounts' passwords; each has two-step sign-in on.
- [ ] Only the people who need it can deploy (GitHub repository access and Render workspace members).
- [ ] `.env` files were never committed (`git log --all -- '*.env'` shows nothing).

## Languages

- [ ] A native Kiswahili speaker has reviewed the Kiswahili (SETUP.md, Kiswahili review): it was drafted without one.

## People

- [ ] A support email address, shown on the site, that someone reads.
- [ ] The first customers know how to reach you, and you know what you'll do if the app is down (Render status page, the rollback steps in SETUP.md).
