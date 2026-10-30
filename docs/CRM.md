# Aster CRM — audit, architecture and roadmap

Written October 2026, when the Lead Engine became Aster CRM. The code is the source of truth;
this explains why it is shaped the way it is.

## 1. What existed (the audit)

The Lead Engine was a shared prospect tracker: one `leads` table of ~40 columns, an append-only
`activity` audit log, a shared-password sign-in, an insert-only ingest endpoint for researched
batches (`/api/leads/batch`, `/api/leads/import`), duplicate detection on normalised domain and
company name (`lib/keys.ts`, `findDuplicate`), and a copy-exclusion-list button.

**Worth keeping, and kept:** the research fields (the most valuable asset in the system), the
write whitelist, parameterised SQL everywhere, the insert-only ingest, the append-only audit log,
constant-time credential checks, and the four-dependency footprint.

**The structural problem:** one `status` field meant four things at once: what we did (Emailed,
Called), how they responded (Replied), where the deal is (Meeting booked), and how it ended (Won,
No fit, Dead). A lead could only be in one of them, so history was overwritten on every change,
there was no next step anywhere, and no number on the old dashboard could be trusted. "Contacted"
counted any status other than "Not sent", which includes "No fit" leads that were never emailed.

**Risks found:**
- Preview deploys share the production `DATABASE_URL`, and the app created its schema on first
  request. Any schema change on any branch would have migrated production.
- No rate limit on sign-in; a shared password with a self-chosen name; deleted leads vanished,
  so they could be re-imported and re-pitched.
- The whole lead list was loaded into the browser.

## 2. Separation of responsibilities

| Layer | Owns | Lives in |
|---|---|---|
| Sales skill (`aster-lead-engine`) | Qualification, research standards, templates, scripts, cadence | The skill |
| CRM | Where every lead is, who owns it, what happened, what's next | This repo |
| Integrations | Gmail, Calendar, Contact Log sync | Phased, see §6 |

The CRM never copies the skill's rules. It enforces the parts that are about *data*: the cadence
(call day 1, one follow-up day 3, then stop), "a draft is not a send", "status must be true",
the 14-day re-verification flag, and do-not-contact.

## 3. Data model

Additive, in `db/migrations/001_crm_foundation.sql`. Nothing dropped, renamed or retyped.

- **leads**: unchanged columns, plus the opportunity (stage, lost_reason, priority, deal_value,
  currency, package, expected_close, next_step), mockup and proposal tracking, handoff fields,
  do-not-contact, research dates, soft delete, and `legacy_contacted` (a one-off snapshot).
  One current deal per company. A separate opportunities table pays off only once companies
  buy repeatedly; it's on the roadmap, not built speculatively.
- **events**: the dated timeline (what happened). `source` says where it came from: `manual`,
  `status` (inferred from a legacy status change), `import`, `system`, `migration`. Mistakes are
  voided, never deleted.
- **tasks**: what must happen next. `auto_key` makes automated reminders idempotent.
- **exclusions**: companies ruled out (replaces the "companies already ruled out" project doc).
  Never deleted; reconsidering sets `revoked_at`.
- **settings**: package reference prices and thresholds.
- **activity** (existing): still the audit log of edits and sign-ins.

**Stages:** New → Outreach → Engaged → Meeting → Mockup → Proposal → Won / Closed. Discovery
was folded into Meeting and Negotiation into Proposal: for a six-projects-a-month studio, extra
columns were overhead with no decision attached to them.

**Legacy status stays in step both ways** (`lib/crm.ts`), because the skill reads and PATCHes it:
a status PATCH is translated into the event it describes (Emailed → email sent, back to Not sent
→ voids the inferred send), and stage moves update the status only where it would otherwise
contradict the stage. Moving a card to Outreach without logging a send leaves "Not sent" alone,
because the skill uses "Not sent" to find leads to email.

**Migration backfill invents no history.** Stage comes from the current status. Each lead gets
one "Carried over" timeline entry dated at migration time saying what it was and that earlier
dates weren't recorded. No email-sent event is fabricated from a `date_sent`, which the old UI
stamped automatically on any status change, including "No fit".

## 4. Metric definitions

Defined once in `lib/dashboard.ts` and `lib/reports.ts`, returned with the data, and shown next
to every number. In short:

- **Contacted** = at least one outreach action actually performed (email or follow-up sent, call,
  voicemail, message). Drafts and stage moves never count. Before migration, only statuses that
  prove contact count; "No fit" never does.
- **Won** = agreed. Deposit status records cash separately. Revenue is per currency, never
  converted (deals are in USD and MMK).
- **Pipeline value** = deal values on Engaged-onward leads. Package reference prices are shown
  only as a labelled estimate.
- **Reports by period** use dated events only, so they begin at migration; the page says so.

## 5. Security

Done in this phase:
- Server-side role checks (`lib/roles.ts`) for delete, restore, settings, reconsidering a
  ruled-out company, clearing do-not-contact, and voiding others' entries.
- Soft delete; deleted leads still block re-import and stay on the exclusion list.
- Do-not-contact enforced on the server for every outreach type.
- Sign-in rate limit (10 failures per address per 15 minutes; addresses stored hashed).
- Departed staff can't sign in, can't be assigned, and their mailboxes can't be chosen.
- Migrations are explicit and refuse-to-serve until applied.

**The honest limit:** while sign-in is a shared password plus a name picked from a list, a role
is only as trustworthy as that pick. Role checks stop mistakes, not a determined insider. The
real fix is individual Google sign-in (P2). Until then, **rotate `TEAM_PASSWORD` whenever someone
leaves** (Victor and Babullee have; it should be rotated now).

## 6. Integrations (phased)

**Contact Log (Google Sheet).** It is still the master record of everyone contacted, including
clients and outreach that never touched the app.
- *Phase A (now):* the CRM stays compatible; nothing about the sheet changes. Use
  `scripts/contact-log-reconcile.mjs` (read-only) to see exactly where the two disagree: rows only
  in the sheet (clients, manual outreach, dead leads, which should go into Ruled out so no batch
  rediscovers them), rows only in the app, and status mismatches.
- *Phase B:* a sync job keyed on normalised domain/company. CRM → sheet appends and updates
  owned columns only, never deletes, writes a sync log, idempotent. Needs a Google service
  account with edit access to that one sheet.
- *Phase C:* only after B has run cleanly for a few weeks: propose the CRM as primary with the
  sheet as a synced view. Not without Shine's approval.

**Gmail.** Today: paste the Gmail draft/thread link when logging (stored on the event), and the
skill keeps drafting in Gmail. Next: per-user Google OAuth (gmail.readonly + gmail.compose),
tokens encrypted server-side only, to (1) attach draft ids, (2) detect real sends from the Sent
folder, (3) detect replies, each deduplicated by Gmail message id. Never sends automatically.

**Google sign-in.** Auth.js (one maintained library) with Google as provider, restricted to
`astermade.com`, plus an allowlist and roles in a `users` table, since an `@astermade.com` address
alone shouldn't grant access. Needs a Google Cloud OAuth client created by Shine.

## 7. Roadmap

**P0 — done in this branch.** Data model, pipeline, timeline, tasks and cadence automation,
ruled-out list, import preview, migration tooling, role checks, rate limiting, tests.

**P1 — done in this branch (UI).** Today dashboard, pipeline board, rebuilt lead page with
timeline/outreach/deal tabs, tasks, activity feed, reports, settings, command palette.

**P2 — next, in order of value.**
1. Google sign-in with per-person accounts and a `users` table (unlocks real permissions; needs
   the OAuth client).
2. Contact Log Phase B sync (needs a service account).
3. Gmail send/reply detection (needs OAuth consent).
4. A daily summary email or Discord message from the dashboard data (needs a cron and a webhook).
5. Calendar: create the meeting from "Meeting booked".

**P3 — later.** Separate opportunities table for repeat clients; research-freshness re-check
workflow driven by the skill; forecasting once there are a few months of events.
