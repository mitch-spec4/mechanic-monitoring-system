# MechanicPro — Final Production, Security, Originality & Cost-Safety Pull Checklist

## Purpose

This file is the master instruction set for Claude Code before MechanicPro is considered ready for public production.

The goal is a genuinely production-quality application, not a cosmetic disguise for AI-generated code.

Claude must:
- inspect before changing;
- preserve working functionality;
- make minimal, reversible changes;
- test every meaningful change;
- never claim 100% security;
- never fabricate functionality, customers, reviews, certifications, compliance, or business history;
- never purchase anything or activate paid services;
- never increase spending limits;
- never deploy production unless explicitly instructed;
- stop and ask before any action that could create a charge;
- never expose secrets;
- never commit secrets;
- never delete production data;
- never rotate credentials without explaining why and receiving approval;
- use mocks for paid external APIs during tests.

---

# 1. READ-ONLY INITIAL AUDIT

Before modifying files, inspect the entire repository.

Inventory:
- frontend
- backend
- database
- migrations
- authentication
- authorization
- JWT
- roles
- company/tenant isolation
- API routes
- uploads
- storage
- email
- notifications
- payments
- webhooks
- external APIs
- background workers
- Redis/Celery if present
- Docker
- Render
- GitHub Actions
- environment variables
- dependencies
- tests
- PWA/offline code
- logging
- monitoring
- backups
- legal pages
- translations

Create or update a security audit with:
- finding
- severity
- file/endpoint
- exploit scenario
- recommended fix
- financial-cost risk
- status

Severity:
CRITICAL / HIGH / MEDIUM / LOW / INFO

Do not hide inconvenient findings.

---

# 2. SECRETS AND CREDENTIALS

Search source code, Git history, configuration, logs, tests, docs and CI/CD for:
- API keys
- JWT secrets
- Flask secret keys
- database passwords
- PostgreSQL URLs
- Redis credentials
- SMTP credentials
- cloud credentials
- AWS keys
- Google credentials
- GitHub tokens
- OAuth secrets
- payment secrets
- webhook secrets
- private keys
- certificates
- access tokens
- refresh tokens

Never print complete secrets.

If a secret was exposed:
- identify its type and location;
- remove it from source;
- recommend rotation;
- explain whether Git history cleanup is required;
- do not rotate automatically.

Never expose backend secrets through React/Vite variables.

Verify:
- .gitignore protects .env and secret files;
- .env.example contains placeholders only;
- production secrets are server-side.

---

# 3. GITHUB SECURITY

Audit GitHub Actions and repository permissions.

Check for:
- excessive workflow permissions;
- secrets exposed to forks;
- unsafe pull-request execution;
- shell injection;
- dependency compromise;
- arbitrary code execution;
- unnecessary write permissions;
- production secrets available to untrusted code.

Prefer least privilege, for example:
permissions:
  contents: read

Do not create or modify GitHub secrets without approval.

Do not push automatically unless explicitly instructed.

---

# 4. AUTHENTICATION

Audit:
- password hashing;
- login/logout;
- JWT issuance;
- JWT validation;
- expiration;
- refresh;
- password reset;
- email verification;
- account enumeration;
- brute-force protection;
- lockout;
- session invalidation;
- token theft;
- cookie security;
- CSRF where applicable.

Passwords must never be plaintext.

Use Argon2id or appropriately configured bcrypt.

Never log passwords, tokens, API keys or secrets.

Reject malformed, expired, tampered or algorithm-confused JWTs.

---

# 5. AUTHORIZATION AND RBAC

Backend authorization is mandatory.

Verify every sensitive endpoint checks:
- authentication;
- identity;
- role;
- company/tenant;
- resource ownership;
- permissions.

Never trust frontend role state.

Test IDOR/BOLA.

A user must not access another user's or another company's:
- jobs
- equipment
- customers
- service records
- reports
- reviews
- messages
- notifications
- documents
- forms
- certificates
- locations
- parts
- other private resources

---

# 6. MULTI-TENANT ISOLATION

Treat company isolation as a critical security boundary.

Every database query and sensitive operation must prevent cross-company access.

Test:
- Company A cannot access Company B;
- changing IDs cannot bypass isolation;
- changing company IDs in requests cannot bypass isolation;
- managers cannot access unrelated companies;
- technicians cannot access unrelated companies;
- customers cannot access unrelated companies.

---

# 7. API SECURITY

Audit every API endpoint for:
- authentication;
- authorization;
- input validation;
- output validation;
- rate limiting;
- request-size limits;
- SQL injection;
- XSS;
- CSRF;
- SSRF;
- command injection;
- path traversal;
- insecure deserialization;
- mass assignment;
- parameter tampering;
- broken access control;
- information disclosure.

Never expose production stack traces or database errors.

Use safe production errors and protected developer logs.

---

# 8. DATABASE SECURITY

Audit SQLAlchemy and raw SQL.

Prevent:
- SQL injection;
- unauthorized database access;
- unsafe destructive operations;
- unsafe migrations;
- accidental deletion.

Use parameterized queries/ORM mechanisms.

Use least-privilege database credentials.

Do not expose PostgreSQL unnecessarily.

Review:
- foreign keys;
- ownership;
- constraints;
- indexes;
- cascade behavior;
- timestamps;
- transactions.

Never run destructive production migrations without explicit approval.

---

# 9. INPUT VALIDATION

Validate all user-controlled input:
- names
- emails
- phone numbers
- machine data
- customers
- reviews
- recommendations
- service descriptions
- dates
- IDs
- URLs
- uploads
- search
- filters
- pagination
- sorting

Server-side validation is mandatory.

---

# 10. FILE UPLOAD SECURITY

For photos, videos, documents, signatures and certificates:
- do not trust filenames;
- do not trust extensions;
- do not trust MIME headers;
- validate content;
- enforce size limits;
- restrict allowed types;
- generate safe filenames;
- prevent path traversal;
- prevent executable uploads;
- protect SVG handling;
- prevent arbitrary overwrite;
- protect private documents;
- prevent decompression bombs.

Never allow uploads to become executable code.

---

# 11. CORS AND SECURITY HEADERS

Do not use wildcard CORS with credentials.

Use an explicit production origin allowlist.

Configure appropriate:
- Content-Security-Policy
- X-Content-Type-Options
- Referrer-Policy
- Strict-Transport-Security
- Permissions-Policy
- frame protections

Test that security headers do not break the application.

---

# 12. RATE LIMITING AND ABUSE

Protect:
- login
- registration
- password reset
- OTP/verification
- invitations
- uploads
- search
- expensive API calls
- email
- notifications
- external APIs
- payment operations

Use:
- per-IP limits;
- per-user limits;
- per-company limits;
- concurrency limits;
- payload limits;
- timeouts;
- daily/monthly quotas where appropriate.

The application must not allow one attacker to generate unlimited costs.

---

# 13. EXTERNAL API COST SAFETY

Find every external service and document:
- provider;
- endpoint;
- credential location;
- pricing model;
- quotas;
- rate limits;
- abuse vector;
- maximum plausible cost;
- protection.

Never let unauthenticated users directly trigger expensive APIs.

Use:
- authentication;
- authorization;
- rate limits;
- quotas;
- caching;
- payload limits;
- timeouts;
- concurrency limits.

Do not activate or upgrade paid services.

---

# 14. PAYMENT AND WALLET SECURITY

Audit all billing code.

Never store card numbers, CVV, payment PINs or banking passwords unless handled by a compliant provider and genuinely required.

Payment secrets remain server-side.

Never trust:
- frontend payment success;
- frontend prices;
- frontend subscription status;
- frontend plan limits;
- client-supplied payment amounts.

Verify payment status server-side.

Secure webhooks with:
- signature verification;
- timestamp/replay protection where supported;
- event validation;
- idempotency;
- duplicate-event handling.

Prevent:
- fake payment confirmations;
- price manipulation;
- duplicate charges;
- forged callbacks;
- unauthorized refunds;
- unauthorized subscription changes.

Any real payment activation requires explicit owner approval.

---

# 15. WEBHOOK SECURITY

For every webhook:
- verify signature;
- validate timestamp where supported;
- reject invalid requests;
- prevent replay;
- validate event type;
- validate payload;
- make processing idempotent;
- log safely.

---

# 16. BILLING FIREWALL

Create and maintain COST_SAFETY.md.

List:
- hosting;
- database;
- storage;
- bandwidth;
- email;
- SMS;
- AI APIs;
- image/video APIs;
- maps;
- routing;
- monitoring;
- CI/CD;
- payment services;
- third-party SaaS.

For each document:
- cost model;
- abuse path;
- limits;
- alerting;
- emergency shutdown.

Never make a paid change automatically.

---

# 17. FRONTEND SECURITY

Audit React/Vite for:
- dangerouslySetInnerHTML;
- unsafe HTML;
- exposed secrets;
- unsafe localStorage;
- token leakage;
- sensitive URLs;
- unsafe redirects;
- XSS;
- unsafe scripts.

Treat the frontend as untrusted.

Never trust:
- hidden buttons;
- disabled controls;
- React state;
- localStorage;
- frontend roles;
- frontend prices;
- frontend subscription status.

---

# 18. PRODUCTION CONFIGURATION

Verify production does not use:
- DEBUG=True;
- development CORS;
- default passwords;
- test secrets;
- test credentials;
- verbose errors;
- debug routes;
- development endpoints;
- insecure cookies;
- localhost URLs.

Use:
- HTTPS;
- secure secrets;
- production database;
- restricted CORS;
- security headers;
- safe logging.

---

# 19. LOGGING AND MONITORING

Never log:
- passwords;
- JWTs;
- refresh tokens;
- API keys;
- payment secrets;
- unnecessary personal data.

Useful monitoring should detect:
- failed logins;
- suspicious authorization failures;
- abnormal request volume;
- external API spikes;
- webhook failures;
- account abuse;
- unexpected errors.

Do not add paid monitoring without approval.

---

# 20. BACKUPS AND RECOVERY

Verify:
- production backups;
- off-site storage;
- encryption/access controls;
- retention;
- restoration procedure.

Perform an actual restore test against a scratch database.

Never delete existing backups.

---

# 21. DEPENDENCY SECURITY

Audit:
- requirements.txt;
- pyproject.toml;
- package.json;
- lockfiles.

Identify:
- known vulnerabilities;
- abandoned packages;
- suspicious packages;
- typosquatting;
- unnecessary packages.

Do not blindly upgrade everything.

Before upgrading:
1. explain why;
2. check compatibility;
3. identify breaking changes;
4. make the smallest safe change;
5. run tests.

---

# 22. CI/CD AND DOCKER

CI/CD:
- least privilege;
- no secrets to untrusted PRs;
- safe dependency installation;
- protected production deployment.

Docker:
- do not run as root unnecessarily;
- minimize images;
- pin dependencies where sensible;
- never bake secrets into images;
- do not copy .env;
- expose only required ports;
- use health checks.

---

# 23. TRANSACTIONS AND CONCURRENCY

Audit multi-step operations.

Use transactions when multiple writes must succeed together.

Test concurrent:
- edits;
- assignments;
- service records;
- payments;
- webhooks;
- equipment updates.

Use constraints, transactions, locking or idempotency where appropriate.

---

# 24. DATA INTEGRITY

Identify records that should be:
- editable;
- immutable;
- archived;
- soft deleted;
- permanently deleted.

Protect permanent service history.

Important changes should have an audit trail.

Prevent impossible business states such as:
- invalid dates;
- invalid ownership;
- duplicate records;
- unauthorized status transitions;
- invalid assignments.

---

# 25. AUDIT TRAIL

Audit important events:
- login;
- logout;
- password change;
- role change;
- invitation;
- mechanic assignment;
- equipment creation;
- equipment ownership;
- service record creation/edit;
- job status;
- job assignment;
- deletion;
- report generation;
- subscription change;
- payment;
- administrative actions.

Do not expose secrets in audit records.

Users must not be able to casually modify audit history.

---

# 26. PRIVACY

Identify personal/business information.

For each sensitive field determine:
- why it exists;
- who can access it;
- retention;
- protection;
- logging exposure;
- API exposure;
- URL exposure.

Minimize unnecessary data collection.

Provide safe company export and deletion behavior.

---

# 27. BUSINESS-LOGIC RED TEAM

Test malicious but valid requests:
- change job ID;
- change company ID;
- change mechanic ID;
- change customer ID;
- change price;
- change subscription;
- change ownership;
- change service status;
- change timestamps;
- modify another user's record.

Sensitive authorization data should be derived server-side wherever possible.

---

# 28. FAILURE MODES

Test:
- database unavailable;
- Redis unavailable;
- external API failure;
- email failure;
- upload failure;
- expired JWT;
- malformed JWT;
- network loss;
- timeout;
- duplicate submission;
- duplicate webhook;
- transaction failure;
- malformed server response.

The app must fail safely.

---

# 29. ORIGINALITY AND PRODUCT QUALITY

Do not attempt to conceal development history or falsely claim human authorship.

Instead make the actual product distinctive.

Remove:
- generic AI dashboard patterns;
- excessive gradients;
- excessive glassmorphism;
- meaningless KPI cards;
- generic CRM language;
- fake activity;
- fake testimonials;
- fake reviews;
- fake companies;
- fake statistics;
- unnecessary animation;
- random decorative elements;
- inconsistent component styles.

MechanicPro should be clearly built around real service-management workflows:
- equipment;
- machines;
- job sites;
- inspections;
- service history;
- maintenance;
- parts;
- technicians;
- customers;
- reports;
- recommendations;
- forms;
- certificates;
- offline field work.

Do not imitate competitors.

Do not use copyrighted assets without rights.

---

# 30. UX QUALITY

Every important screen must handle:
- loading;
- success;
- empty state;
- error;
- disabled state;
- offline state where applicable.

Forms:
- clear labels;
- validation;
- required fields;
- safe errors;
- no double submission.

Destructive actions:
- confirmation;
- appropriate authorization;
- safe recovery where possible.

Tables:
- pagination;
- search;
- filters;
- responsive behavior;
- clear actions.

---

# 31. ACCESSIBILITY

Test:
- keyboard navigation;
- focus states;
- semantic HTML;
- labels;
- contrast;
- screen-reader labels;
- error messaging;
- touch targets.

---

# 32. RESPONSIVE AND REAL-DEVICE TESTING

Test:
- desktop;
- laptop;
- tablet;
- Android Chrome;
- Android PWA;
- iPhone Safari;
- iPhone PWA.

Especially:
- camera;
- location;
- photos;
- videos;
- signatures;
- notifications;
- offline mode;
- reconnect;
- PWA installation;
- storage behavior.

---

# 33. OFFLINE MODE

Verify technician offline workflows:
- clock in/out;
- start;
- pause;
- resume;
- complete;
- signature;
- time;
- parts;
- checklist;
- notes;
- photos;
- videos.

Verify:
- queue persistence;
- unique operation IDs;
- duplicate prevention;
- conflict handling;
- retry;
- sync;
- rejection reasons.

Never silently lose work.

---

# 34. INTERNATIONALIZATION

Verify:
- English;
- Kiswahili;
- user language preference;
- company language;
- email language;
- notification language;
- date/time formatting;
- currency;
- units.

Have a native Kiswahili speaker review translations.

Do not rely only on automated translation tests.

---

# 35. LEGAL AND TRUST

Do not claim:
- 100% secure;
- hack-proof;
- guaranteed;
- certified;
- GDPR/PCI/SOC/ISO compliant

unless actually substantiated.

Before launch:
- replace privacy policy placeholder;
- replace terms placeholder;
- review with appropriate legal professional;
- confirm data-retention/deletion behavior;
- confirm Kenya data-protection obligations;
- confirm tax/VAT/invoice requirements for paid subscriptions.

---

# 36. PRODUCTION INFRASTRUCTURE

Verify:
- production host;
- custom domain;
- HTTPS;
- APP_URL;
- CORS;
- email;
- database;
- backups;
- object storage;
- monitoring;
- uptime monitoring;
- map tile provider;
- routing provider;
- billing provider if enabled.

Do not rely on public OSM tile servers for heavy commercial production use.

Use appropriate paid/commercial map tiles or an appropriate agreement.

---

# 37. COST AND WALLET PROTECTION

For every feature ask:

"What happens if an attacker calls this 100,000 times?"

Check:
- email cost;
- storage cost;
- bandwidth;
- maps;
- routing;
- payment calls;
- AI calls;
- database;
- compute.

Use quotas, limits and alerts.

Enable provider-side spending limits where available.

Do not change billing settings automatically.

---

# 38. FINAL PRODUCTION CLEANUP

Search for:
- TODO;
- FIXME;
- debug;
- console.log;
- localhost;
- 127.0.0.1;
- test passwords;
- demo credentials;
- fake emails;
- placeholder text;
- Lorem ipsum;
- fake API keys;
- development endpoints;
- test routes.

Inspect Git history for secrets.

Remove or isolate unfinished features.

---

# 39. DOCUMENTATION

Maintain:
- README.md;
- SETUP.md;
- SECURITY.md;
- ARCHITECTURE.md;
- API.md;
- DEPLOYMENT.md;
- COST_SAFETY.md;
- INCIDENT_RESPONSE.md;
- LAUNCH_CHECKLIST.md;
- POST_PULL_CONFIRMATION.md.

Documentation must describe actual behavior only.

---

# 40. FINAL REPORT FROM CLAUDE

After completing the work, report:

## Security
- CRITICAL fixed
- HIGH fixed
- MEDIUM fixed
- LOW fixed
- remaining risks

## Authentication
- status
- findings
- tests

## Authorization
- status
- findings
- cross-company tests

## Data integrity
- status
- findings

## Privacy
- status
- findings

## Payments
- status
- webhook tests
- remaining billing setup

## Cost safety
- every billable service
- abuse vector
- controls
- remaining risk

## Dependencies
- vulnerabilities
- upgrades
- remaining risk

## Infrastructure
- deployment
- domain
- email
- storage
- maps
- backups
- Sentry
- uptime

## UX
- desktop
- mobile
- loading
- empty
- errors
- accessibility

## Originality
- generic patterns removed
- domain-specific improvements
- remaining generic areas

## Tests
- backend
- frontend
- browser
- security
- fuzzing
- offline
- real-device
- production smoke tests

## Files changed
List every file.

## Owner actions required
List every action Mitch must manually perform.

Never say "100% secure."
Never say "hack-proof."
Never say "ready" unless the evidence supports it.
