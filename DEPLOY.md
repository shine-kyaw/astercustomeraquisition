# Deploying Aster CRM (the `crm-foundation` branch)

This release changes the database. Do these steps in order. The whole thing takes about
fifteen minutes, and the only moment the app is unavailable is between steps 4 and 5.

## 0. Before you start

- [ ] **Separate the preview database.** Today Vercel's *Preview* environment uses the
      production `DATABASE_URL`. In Neon, create a branch of the production database (Neon →
      Branches → New branch, from `main`). In Vercel → Settings → Environment Variables, set
      `DATABASE_URL` **for Preview only** to that branch's pooled connection string. Then a pushed
      branch can be tested on its preview URL without touching real data.
- [ ] **Rotate `TEAM_PASSWORD`.** Two people have left. Vercel → Settings → Environment
      Variables → `TEAM_PASSWORD` → new value (`openssl rand -base64 24`), for all environments.
      Tell the team the new one in person or by password manager, never in chat.

## 1. Try it on the preview

- [ ] Push the branch: `git push origin crm-foundation`. Vercel builds a preview.
- [ ] Run the migration against the **Neon branch** (not production). In a local `.env.local`
      put the branch's connection string as `DATABASE_URL`, then:
      ```bash
      npm run db:migrate            # dry run: lists what would apply, changes nothing
      npm run db:migrate -- --apply # backs up every table to ./backups, then applies
      ```
      It prints row counts before and after; every table must have at least as many rows.
- [ ] Open the preview URL, sign in, and walk through: Today, Leads, a lead's page, log an
      email as sent, Pipeline drag, Tasks, Reports.

## 2. Back up production

- [ ] Put the **production** pooled connection string in `.env.local`.
- [ ] `npm run db:backup`, which writes every table to `./backups/backup-<time>.json`. Keep it.
- [ ] Note the time. Neon's point-in-time restore can also return to it.

## 3. Migrate production

- [ ] `npm run db:migrate`: dry run, expect `001_crm_foundation`.
- [ ] `npm run db:migrate -- --apply`. Expect "Migration complete", no table with fewer rows,
      and "Leads whose stage disagrees with their status: 0".

The live (old) app keeps working on the migrated database: the change only adds things.

## 4. Deploy

- [ ] Merge `crm-foundation` into `main` and push. Vercel deploys in about a minute.

## 5. Check

- [ ] Sign in. Today loads. Leads shows every company. Open three leads and check research,
      email and script are intact.
- [ ] Copy exclusion list still copies every company.
- [ ] From Chrome, the skill's `fetch('/api/leads')` returns `{ leads: [...] }` as before.

## If something is wrong

- **The app says the database needs migrating (503):** step 3 didn't run against this database.
  Run it.
- **Roll back the code:** Vercel → Deployments → the previous production deployment → Promote.
  The migrated database works with the old code, so no database rollback is needed for this.
- **Roll back the data:** Neon → Branches → restore `main` to the time noted in step 2. The JSON
  backup is the second copy. Don't do this casually: it discards anything written since.
