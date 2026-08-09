# Ledger auth server

A small, real backend that verifies a person's email address *before*
creating their account — as opposed to the front-end-only simulation in the
static `Ledger` site, this one actually sends a code to their inbox via
[Resend](https://resend.com) and won't create the account until that code is
confirmed.

## How it works

1. **`POST /api/auth/signup/start`** — person submits name, email, password.
   Server validates input, hashes the password (bcrypt), generates a 6-digit
   code, emails it via Resend, and stores a *pending* signup (not yet an
   account) with the code, an expiry, and an attempt counter.
2. **`POST /api/auth/signup/verify`** — person submits the code. If it
   matches and hasn't expired, the server creates the real account and
   returns a session token (JWT). If it's wrong, the attempt counter
   increments; after too many wrong tries the pending signup is discarded and
   they have to start over.
3. **`POST /api/auth/signup/resend`** — sends a fresh code (rate-limited so
   it can't be spammed).
4. **`POST /api/auth/login`** — normal email + password login for accounts
   that already exist and are verified.
5. **`GET /api/auth/me`** — returns the current account given a valid
   `Authorization: Bearer <token>` header.

No account row is ever written until step 2 succeeds — that's the actual
"verify before creating" behavior you asked for. The front-end demo can't do
this on its own because it has no server to send real email from.

## Messaging (jobseeker ↔ admin)

Every jobseeker account gets one chat thread with the site admin. Endpoints
(all require `Authorization: Bearer <token>`):

- **`GET /api/messages/mine`** — jobseeker's own thread (creates it on first
  call).
- **`POST /api/messages`** `{ text }` — jobseeker sends a message.
- **`GET /api/messages/conversations`** *(admin only)* — every jobseeker's
  thread, newest activity first, with unread counts.
- **`GET /api/messages/conversations/:accountId`** *(admin only)* — one
  thread.
- **`POST /api/messages/conversations/:accountId/reply`** `{ text }`
  *(admin only)* — admin replies.

An account becomes an admin when its email is listed in `ADMIN_EMAILS` (see
below) — that's checked on every login/signup, so adding an email there and
logging in (or signing up) is all it takes. Admin-only routes return `403`
for anyone else. Threads live in the same `data/db.json` file as accounts, so
they'll need the same real-database swap mentioned below before production
use.

The front-end talks to this from **`messages.html`** (jobseeker chat) and
**`admin.html`** (admin inbox) — both poll every few seconds for new
messages rather than using websockets, to keep the server dependency-free.

## Setup

Requires Node 18+.

```bash
npm install
cp .env.example .env
```

Then fill in `.env`:

- **`RESEND_API_KEY`** — sign up at resend.com (free tier is fine), verify a
  sending domain (or use their `onboarding@resend.dev` sandbox sender while
  testing), then create an API key.
- **`EMAIL_FROM`** — an address on your verified domain, e.g.
  `"Ledger <verify@yourdomain.com>"`.
- **`JWT_SECRET`** — any long random string (`openssl rand -hex 32` works).
- **`CORS_ORIGIN`** — the URL(s) your front-end is served from, comma
  separated (e.g. where you're hosting the `PrimeSphere` site).
- **`ADMIN_EMAILS`** — comma-separated emails that should get admin access
  to `admin.html` (the message inbox). Sign up or log in with one of these
  and that account becomes an admin automatically.

Run it:

```bash
npm run dev     # auto-restarts on file changes
# or
npm start
```

It listens on `http://localhost:4000` by default (`PORT` in `.env`).

## Deploying

This is a plain Express app — deploy it anywhere that runs Node:
**Render, Railway, Fly.io, a VPS, etc.** A few notes:

- Set the same environment variables from `.env` in your host's dashboard.
- The data store is a JSON file (`data/db.json`) for simplicity — it's fine
  for a demo or low-traffic use, but **swap `src/db.js` for a real database**
  (Postgres, MySQL, etc.) before relying on this in production, since a flat
  file won't survive most platforms' ephemeral filesystems or handle
  concurrent writes safely.
- Update `CORS_ORIGIN` to your deployed front-end's real URL once you know it.

## Wiring up the front-end

In `login.html`, set `AUTH_API_BASE` (near the top of the `<script>` block)
to wherever you deploy this server, e.g.:

```js
const AUTH_API_BASE = 'https://your-server.onrender.com/api/auth';
```

The updated `login.html` I gave you already calls these endpoints instead of
generating a fake local code — it posts to `/signup/start`, shows the "check
your email" screen, and posts the entered code to `/signup/verify` to
actually create the account.

## Security notes for a production version

- Passwords are hashed with bcrypt — never stored or emailed in plaintext.
- Codes expire (`CODE_TTL_MINUTES`, default 10 min) and are capped at
  `CODE_MAX_ATTEMPTS` wrong guesses before requiring a fresh code.
- Resending is rate-limited (`CODE_RESEND_COOLDOWN_SECONDS`) and the signup/
  login endpoints have basic IP rate limiting via `express-rate-limit`.
- Consider adding: HTTPS (required in production — most hosts provide this
  automatically), a real database with proper indexing/uniqueness
  constraints on email, logging/alerting, and a password reset flow.
