# Visitor Management System

Visitor management for offices, factories and campuses. Dual licensed: AGPL-3.0 or a paid commercial license.

* **Visitors** verify their phone with a one-time code, check in with a selfie, and the host approves from a link.
* **Pre-booking** with time slots: visitors reserve a slot with a host and get a QR pass.
* **Reception** scans passes and checks visitors in and out.
* **HR** and **Admin** portals: staff, departments, attendance, reports, settings, sessions and an audit log.
* Works on phones and desktops. Runs on **SQLite** (zero setup) or **PostgreSQL**.
* No third-party services: no CDNs, fonts, analytics or external APIs. E-mail goes through your own SMTP server.

Built with SvelteKit 2, Svelte 5 and Tailwind CSS 4.

## Quick start

Requires **Node 22.13 or newer**.

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm run dev                 # http://localhost:5173
```

On the first start the database is created and the first accounts are set up. If you did not set
`SEED_*_PASSWORD` in `.env`, strong passwords are generated and **printed once in the server log**.
`npm run db:reset` deletes the SQLite database (it is re-created on the next start).

## Pages

| Who | Address | Sign-in |
| --- | --- | --- |
| Visitors | `/visitor/login` | phone + one-time code |
| Admin | `/admin` (`/admin/login`) | e-mail + password, account label `admin` |
| HR | `/hr` (`/hr/login`) | e-mail + password, staff record with role `HR` |
| Reception | `/reception` (`/reception/login`) | e-mail + password, receptionist record |
| Host approval | `/staff/approve?...` | one-time link sent to the host |

`/` is a landing page that links to all of them.

## Test mode

With `PUBLIC_SHOW_TEST_OTP=true` (the default in `.env.example`):

* the OTP is shown on the visitor login page instead of being sent;
* e-mails and messages are printed to the server console instead of being sent;
* after a walk-in check-in the status page shows the host's approval link;
* password reset links are printed in the console.

**Turn it off before going live.** With it off, the OTP is only delivered through the outgoing webhook (below).

## Pre-booking with time slots

Visitors choose **Pre-book a visit**, verify their phone, then pick a host, a date and a free slot.
A booking creates an approved pass for that day (QR code on `/visitor/pass`), so reception checks the visitor
in with the normal QR flow. Admin and HR see bookings under **Pre-bookings**, reception under `/reception/bookings`.
Two visitors can never take the same slot, even when they click at the same moment.

Rules are editable under **Admin → Settings**: opening hours, slot length, days ahead, visitors per slot,
bookable weekdays, and how many open bookings one visitor may hold.

## Notifications

* **E-mail**: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (and optionally `SMTP_FROM`) under
  Admin → Settings. The password is stored encrypted and is never shown again. Use the "Test" button to check.
* **SMS / WhatsApp / chat (optional)**: set `NOTIFY_WEBHOOK_URL` (https). The app POSTs JSON such as
  `{"type":"otp","phone":"+1…","otp":"1234"}` there, signed with HMAC-SHA256 in the `X-VMS-Signature` header
  (key: `NOTIFY_WEBHOOK_SECRET`). Point it at any provider or a small relay you control.
* Nothing configured: messages are written to the server console.

## Switching to PostgreSQL

The app talks to the database through one engine-neutral layer (`src/lib/server/db.js`); every SQL difference
between engines is isolated in `src/lib/server/sql/sqlite.js` and `postgres.js`. Both engines run the same
automated test suite.

1. Create an empty database and user, e.g. `createdb vms`.
2. Copy your data (optional, skip on a fresh install). Stop the app first:

   ```bash
   npm run db:migrate -- sqlite:./data/vms.db postgres://vms:password@localhost:5432/vms
   ```

3. Set `DATABASE_URL=postgres://vms:password@localhost:5432/vms` in `.env` (and `DB_SSL=true` for a remote server)
   and restart. Tables are created automatically. Sessions are not copied: everyone signs in again.

If several app instances share one PostgreSQL database, bookings stay conflict-free (advisory locks) and rate limits
are shared. Live updates in the admin screens are delivered per instance.

## Production checklist

```bash
npm run build
node build          # needs the variables from .env in the real environment
```

* Run it behind HTTPS (a reverse proxy such as nginx or Caddy) and set `ORIGIN=https://your.host`.
  Behind a proxy also set `ADDRESS_HEADER=X-Forwarded-For` and `XFF_DEPTH=1` so rate limits see the real client address.
* **Remove `PUBLIC_SHOW_TEST_OTP`**, set `FRONTEND_BASE_URL` to the public address, configure SMTP.
* Change the generated first-start passwords after the first sign-in and delete demo staff you do not need
  (`SEED_DEMO_DATA=false` skips them).
* Back up the database (`data/vms.db` for SQLite, `pg_dump` for PostgreSQL). It also holds the uploaded selfies.
* Run `npm run test:smoke` against a staging copy after upgrades (see below).

See [SECURITY.md](SECURITY.md) for what is protected and how to report a problem.

## Tests

`scripts/smoke-test.mjs` drives a running server end to end (sign-in, access control, CSRF, uploads, OTP flow,
pre-booking race, approval and reception flow, query engine). It needs the server in test mode and the three
account credentials:

```bash
BASE=http://localhost:5173 \
ADMIN_EMAIL=… ADMIN_PASSWORD=… HR_EMAIL=… HR_PASSWORD=… REC_EMAIL=… REC_PASSWORD=… \
npm run test:smoke
```

Run it once per database engine. Use a fresh database: the brute-force check intentionally trips the sign-in limiter.

## Project layout

| Path | What |
| --- | --- |
| `src/lib/server/db.js` | Storage layer: documents, users, sessions, rate limits, audit log, files |
| `src/lib/server/sql/` | SQLite and PostgreSQL drivers and schema |
| `src/lib/server/auth.js`, `src/hooks.server.js` | Sessions, roles, CSRF, security headers |
| `src/lib/server/notify.js` | E-mail and webhook delivery |
| `src/routes/api/` | Server endpoints (`db`, `auth`, `otp`, `prebooking`, `visitor-*`, `receptionists`, `admin`, …) |
| `src/routes/{admin,hr,reception,visitor,staff}/` | The portals |
| `scripts/` | `smoke-test.mjs`, `migrate-db.mjs` |

## License

Dual licensed:

* **AGPL-3.0** ([LICENSE](LICENSE)): free to use, but if you modify it and let others use it over a network you must
  publish your complete source under the AGPL too.
* **Commercial license**: for use without the AGPL obligations (private modifications, embedding, hosted service).
  See [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) for how to buy.

By contributing you agree that your contribution may be distributed under both licenses.
