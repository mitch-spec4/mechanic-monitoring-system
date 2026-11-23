# MechanicPro — POST-PULL CONFIRMATION CHECKLIST

## How to use this file

Run this AFTER Claude finishes the work from PULL.md.

Do not accept "done" as the answer.

For every section below, Claude must provide:
- PASS
- FAIL
- BLOCKED
- NOT APPLICABLE

For every PASS, provide evidence:
- test command;
- test result;
- file/route;
- configuration;
- screenshot if useful;
- commit or change reference where appropriate.

If something cannot be verified, it is NOT a PASS.

---

# A. CODEBASE INTEGRITY

- [ ] Build succeeds.
- [ ] Backend starts successfully.
- [ ] Frontend starts successfully.
- [ ] Production build succeeds.
- [ ] No unexplained build warnings.
- [ ] No unexplained runtime errors.
- [ ] No broken imports.
- [ ] No dead critical code.
- [ ] No accidental duplicate implementations.
- [ ] No unfinished critical TODO/FIXME.
- [ ] No development-only routes exposed.
- [ ] No debug mode in production.
- [ ] No localhost production URLs.
- [ ] No test credentials.
- [ ] No placeholder legal content remaining.
- [ ] No fake business claims.
- [ ] No fake testimonials/reviews/customers.

---

# B. SECRETS

- [ ] No secrets in source.
- [ ] No secrets in frontend bundle.
- [ ] No secrets in documentation.
- [ ] No secrets in logs.
- [ ] No secrets in tests.
- [ ] No secrets in Docker image.
- [ ] .env files are ignored.
- [ ] .env.example has placeholders only.
- [ ] Git history checked for leaked .env/secrets.
- [ ] Any previously exposed secret has a rotation plan.
- [ ] Production credentials are stored outside Git.

---

# C. AUTHENTICATION

- [ ] Password hashing verified.
- [ ] Password reset verified.
- [ ] Email verification verified.
- [ ] JWT expiration verified.
- [ ] Invalid JWT rejected.
- [ ] Expired JWT rejected.
- [ ] Tampered JWT rejected.
- [ ] Wrong JWT algorithm rejected.
- [ ] Logout/session invalidation verified.
- [ ] Brute-force protection verified.
- [ ] Account lockout verified.
- [ ] 2FA verified.
- [ ] Backup codes verified.
- [ ] Remember-device behavior verified.
- [ ] Sensitive authentication events logged safely.
- [ ] Passwords/tokens never logged.

---

# D. AUTHORIZATION

- [ ] Manager permissions verified.
- [ ] Technician permissions verified.
- [ ] Customer permissions verified.
- [ ] Admin permissions verified if applicable.
- [ ] Frontend-only role checks are not trusted.
- [ ] Backend role checks verified.
- [ ] IDOR/BOLA tests pass.
- [ ] Cross-company tests pass.
- [ ] Resource ownership checks pass.
- [ ] Unauthorized IDs return safe failure.
- [ ] Privilege escalation tests fail safely.

---

# E. COMPANY DATA ISOLATION

Create at least two companies.

Verify:
- [ ] Company A cannot read Company B.
- [ ] Company A cannot modify Company B.
- [ ] Company A cannot delete Company B.
- [ ] Company A cannot access Company B documents.
- [ ] Company A cannot access Company B jobs.
- [ ] Company A cannot access Company B equipment.
- [ ] Company A cannot access Company B customers.
- [ ] Company A cannot access Company B messages.
- [ ] Company A cannot access Company B reports.
- [ ] Company A cannot access Company B service history.
- [ ] Changing IDs does not bypass isolation.

---

# F. API

- [ ] Every sensitive route requires authentication.
- [ ] Every sensitive route requires authorization.
- [ ] Input validation works.
- [ ] Output does not leak sensitive fields.
- [ ] SQL injection tests pass.
- [ ] XSS tests pass.
- [ ] Path traversal tests pass.
- [ ] SSRF tests pass where relevant.
- [ ] Oversized request tests pass.
- [ ] Malformed JSON tests pass.
- [ ] Safe production errors verified.
- [ ] Rate limiting verified.
- [ ] Pagination limits verified.
- [ ] Query limits verified.
- [ ] Timeouts verified.

---

# G. DATABASE

- [ ] ORM/SQL is parameterized.
- [ ] Production database credentials are protected.
- [ ] Database is not unnecessarily public.
- [ ] Migrations work on a clean database.
- [ ] Migrations work on an existing database.
- [ ] Destructive migrations reviewed.
- [ ] Foreign keys verified.
- [ ] Constraints verified.
- [ ] Indexes reviewed.
- [ ] Cascading deletes reviewed.
- [ ] Transactions verified.
- [ ] Concurrent writes tested.
- [ ] Duplicate submissions handled.

---

# H. FILES

Test:
- [ ] Valid image upload.
- [ ] Invalid image upload.
- [ ] Oversized image.
- [ ] Malicious filename.
- [ ] Path traversal filename.
- [ ] Unsupported extension.
- [ ] Fake MIME type.
- [ ] Oversized video.
- [ ] Unauthorized document access.
- [ ] Cross-company document access.
- [ ] Safe file names.
- [ ] Private files are not publicly exposed accidentally.

---

# I. PAYMENTS

If payments are not launching yet:
- [ ] Live billing remains disabled.
- [ ] Test credentials cannot accidentally activate live billing.
- [ ] No payment secrets exposed.
- [ ] No accidental paid provider calls.

If payments are launching:
- [ ] Business/provider approval.
- [ ] Live keys configured securely.
- [ ] Webhook signature verified.
- [ ] Replay protection verified.
- [ ] Duplicate webhook handling verified.
- [ ] Successful payment verified.
- [ ] Failed payment verified.
- [ ] Renewal verified.
- [ ] Failed renewal verified.
- [ ] Grace period verified.
- [ ] Refund verified.
- [ ] Subscription state verified.
- [ ] Frontend cannot manipulate price.
- [ ] Frontend cannot grant paid access.
- [ ] One real payment tested.
- [ ] One real refund tested.
- [ ] VAT/tax/invoice treatment confirmed.

---

# J. COST SAFETY

List every billable provider and verify:
- [ ] Rate limit.
- [ ] Quota.
- [ ] Authentication.
- [ ] Abuse protection.
- [ ] Maximum request size.
- [ ] Timeout.
- [ ] Concurrency limit.
- [ ] Provider spending alert.
- [ ] Emergency shutdown procedure.

Confirm:
- [ ] No paid service was activated accidentally.
- [ ] No subscription was upgraded accidentally.
- [ ] No billing method was changed.
- [ ] No unexpected recurring service exists.
- [ ] Render billing alerts enabled.
- [ ] External API usage is monitored.

---

# K. FRONTEND

- [ ] Production build works.
- [ ] No exposed secrets.
- [ ] No unsafe HTML.
- [ ] No unsafe redirects.
- [ ] No sensitive data in URLs.
- [ ] API errors handled.
- [ ] Loading states work.
- [ ] Empty states work.
- [ ] Error states work.
- [ ] Disabled states work.
- [ ] Double-submit prevention works.
- [ ] Destructive confirmations work.

---

# L. UX

Check every major page:
- [ ] Dashboard
- [ ] Login
- [ ] Registration
- [ ] Password reset
- [ ] Manager workspace
- [ ] Technician workspace
- [ ] Customer workspace
- [ ] Jobs
- [ ] Equipment
- [ ] Service history
- [ ] Requests
- [ ] Booking
- [ ] Chat
- [ ] Reports
- [ ] Forms
- [ ] Certificates
- [ ] Settings
- [ ] Notifications
- [ ] Subscription/billing

Each must have sensible:
- loading;
- success;
- empty;
- error;
- disabled;
- responsive states.

---

# M. MOBILE AND OFFLINE

Test actual Android:
- [ ] Login.
- [ ] PWA installation.
- [ ] Camera.
- [ ] Location.
- [ ] Clock in.
- [ ] Start job.
- [ ] Pause.
- [ ] Resume.
- [ ] Parts.
- [ ] Checklist.
- [ ] Notes.
- [ ] Photos.
- [ ] Video.
- [ ] Signature.
- [ ] Complete.
- [ ] Offline.
- [ ] Reconnect.
- [ ] Sync.
- [ ] Duplicate prevention.
- [ ] Conflict handling.

Test actual iPhone:
- [ ] Safari.
- [ ] PWA.
- [ ] Camera.
- [ ] Location.
- [ ] Signature.
- [ ] Offline/reconnect.
- [ ] Notifications where supported.

---

# N. ACCESSIBILITY

- [ ] Keyboard navigation.
- [ ] Focus states.
- [ ] Labels.
- [ ] Contrast.
- [ ] Semantic HTML.
- [ ] Screen-reader labels.
- [ ] Touch targets.
- [ ] Accessible errors.

---

# O. ORIGINALITY

Claude must explicitly identify:
- [ ] Generic dashboard patterns removed.
- [ ] Generic AI-style copy removed.
- [ ] Fake data removed from production flows.
- [ ] Fake testimonials removed.
- [ ] Fake reviews removed.
- [ ] Fake metrics removed.
- [ ] Generic terminology replaced with domain terminology where appropriate.
- [ ] MechanicPro workflows remain recognizable and domain-specific.
- [ ] No competitor UI copied.
- [ ] No copyrighted assets used improperly.
- [ ] Design system is consistent.
- [ ] Product behavior is differentiated by real workflows, not decoration.

---

# P. DOMAIN LOGIC

Verify real workflows:
- [ ] Manager creates company.
- [ ] Manager invites technician.
- [ ] Manager invites customer.
- [ ] Equipment belongs to correct customer/company.
- [ ] Jobs belong to correct company.
- [ ] Technician assignment is enforced.
- [ ] Job statuses follow valid transitions.
- [ ] Worksheets lock appropriately.
- [ ] Service history is preserved.
- [ ] Parts are recorded correctly.
- [ ] Checklists enforce required items.
- [ ] Customer sign-off works.
- [ ] Reports match completed work.
- [ ] Certificates use correct form version.
- [ ] Maintenance plans calculate correctly.
- [ ] Repeat-fault logic is correct.
- [ ] Booking availability is correct.
- [ ] Technician assignment is correct.
- [ ] Route plans are correct.
- [ ] Cost calculations are correct.
- [ ] Notifications correspond to actual events.

---

# Q. DATA RIGHTS

- [ ] Company export works.
- [ ] Export contains the promised data.
- [ ] Export does not expose another company.
- [ ] Company deletion works safely.
- [ ] Deletion grace period works.
- [ ] Deleted access is revoked.
- [ ] Historical records behave as documented.
- [ ] Privacy policy matches actual behavior.
- [ ] Terms match actual behavior.

---

# R. EMAIL

Verify:
- [ ] Domain verified.
- [ ] SPF.
- [ ] DKIM.
- [ ] From address.
- [ ] Registration email.
- [ ] Confirmation link.
- [ ] Password reset.
- [ ] Invitation.
- [ ] Booking confirmation.
- [ ] Reminder.
- [ ] On-my-way notification.
- [ ] Relevant status notifications.
- [ ] English.
- [ ] Kiswahili.
- [ ] Emails point to production domain.
- [ ] Emails do not expose secrets.

---

# S. BACKUPS

- [ ] Backup configuration complete.
- [ ] Backup job succeeds.
- [ ] Restore-test job succeeds.
- [ ] Real restore performed.
- [ ] Scratch database opened successfully.
- [ ] Restored data verified.
- [ ] Backup access restricted.
- [ ] Backup secrets protected.
- [ ] Retention understood.
- [ ] Recovery procedure documented.

---

# T. MONITORING

- [ ] Sentry configured.
- [ ] Test error received.
- [ ] Sentry alerts configured.
- [ ] Uptime monitoring configured.
- [ ] /api/health monitored.
- [ ] Render failure emails enabled.
- [ ] Cron failure alerts enabled.
- [ ] Billing alerts enabled.

---

# U. DOMAIN AND DEPLOYMENT

- [ ] Production domain connected.
- [ ] HTTPS certificate valid.
- [ ] APP_URL correct.
- [ ] CORS correct.
- [ ] Production environment enabled.
- [ ] Correct database.
- [ ] Correct storage.
- [ ] Correct email.
- [ ] Correct monitoring.
- [ ] No staging secrets in production.
- [ ] No development data in production.
- [ ] seed.py has never been run against production.

---

# V. MAPS AND ROUTING

- [ ] Production map tiles use an appropriate commercial provider/agreement.
- [ ] No inappropriate reliance on public OSM tile servers.
- [ ] Routing provider configured if required.
- [ ] Routing API key protected.
- [ ] Routing abuse is rate-limited.
- [ ] Maps do not expose unnecessary user location data.

---

# W. SECURITY INCIDENT RESPONSE

Confirm documented procedures for:
- [ ] Leaked API key.
- [ ] Leaked database password.
- [ ] Compromised GitHub.
- [ ] Compromised admin.
- [ ] Compromised user.
- [ ] Suspicious traffic.
- [ ] Unexpected bill.
- [ ] Payment fraud.
- [ ] Database incident.
- [ ] Malicious dependency.
- [ ] Production rollback.

---

# X. OWNER ACCOUNT SECURITY

Confirm:
- [ ] GitHub 2FA.
- [ ] Render 2FA.
- [ ] Email provider 2FA.
- [ ] Payment provider 2FA.
- [ ] Domain registrar 2FA.
- [ ] Sentry 2FA if available.
- [ ] Unique passwords.
- [ ] Recovery codes stored safely.
- [ ] Minimum team permissions.
- [ ] No shared passwords.

---

# Y. LEGAL / KENYA READINESS

Confirm with the appropriate professional:
- [ ] Privacy policy reviewed.
- [ ] Terms reviewed.
- [ ] Data protection obligations assessed.
- [ ] ODPC registration requirement assessed.
- [ ] VAT/tax treatment assessed.
- [ ] Subscription invoices/receipts assessed.
- [ ] Data retention assessed.
- [ ] Customer deletion/export obligations assessed.

Do not mark legal compliance "PASS" merely because documents exist.

---

# Z. FINAL GO/NO-GO

MechanicPro is GO only if:

- [ ] No CRITICAL security findings remain.
- [ ] No unresolved HIGH security findings remain unless explicitly accepted and documented.
- [ ] No exposed secrets remain.
- [ ] Cross-company isolation passes.
- [ ] Authentication passes.
- [ ] Authorization passes.
- [ ] Production build passes.
- [ ] Real-device critical workflows pass.
- [ ] Backup restore passes.
- [ ] Monitoring works.
- [ ] Email works.
- [ ] Legal requirements are addressed.
- [ ] Domain/HTTPS works.
- [ ] Cost controls are active.
- [ ] No accidental paid services are active.
- [ ] Support channel exists.
- [ ] Production data is not demo data.
- [ ] No fake claims are present.
- [ ] Remaining risks are documented and consciously accepted.

## Final Claude response must contain exactly these headings:

1. GO / NO-GO
2. Critical blockers
3. High-risk blockers
4. Security evidence
5. Cost-safety evidence
6. Authentication evidence
7. Authorization evidence
8. Cross-company isolation evidence
9. Data-integrity evidence
10. Payment evidence
11. Backup/restore evidence
12. Monitoring evidence
13. Email evidence
14. Mobile/offline evidence
15. Legal/data-protection items
16. Originality/product-quality evidence
17. Tests run and results
18. Files changed
19. Owner actions required
20. Remaining risks

Never call the project "100% secure" or "hack-proof."
