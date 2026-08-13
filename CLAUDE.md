# Working on this repo with Claude

Context for any future Claude session picking this up.

## What this is

Aster's shared lead tracker. Next.js 15 App Router, Neon Postgres, deployed on Vercel.
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

`db/schema.sql` uses `create table if not exists`, so it is safe to re-run. `scripts/seed.mjs`
refuses to run when the table already has rows, so it cannot duplicate a batch or trample
statuses someone set. Both are local operations against `DATABASE_URL`.

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

No rate limiting on `/api/session`. Acceptable for a private URL; if it circulates, put
Vercel's WAF in front of it, because the shared password is otherwise brute-forceable.
