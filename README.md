# Aster CRM

Aster's sales pipeline, from researched prospect to won client (formerly the Lead Engine). Next.js on Vercel, Neon Postgres, no ORM, four runtime dependencies.

Everyone on the team works the same pipeline. Every action is dated, attributed and kept. Claude can write researched batches straight in over an authenticated endpoint. Architecture and roadmap: [docs/CRM.md](docs/CRM.md). Releasing a database change: [DEPLOY.md](DEPLOY.md).

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
npm run db:migrate -- --apply  # applies db/migrations (backs up first)
```

Open your Vercel URL, pick your name, enter the team password.

---

## How the team uses it

- **Today** answers "what needs me today?": replies waiting, overdue and due follow-ups, meetings, proposals awaiting a decision, and active deals with no next step.
- **Leads** is every company, searchable and filterable, with saved views (mine, no next step, overdue, research older than 14 days, needs a new owner). Import batches here, with a "check first" preview.
- **Pipeline** is the board: New → Outreach → Engaged → Meeting → Mockup → Proposal → Won / Closed.
- **A lead's page** shows the next action and contact details first, then the timeline, the email and script as written, the research, tasks, and deal details.
- **Log activity** records what actually happened (email sent, call, reply, meeting, proposal, won). Logging a send schedules the skill's cadence: a call on day 1 and one follow-up on day 3. A reply, meeting or close cancels what no longer applies. A draft never counts as a send.
- **Tasks**, **Activity**, **Reports** and **Ruled out** (companies researched and rejected, which stay off every future batch) do what they say. Ctrl+K searches everything.

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

**One shared password, named people.** Anyone with the password can sign in as any name on the roster, so the server-side role checks (delete, restore, settings, reconsidering a ruled-out company, lifting do-not-contact) stop mistakes, not a determined insider. Now that the app holds deal values and client conversations, individual Google sign-in is the next priority (docs/CRM.md). Until then, rotate `TEAM_PASSWORD` whenever someone leaves. People who have left can't sign in under their own name.

**Sessions** are HMAC-signed cookies: httpOnly, sameSite lax, secure in production, two-week expiry. The name in a session is checked against the roster on every request, so a tampered cookie fails even before the signature check would catch it.

**Passwords and tokens** are compared in constant time. A plain `===` leaks length and position through response timing.

**Every query is parameterized.** Where a query builds a dynamic column list, the column names come from a fixed whitelist in `lib/constants.ts` and only the values are bound — user input never becomes SQL.

**The ingest token is separate from the team password** on purpose. Rotating it doesn't sign anyone out, and a leaked team password can't be used to inject leads.

**Sign-in is rate limited:** ten wrong passwords from one address in 15 minutes locks that address out for the rest of the window. Addresses are stored hashed.

**Deletes are soft** and admin-only. A deleted lead keeps blocking re-import and stays on the exclusion list, so deleting can never cause a company to be pitched twice.

**Do-not-contact is enforced on the server.** Once a lead says stop, no outreach can be logged against it, whatever the client sends.

---

## Layout

```
app/
  (crm)/                pages inside the app shell: Today, leads, pipeline, tasks,
                        activity, reports, ruled-out, settings
  components/           shell, design-system pieces, log-activity dialog, api client
  login/page.tsx        sign in
  api/                  JSON endpoints (see docs/CRM.md); /api/leads keeps its old shape
lib/
  crm.ts                stages, events, tasks: the pipeline rules (pure, unit-tested)
  events.ts             records an event and applies its effects in one transaction
  leads.ts tasks.ts exclusions.ts settings.ts dashboard.ts reports.ts
  db.ts                 Neon (or local PGlite) client; refuses an unmigrated database
  auth.ts roles.ts      sessions, ingest token, server-side permissions
  constants.ts keys.ts  roster, field whitelist, duplicate keys
db/
  schema.sql            base tables
  migrations/           numbered, applied only by `npm run db:migrate -- --apply`
scripts/                migrate, backup, local test database, Contact Log reconciliation
tests/                  rule tests and end-to-end API scenarios
```

## Scope

A CRM for a small studio, not an enterprise one. Research quality, qualification and templates live in the `aster-lead-engine` skill. The CRM holds the data and the discipline: who owns what, what happened, what's next. It drafts nothing and sends nothing on its own.
