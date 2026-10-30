# Suggested changes to the `aster-lead-engine` skill

The skill is the authority on sales rules; the CRM doesn't change it. These are the edits that
keep it in step with the roster change and let it use what the CRM now offers. Nothing here
changes a template, script or qualification rule. Apply them where the skill is maintained.

## 1. Roster (needed now)

Victor Huang and Babullee have left; Astrid has joined (`astrid@astermade.com`).

- **"Decisions you make yourself → Sign-off names":** replace "Shine, Myat (…), Xiaolong (…),
  Lucas, Victor, Babullee" with "Shine, Myat (Myat Thit Kha, "MTK"), Xiaolong (Xiao Long Hein),
  Lucas, Astrid".
- **"Before you start", question 1:** the roster becomes "Shine Kyaw, Myat Thit Kha, Xiao Long
  Hein, Lucas Lin, Astrid". Drop the "(Victor Huang and Babullee only once their mailboxes are
  confirmed live)" clause.
- **"Output → Allowed values":** `owner` adds `Astrid`; `sender` adds `astrid@astermade.com`.
  The CRM now **rejects** `Victor Huang`, `Babullee`, `victor@` and `babullee@` as a new owner or
  sender, so a batch using them would have those leads rejected at import.
- **"Sender assignment":** live mailboxes become `shine@`, `mtk@`, `xiaolong@`, `lucas@`,
  `astrid@`. Remove the sentences about `victor@` and `babullee@` being planned, and the note that
  the Babullee name is valid for sign-offs.
- **Open item:** three Singapore leads (Charlotte's Carpentry, BStudio, The Interior Place) are
  owned by Babullee with drafts in `mtk@` signed "Babullee". The CRM flags them "Needs a new
  owner". Whoever takes them must re-sign the drafts before anything is sent.

## 2. Use the CRM's new endpoints (recommended)

All from the signed-in CRM tab in Chrome, like the existing `fetch('/api/leads')`.

- **Record a send with its real date.** After confirming a send in Gmail's Sent folder, instead
  of only `PATCH /api/leads/<id> { status: 'Emailed' }`, prefer:
  `POST /api/leads/<id>/events { type: 'email_sent', date: 'YYYY-MM-DD', extRef: '<Gmail thread link>' }`.
  It sets the same status and also schedules the day-1 call and day-3 follow-up for the owner.
  (The status PATCH still works and is translated into the same event.)
- **Record drafts honestly.** `POST /api/leads/<id>/events { type: 'email_drafted', extRef: '<draft id or link>' }`.
  The lead stays "Not sent"; nothing counts as contact.
- **Replies.** `POST /api/leads/<id>/events { type: 'reply_received', summary: '<one line>', meta: { kind } }`
  with `kind` one of `interested`, `question`, `wrong_person`, `not_now`, `no`. This follows the
  skill's reply table: `no` marks the lead do-not-contact, `not_now` closes it with a
  three-month retry.
- **Step 12, "Record what you rejected".** `POST /api/exclusions { rows: [{ company, domain, reason, category, source }] }`.
  Ruled-out companies go straight onto the exclusion list and are skipped at import, so the
  project doc "Lead Engine — companies already ruled out" can be retired once its contents are
  moved in (the Ruled out page has a "Paste a list" button for that).
- **Exclusion list.** `GET /api/exclusion-list` returns the text the button copies. It now also
  includes ruled-out companies and deleted leads.
- **Import preview.** `POST /api/leads/import { text, dryRun: true }` (or `/api/leads/batch?dryRun=1`)
  runs every check and writes nothing, so a batch's duplicates show up before import.
- **Follow-ups due today** ("At the start of each session, list the follow-ups due that day"):
  `GET /api/tasks?owner=all&due=today` and `&due=overdue`.

## 3. Not changing

Statuses and their meanings, the JSON batch format, the insert-only import, and every template
and script stay as they are.
