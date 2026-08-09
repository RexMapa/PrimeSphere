# Ledger auth server

A small, real backend that verifies a person's email address *before*
creating their account — as opposed to the front-end-only simulation in the
static `PrimeSphere` site, this one actually sends a code to their inbox via
[Resend](https://resend.com) and won't create the account until that code is
confirmed. All data (accounts, pending signups, and messages) is stored in a
**Supabase (Postgres) database**, not a JSON file — so it survives restarts
and redeploys, and it's the database Hostinger's own "Connect Database ->
Supabase" flow wires up for a Node.js app.

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
"verify before creating" behavior. The front-end demo can't do this on its
own because it has no server to send real email from.

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
for anyone else.

## The database

Four tables in Supabase: `accounts`, `pending_verifications`,
`conversations`, `messages`. Unlike a plain SQL driver, the `supabase-js`
client (`src/db.js`) only reads and writes rows — it can't create tables —
so **you need to run `schema.sql` once** before first use:

1. Open your project at [supabase.com](https://supabase.com) (or the one
   Hostinger created for you).
2. Go to **SQL Editor -> New query**.
3. Paste the entire contents of `schema.sql` and click **Run**.

That file also disables Row Level Security on all four tables. This app
does its own authentication (bcrypt + JWT) rather than Supabase Auth, so RLS
needs to be off — otherwise Supabase's default policies silently block every
read/write this server makes. `initDb()` checks on startup that the
`accounts` table is reachable and gives a clear error if it isn't (wrong
keys, or `schema.sql` not run yet).

## Setup (local development)

Requires Node 18+ and a Supabase project (free tier is enough).

```bash
npm install
cp .env.example .env
```

Then fill in `.env`:

- **`SUPABASE_URL`** / **`SUPABASE_KEY`** — from your Supabase project:
  **Project Settings -> API**. Use the **`service_role`** key, not the
  public `anon` key — this is a trusted backend and RLS is off, so the
  service_role key is what lets it read/write freely. Never expose the
  service_role key to a browser/front-end.
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

It listens on `http://localhost:4000` by default (`PORT` in `.env`). If it
can't reach the `accounts` table, it logs a clear error and exits — check
that `schema.sql` has been run and that `SUPABASE_URL` / `SUPABASE_KEY` are
correct.

## Deploying on Hostinger

1. **Run `schema.sql`** in your Supabase project's SQL Editor (see above) —
   do this before the app's first boot.
2. **Upload / clone this repo** onto your Hostinger Node.js hosting (via Git
   deployment or the file manager).
3. In the Node.js app dashboard, under **Essentials -> Database**, click
   **Connect**, choose **Supabase**, sign in, and either connect your
   existing project or create a new one. Hostinger automatically adds
   `SUPABASE_URL` and `SUPABASE_KEY` (or similarly named variables — check
   the app's **Environment variables** tab and rename in `.env`/`db.js` if
   Hostinger used different names) to your app's environment and redeploys.
4. Add the rest of the variables from `.env.example` in that same
   **Environment variables** panel: `JWT_SECRET`, `RESEND_API_KEY`,
   `EMAIL_FROM`, `ADMIN_EMAILS`, and `CORS_ORIGIN` set to the URL where the
   static `PrimeSphere` site itself is hosted.
5. Set **Startup file** to `ledger-server/src/server.js` (adjust the path to
   wherever this folder ends up on your account), then run `npm install` and
   start the app. Check the logs for `Connected to the database.` to confirm
   it worked.
6. **The site and the API are served by this one app.** `server.js` serves
   the static `PrimeSphere` pages (`index.html`, `jobs.html`, etc. — the
   folder one level above `ledger-server/`) as well as the `/api/*` routes,
   so your Hostinger domain serves everything from this single Node app —
   no separate static hosting needed. `login.html`, `messages.html`, and
   `admin.html` already call the API with relative paths (`/api/...`), so
   they work as-is on whatever domain the app ends up on.

## Security notes for a production version

- Passwords are hashed with bcrypt — never stored or emailed in plaintext.
- Codes expire (`CODE_TTL_MINUTES`, default 10 min) and are capped at
  `CODE_MAX_ATTEMPTS` wrong guesses before requiring a fresh code.
- Resending is rate-limited (`CODE_RESEND_COOLDOWN_SECONDS`) and the signup/
  login endpoints have basic IP rate limiting via `express-rate-limit`.
- `.env` is gitignored — never commit real secrets to the repo, and never
  put the `service_role` key anywhere a browser can read it. Use your host's
  environment-variable panel for production values.
- Consider adding: HTTPS (required in production — most hosts provide this
  automatically), logging/alerting, and a password reset flow.
