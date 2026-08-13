# Aster Lead Engine

Shared prospect tracker for the Aster team. Next.js on Vercel, Neon Postgres, no ORM, four dependencies.

Everyone on the team edits the same list and sees the same data. Every change is attributed and logged. Claude can write researched batches straight in over an authenticated endpoint.

---

## Deploy — about ten minutes

### 1. Push this repo

```bash
git remote add origin git@github.com:<your-org>/<repo>.git
git push -u origin main
```

### 2. Create the database

At [neon.tech](https://neon.tech), create a project. From **Connection Details**, copy the **pooled** connection string — the host contains `-pooler`. The pooled string matters: serverless functions open a lot of short-lived connections and the direct string will exhaust them under normal use.

### 3. Generate three secrets

```bash
openssl rand -base64 24   # TEAM_PASSWORD  — what the team types to sign in
openssl rand -hex 32      # SESSION_SECRET — signs the session cookie
openssl rand -hex 32      # INGEST_TOKEN   — bearer token for the batch endpoint
```

Keep these in a password manager. Don't put them in Slack, and don't paste them into a chat with Claude — an env var is the only place they belong.

### 4. Import to Vercel

New Project → import the repo → framework detects as Next.js. Before deploying, add four environment variables under **Settings → Environment Variables**, for Production, Preview and Development:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the pooled Neon string |
| `TEAM_PASSWORD` | from step 3 |
| `SESSION_SECRET` | from step 3 |
| `INGEST_TOKEN` | from step 3 |

Deploy.

### 5. Create the tables and load Batch 001

Locally, with `DATABASE_URL` set:

```bash
npm install
cp .env.example .env.local     # paste your real values in
npm run db:setup               # creates the tables
npm run db:seed                # loads the six Batch 001 leads
```

Open your Vercel URL, pick your name, enter the team password.

---

## How the team uses it

- **The list** shows every lead grouped by batch, with status and owner editable inline. Changes save immediately.
- **Open a lead** for the full research brief, the email as written, and the phone script — all editable.
- **Add lead** for anything found outside a batch.
- **Activity log** shows who changed what and when.

Filters cover not-contacted, in-play, won, assigned-to-me, email-first, phone-first, and geography. The US counter on the dashboard is there because a standard batch should land at least four US leads.

---

## Letting Claude write batches in

`POST /api/leads/batch`, authenticated with `INGEST_TOKEN`:

```bash
curl -X POST https://<your-app>.vercel.app/api/leads/batch \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "batch": "Batch 002",
    "addedBy": "Claude",
    "leads": [
      {
        "company": "Example Ltd",
        "loc": "Austin, Texas, USA",
        "geo": "us",
        "site": "https://example.com",
        "who": "Jane Doe",
        "role": "Founder",
        "email": "jane@example.com",
        "estat": "VERIFIED",
        "phone": "+1 512 555 0100",
        "pstat": "VERIFIED",
        "channel": "email",
        "opp": 5,
        "buy": 8,
        "conf": "HIGH",
        "why": "…",
        "good": "…",
        "prob": "…",
        "signals": "Recent funding — 3\nHiring marketing roles — 3",
        "recent": "…",
        "angle": "…",
        "owner": "Shine Kyaw",
        "sender": "shine@astermade.com",
        "tmpl": "Template 1 — Funnel",
        "subj": "…",
        "mail": "…",
        "script": "…"
      }
    ]
  }'
```

Returns `201` when everything landed, `207` when some rows were rejected — the response lists each rejection with its index and reason, so a single malformed lead never silently disappears.

The endpoint is **insert-only**. An automated writer cannot overwrite a status a human has set, which is the failure mode worth designing against: nobody wants a research run to reset a lead someone already closed.

Cap is 50 leads per call.

---

## Security notes

Worth understanding before you widen access.

**One shared password, six named people.** Anyone with the password can sign in as any name on the roster. That is proportionate for a six-person internal tool holding public business contact data, and it means no user management to maintain. It is *not* appropriate if this ever holds customer data or if the team grows past people who all know each other — at that point, move to real accounts.

**Sessions** are HMAC-signed cookies: httpOnly, sameSite lax, secure in production, two-week expiry. The name in a session is checked against the roster on every request, so a tampered cookie fails even before the signature check would catch it.

**Passwords and tokens** are compared in constant time. A plain `===` leaks length and position through response timing.

**Every query is parameterized.** Where a query builds a dynamic column list, the column names come from a fixed whitelist in `lib/constants.ts` and only the values are bound — user input never becomes SQL.

**The ingest token is separate from the team password** on purpose. Rotating it doesn't sign anyone out, and a leaked team password can't be used to inject leads.

**No rate limiting.** For a private internal URL that's an acceptable gap, but if the URL gets shared around, put Vercel's WAF or a rate limiter in front of `/api/session` — otherwise the shared password is brute-forceable given enough time.

---

## Layout

```
app/
  page.tsx              list (server: auth check)
  lead-list.tsx         list UI
  login/page.tsx        sign in
  leads/[id]/           detail + edit; id "new" creates
  api/
    session/            sign in, sign out, whoami
    leads/              list, create
    leads/[id]/         read, update, delete
    leads/batch/        token-authenticated bulk ingest
    activity/           recent activity
lib/
  db.ts                 Neon client, parameterized query helper
  auth.ts               password check, signed sessions, ingest token
  leads.ts              validation and data access
  constants.ts          roster, statuses, writable-field whitelist
  http.ts               response helpers
db/
  schema.sql            tables and indexes
  batch-001.json        seed data
scripts/
  setup.mjs             create tables
  seed.mjs              load Batch 001
```

## Scope

Deliberately small: a leads table, a UI to work it, and one ingest endpoint. The hard part of outbound is research quality, not lead storage — that lives in the `aster-lead-engine` skill. If someone asks for email sequencing or an inbox integration, that is a different product and it should not grow out of this one.
