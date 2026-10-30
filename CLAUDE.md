# Working on this repo with Claude

Context for any future Claude session picking this up.

## What this is

Aster CRM (formerly the Lead Engine): the team's sales pipeline, from researched prospect to
won client. Next.js 15 App Router, Neon Postgres, deployed on Vercel.
Four runtime dependencies, no ORM, no CSS framework. Keep it that way.

- Repo: `shine-kyaw/astercustomeraquisition`
- Vercel project: `shine-kyaw-s-projects/astercustomeraquisition`
- Research standard that feeds it: the `aster-lead-engine` skill

## Deploying

**Vercel needs no separate step.** The Vercel project is connected to this GitHub repo, so
pushing to `main` triggers a production deploy automatically. There is no Vercel CLI call to
make and no Vercel token to hold anywhere. Deploy = push.

## The one thing that blocks a cloud session

A Claude session running in Anthropic's cloud sandbox reaches GitHub through a credential
proxy that is authorized **per repository**. If the repo has not been added to the session's
sources, `git push` fails with:

```
remote: access denied by the git proxy: shine-kyaw/astercustomeraquisition is not in this
session's authorized repository set, so the proxy will not inject a credential for it.
To fix, add the repository to the session's sources.
```

Read access still works, so `git ls-remote` and `git clone` succeed and only the push fails —
which makes this easy to misdiagnose as a bad remote URL or a broken commit.

Two ways through it:

1. **Authorize the repo as a source for the session.** Done by the human in the Cowork
   interface, and best done when starting the task rather than after.
2. **Run the task on the user's computer** instead of in the cloud (desktop app → the
   "Run this task" picker at the top right when starting a task). Local sessions use Shine's
   own git credentials directly, so pushes just work.

Never ask for a GitHub or Vercel token to work around this. A token pasted into a chat is
permanently in that transcript.

## Environment variables

Set in Vercel → Settings → Environment Variables, for Production, Preview and Development.
Never committed.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (host contains `-pooler`) |
| `TEAM_PASSWORD` | Shared sign-in password for the team |
| `SESSION_SECRET` | Signs the session cookie |
| `INGEST_TOKEN` | Bearer token for `POST /api/leads/batch` |

Nothing reads these at build time. A deploy with them missing will build fine and render
`/login`, then return 500 on sign-in. That is deliberate — it fails loudly instead of shipping
a silently broken database connection.

## Database changes

`db/schema.sql` (the base tables) uses `create table if not exists` and the app still creates it
on first use. **Everything after that is a numbered migration in `db/migrations/`, applied only
by `npm run db:migrate -- --apply`**, which backs up every table first, runs the file in one
transaction and checks row counts. Never make the app apply a migration on its own: Preview
deploys have shared the production `DATABASE_URL`. When you add a migration, bump
`REQUIRED_SCHEMA` in `lib/db.ts`; the app then refuses to serve (503 with instructions) until
the migration has run. Migrations only add — never drop, rename or retype a column in the same
release that stops using it. See `DEPLOY.md`.

Test against a throwaway database, never production: `DATABASE_URL=pglite:./.localdb npm run
db:local` builds a pre-migration copy with realistic shapes; then migrate it and point the app
at it. PGlite is a devDependency, loaded by a name webpack can't see, so it never ships.

## How the CRM is put together

Read `docs/CRM.md` for the why. The short version:

- **Stage, event, task are separate.** `lib/crm.ts` holds the rules as pure functions
  (`planEvent`, `statusForStage`, `eventForStatus`) and is unit-tested. `lib/events.ts` turns a
  plan into one transaction. Change behaviour in `crm.ts` and add a test.
- **The legacy `status` must keep working both ways.** The aster-lead-engine skill reads it and
  PATCHes it from Chrome; a status PATCH becomes the event it describes. `GET /api/leads` with
  no query string returns every live lead in the old shape. Don't break either.
- **Never fabricate history or metrics.** A draft is not a send; "No fit" is not contact; won is
  not paid; money is per currency. Metric definitions live next to their queries in
  `lib/dashboard.ts` and `lib/reports.ts` and are shown in the UI.
- **Admin operations are checked on the server** (`lib/roles.ts`), not by hiding buttons.
- Client components must never import `lib/leads.ts`, `lib/db.ts` or anything that does — it
  pulls the database driver into the browser bundle. `lib/crm.ts`, `lib/constants.ts`,
  `lib/keys.ts`, `lib/exclusion-list.ts` are client-safe.

Tests: `npm test` (rules), `npm run test:api` (scenarios A–J against a local server on PGlite;
it refuses to run against anything else).

## Conventions worth preserving

- **Every write goes through the whitelist** in `lib/constants.ts` (`WRITABLE_FIELDS`, `ENUMS`).
  Adding a column means adding it there too, or the API will silently ignore it.
- **Queries are always parameterized.** Where a query builds a dynamic column list, column
  names come from the whitelist and only values are bound. Do not interpolate values.
- **`/api/leads/batch` is insert-only.** An automated writer must never overwrite a status a
  human has set. Keep it that way.
- **The activity log is append-only** and survives lead deletion. That is the point of it.
- Credential comparisons use `timingSafeEqual`, not `===`.

## Known gap

Sign-in is still one shared password plus a name picked from a list, so roles stop mistakes,
not a determined insider. Failed sign-ins are rate limited (10 per address per 15 minutes).
Individual Google sign-in is the planned fix (docs/CRM.md §6). Until then, rotate
`TEAM_PASSWORD` whenever someone leaves.
