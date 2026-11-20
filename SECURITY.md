# Security

## Reporting a vulnerability

Please do not open a public issue. Report privately to the maintainers (use the repository's private
security advisory feature) with steps to reproduce. We aim to acknowledge reports within a few days.

## What the application does

**Accounts and sessions**
* Passwords: scrypt with a random salt per password, minimum 10 characters, letters and numbers, common patterns refused.
  Nothing is ever stored in readable form; generated passwords are shown once.
* Sessions: random 256-bit tokens, only their SHA-256 hash is stored; `HttpOnly`, `SameSite=Strict`,
  `Secure` and the `__Host-` prefix on HTTPS; a new session on every sign-in; expiry after `SESSION_HOURS`;
  password changes and resets end the other sessions.
* Sign-in: failed attempts are limited per address and per account; unknown accounts cost the same time as wrong
  passwords; password-reset answers are identical whether or not the account exists; reset links are single use,
  expire after one hour and are stored hashed.
* Roles (admin, HR, reception) are checked on the server for every request. HR cannot grant HR rights.

**Visitors**
* A visitor session exists only after a correct one-time code (stored hashed, 5 attempts, 5 minutes).
* Visitors never receive host contact details or other visitors' data. Selfies are private and are shared only
  through short-lived signed links; uploads are checked by their real file signature (JPEG, PNG, WebP), size-limited,
  and rate-limited.
* Host approval links carry a random token that is stored hashed.

**Platform**
* Cross-site request blocking (Origin check), a strict Content-Security-Policy (everything served from this origin),
  `X-Frame-Options: DENY`, `nosniff`, `Permissions-Policy`, HSTS on HTTPS, `no-store` on API and signed-in pages.
* No third-party requests from the browser or the server (no CDNs, fonts, analytics). The only outgoing traffic is
  your own SMTP server and the optional webhook you configure (https only, signed, no redirects).
* SMTP password is encrypted at rest (AES-256-GCM) and never returned to the browser.
* Errors shown to users never contain stack traces or internals.
* An audit log records sign-ins, failures, password and account changes, and booking events (Admin → Audit log).

## What you must do

* Serve it over HTTPS and set `ORIGIN` (see the README production checklist).
* Never run a public server with `PUBLIC_SHOW_TEST_OTP=true`.
* Keep Node.js and the dependencies up to date (`npm audit`).
* Protect the database and its backups: they contain visitor names, phone numbers and photos. Decide how long you
  keep visitor records and delete old ones, as your local privacy rules require.
* Restrict network access to PostgreSQL to the application host and use TLS (`DB_SSL=true`) when it is remote.

## Known limits

* Live admin updates and the in-memory OTP counters are per instance when you run several instances.
* The visitor phone format defaults to India (+91) in the login form.
