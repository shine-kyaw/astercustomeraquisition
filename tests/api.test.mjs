// End-to-end API tests: the brief's scenarios A–J against a running server.
//
//   1. DATABASE_URL=pglite:./.testdb node scripts/local-db.mjs
//   2. DATABASE_URL=pglite:./.testdb node scripts/migrate.mjs --apply
//   3. npm run build && npm start   (with DATABASE_URL, TEAM_PASSWORD, SESSION_SECRET, INGEST_TOKEN set)
//   4. node --env-file=<same env> --test tests/api.test.mjs
//
// Never point this at production: it creates, deletes and closes leads.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const PASSWORD = process.env.TEAM_PASSWORD
const TOKEN = process.env.INGEST_TOKEN
if (/vercel\.app|astermade/.test(BASE) || !String(process.env.DATABASE_URL ?? '').startsWith('pglite:')) {
  throw new Error('Refusing to run: these tests write data. Point BASE_URL at a local server on a pglite database.')
}

const today = new Date().toISOString().slice(0, 10)
const run = Date.now().toString(36)

async function signIn(name) {
  const res = await fetch(`${BASE}/api/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: PASSWORD }),
  })
  assert.equal(res.status, 200, `sign-in as ${name}`)
  return res.headers.get('set-cookie').split(';')[0]
}

function client(cookie) {
  return async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method, headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    return { status: res.status, data }
  }
}

const ingest = (payload, dry = false) =>
  fetch(`${BASE}/api/leads/batch${dry ? '?dryRun=1' : ''}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(payload),
  }).then(async (r) => ({ status: r.status, data: await r.json() }))

let lucas, shine
before(async () => {
  lucas = client(await signIn('Lucas Lin'))
  shine = client(await signIn('Shine Kyaw'))
})

const newLead = {
  company: `Juniper Kiln ${run}`, site: `https://juniperkiln-${run}.example`, geo: 'us', loc: 'Portland, Oregon, USA',
  who: 'Rae Okafor', role: 'Founder', email: `rae@juniperkiln-${run}.example`, estat: 'VERIFIED', phone: '+1 503 555 0199', pstat: 'UNKNOWN',
  opp: 5, buy: 8, conf: 'HIGH', why: 'Award-winning ceramics, broken shop link.', good: '2026 Good Design award.',
  prob: 'The Shop button returns a 404.', signals: 'Recent award — 3\nHiring marketing — 3', angle: 'Broken path to buying.',
  owner: 'Lucas Lin', sender: 'lucas@astermade.com', tmpl: 'Template 1 — Funnel', subj: 'Juniper Kiln shop link',
  mail: 'Hi Rae,\n\n…\n\nLucas', script: 'Script A\n…', note: 'Gmail draft ready', status: 'Not sent',
}
let id

async function overview() {
  const { data } = await lucas('GET', `/api/dashboard?today=${today}&scope=team`)
  return data.overview.counts
}
async function timeline() {
  const { data } = await lucas('GET', `/api/leads/${id}/events`)
  return data
}
const get = async () => (await lucas('GET', `/api/leads/${id}`)).data.lead

let baseline
test('A — a researched lead imports with its research intact and no invented outreach', async () => {
  baseline = await overview()
  const dry = await ingest({ batch: `Test ${run}`, addedBy: 'Claude', leads: [newLead] }, true)
  assert.equal(dry.data.dryRun, true)
  assert.equal(dry.data.wouldCreate.length, 1, 'preview reports the lead it would add')
  assert.equal(dry.data.created, 0, 'preview writes nothing')

  const res = await ingest({ batch: `Test ${run}`, addedBy: 'Claude', leads: [newLead] })
  assert.equal(res.status, 201)
  assert.equal(res.data.created, 1)
  id = res.data.leads[0].id

  const lead = await get()
  for (const k of ['why', 'good', 'prob', 'signals', 'angle', 'mail', 'script', 'note', 'owner', 'sender', 'tmpl']) {
    assert.equal(lead[k], newLead[k], `${k} preserved`)
  }
  assert.equal(lead.stage, 'new')
  assert.equal(lead.status, 'Not sent')
  const { events, tasks } = await timeline()
  assert.deepEqual(events.map((e) => e.type), ['imported'])
  assert.equal(tasks.open.length, 0)
  assert.equal((await overview()).contacted, baseline.contacted, 'importing does not count as contact')

  const all = await lucas('GET', '/api/leads')
  assert.ok(Array.isArray(all.data.leads) && all.data.total === undefined, 'GET /api/leads keeps its old shape for the skill')
  assert.ok(all.data.leads.some((l) => l.id === id))
})

test('B — a Gmail draft is recorded, but the lead stays unsent and no metric moves', async () => {
  const report = async () => (await lucas('GET', `/api/reports?from=${today}&to=${today}`)).data
  const before = await report()
  const r = await lucas('POST', `/api/leads/${id}/events`, { type: 'email_drafted', extRef: 'https://mail.google.com/mail/#drafts/r-123', date: today })
  assert.equal(r.status, 201)
  const lead = await get()
  assert.equal(lead.status, 'Not sent')
  assert.equal(lead.stage, 'new')
  assert.equal((await overview()).contacted, baseline.contacted)
  const after = await report()
  assert.equal(after.outreach.drafts, before.outreach.drafts + 1)
  assert.equal(after.outreach.emails, before.outreach.emails, 'a draft is not a sent email')
  assert.equal(after.funnel.contacted, before.funnel.contacted)
})

test('C — first email sent: outreach, Emailed, follow-up reminders from the skill cadence', async () => {
  const before = (await lucas('GET', `/api/reports?from=${today}&to=${today}`)).data.outreach.emails
  const r = await lucas('POST', `/api/leads/${id}/events`, { type: 'email_sent', date: today, extRef: 'https://mail.google.com/mail/#sent/abc' })
  assert.equal(r.status, 201)
  assert.equal(r.data.lead.stage, 'outreach')
  assert.equal(r.data.lead.status, 'Emailed')
  const { tasks } = await timeline()
  assert.deepEqual(tasks.open.map((t) => t.type).sort(), ['call', 'follow_up'])
  assert.equal((await overview()).contacted, baseline.contacted + 1)
  const after = (await lucas('GET', `/api/reports?from=${today}&to=${today}`)).data.outreach.emails
  assert.equal(after, before + 1)

  // Logging the same send again doesn't stack a second follow-up.
  await lucas('POST', `/api/leads/${id}/events`, { type: 'email_sent', date: today })
  const again = await timeline()
  assert.equal(again.tasks.open.filter((t) => t.type === 'follow_up').length, 1)
})

test('D — a reply stops cold reminders and gives the owner a clear next action', async () => {
  const r = await lucas('POST', `/api/leads/${id}/events`, { type: 'reply_received', date: today, summary: 'Interested, what does it cost?', meta: { kind: 'interested' } })
  assert.equal(r.data.lead.stage, 'engaged')
  assert.equal(r.data.lead.status, 'Replied')
  const { tasks } = await timeline()
  assert.deepEqual(tasks.open.map((t) => t.type), ['reply'])
  assert.equal(tasks.open[0].owner, 'Lucas Lin')
  const dash = (await lucas('GET', `/api/dashboard?today=${today}`)).data
  assert.ok(dash.attention.replies.some((t) => t.lead_id === id), 'shows under replies needing attention')
})

test('E — a booked meeting moves the pipeline and puts the meeting on the day', async () => {
  const at = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)
  const r = await lucas('POST', `/api/leads/${id}/events`, { type: 'meeting_booked', date: today, meta: { at: `${at}T10:30`, with: 'Rae' } })
  assert.equal(r.data.lead.stage, 'meeting')
  assert.equal(r.data.lead.status, 'Meeting booked')
  const { tasks } = await timeline()
  assert.deepEqual(tasks.open.map((t) => [t.type, t.due_on, t.due_time]), [['meeting', at, '10:30']])
})

test('F — a proposal records value and date and schedules its follow-up', async () => {
  const r = await lucas('POST', `/api/leads/${id}/events`, { type: 'proposal_sent', date: today, meta: { amount: 1500, currency: 'USD', package: 'blossom', url: 'https://docs.example/p1' } })
  assert.equal(r.data.lead.stage, 'proposal')
  assert.equal(Number(r.data.lead.proposal_amount), 1500)
  assert.equal(r.data.lead.proposal_sent_on, today)
  const { tasks } = await timeline()
  assert.ok(tasks.open.some((t) => t.type === 'proposal_followup'))
})

test('G — won: leaves the active pipeline, revenue shows as contract value, handoff starts', async () => {
  const before = await overview()
  const r = await shine('PATCH', `/api/leads/${id}`, { stage: 'won', deal_value: 1500, currency: 'USD', package: 'blossom' })
  assert.equal(r.status, 200)
  assert.equal(r.data.lead.stage, 'won')
  assert.equal(r.data.lead.status, 'Won')
  assert.equal(r.data.lead.deposit_status, 'pending', 'won is not paid')
  const { tasks } = await timeline()
  assert.deepEqual(tasks.open.map((t) => t.type), ['handoff'])
  const after = await overview()
  assert.equal(after.won, before.won + 1)
  assert.equal(after.active, before.active - 1)
  const dash = (await lucas('GET', `/api/dashboard?today=${today}&scope=team`)).data
  assert.ok(dash.overview.wonValue.some((m) => m.currency === 'USD' && m.amount >= 1500))
  const search = await lucas('GET', `/api/leads?q=${encodeURIComponent('Juniper Kiln ' + run)}`)
  assert.equal(search.data.total, 1, 'closed deals stay searchable')
})

test('H — re-importing an existing company is skipped and overwrites nothing', async () => {
  const beforeLead = await get()
  const beforeEvents = (await timeline()).events.length
  const res = await ingest({ batch: 'Rediscovered', leads: [{ ...newLead, company: `Juniper Kiln Ltd ${run}`, status: 'Not sent', owner: 'Myat Thit Kha' }] })
  assert.equal(res.status, 207)
  assert.equal(res.data.created, 0)
  assert.equal(res.data.duplicates.length, 1)
  const afterLead = await get()
  for (const k of ['stage', 'status', 'owner', 'deal_value', 'batch']) assert.equal(afterLead[k], beforeLead[k], `${k} untouched`)
  assert.equal((await timeline()).events.length, beforeEvents)

  // A company ruled out earlier is skipped too, and says why.
  await lucas('POST', '/api/exclusions', { company: `Sable Forge ${run}`, domain: `sableforge-${run}.example`, reason: 'Footer credits an agency', category: 'agency' })
  const ruled = await ingest({ leads: [{ company: `Sable Forge Inc ${run}`, site: `https://www.sableforge-${run}.example/about` }] })
  assert.equal(ruled.data.created, 0)
  assert.equal(ruled.data.duplicates[0].kind, 'ruled_out')

  const list = (await lucas('GET', '/api/exclusion-list')).data
  assert.ok(list.text.includes(`sableforge-${run}.example`), 'ruled-out company is on the exclusion list')
  assert.ok(list.text.includes(`juniperkiln-${run}.example`))
})

test('I — admin-only operations are refused for a member on the server, not just hidden', async () => {
  assert.equal((await lucas('DELETE', `/api/leads/${id}`)).status, 403)
  assert.equal((await lucas('PUT', '/api/settings', { monthly_capacity: 9 })).status, 403)
  const ex = (await lucas('GET', '/api/exclusions')).data.exclusions[0]
  assert.equal((await lucas('PATCH', `/api/exclusions/${ex.id}`, { revoke: true })).status, 403)
  assert.equal((await lucas('PATCH', `/api/leads/${id}`, { restore: true })).status, 403)

  // Owner can soft-delete; the lead disappears from lists but still blocks re-import.
  assert.equal((await shine('DELETE', `/api/leads/${id}`)).status, 200)
  assert.equal((await lucas('GET', `/api/leads/${id}`)).status, 404)
  const re = await ingest({ leads: [newLead] })
  assert.equal(re.data.created, 0, 'a deleted lead still blocks re-import')
  assert.equal((await shine('PATCH', `/api/leads/${id}`, { restore: true })).status, 200)
  assert.equal((await lucas('GET', `/api/leads/${id}`)).status, 200)
})

test('J — legacy data is intact after migration', async () => {
  const { data } = await lucas('GET', '/api/leads')
  const tide = data.leads.find((l) => l.company === 'Tidewater Software')
  assert.equal(tide.status, 'No fit')
  assert.equal(tide.note, 'Do not send: footer credits an outside designer')
  assert.equal(tide.stage, 'lost')
  assert.equal(tide.legacy_contacted, false, 'an auto-stamped date on a No fit lead is not contact')
  const kestrel = data.leads.find((l) => l.company === 'Kestrel Interiors Pte Ltd')
  assert.equal(kestrel.owner, 'Babullee', 'a departed owner is kept as history')
  const won = data.leads.find((l) => l.company === 'Irrawaddy Packaging Co., Ltd.')
  assert.equal(won.stage, 'won')
  assert.match(won.note, /7,350,000 MMK/)
})

test('the skill’s status PATCH path still works, and its "back to Not sent" correction voids the send', async () => {
  const { data } = await lucas('GET', '/api/leads?q=Northgate')
  const lead = data.leads[0]
  await lucas('PATCH', `/api/leads/${lead.id}`, { status: 'Not sent' }) // repeatable from any prior state
  const sent = await lucas('PATCH', `/api/leads/${lead.id}`, { status: 'Emailed', date_sent: today })
  assert.equal(sent.data.lead.stage, 'outreach')
  let tl = (await lucas('GET', `/api/leads/${lead.id}/events`)).data
  assert.ok(tl.events.some((e) => e.type === 'email_sent' && e.source === 'status'))
  assert.ok(tl.tasks.open.some((t) => t.type === 'follow_up'))

  const back = await lucas('PATCH', `/api/leads/${lead.id}`, { status: 'Not sent' })
  assert.equal(back.data.lead.stage, 'new')
  tl = (await lucas('GET', `/api/leads/${lead.id}/events`)).data
  assert.equal(tl.events.some((e) => e.type === 'email_sent'), false, 'the inferred send is voided')
  assert.equal(tl.tasks.open.length, 0, 'its reminders are cancelled')
})

test('do-not-contact is enforced on the server', async () => {
  const { data } = await lucas('GET', '/api/leads?q=Copperline')
  const lead = data.leads[0]
  await lucas('POST', `/api/leads/${lead.id}/events`, { type: 'reply_received', meta: { kind: 'no' }, summary: 'Please stop emailing.' })
  const blocked = await lucas('POST', `/api/leads/${lead.id}/events`, { type: 'email_sent' })
  assert.equal(blocked.status, 409)
  assert.equal((await lucas('PATCH', `/api/leads/${lead.id}`, { do_not_contact: false })).status, 403)
})

test('a departed teammate can’t be given new work', async () => {
  const { data } = await lucas('GET', '/api/leads?q=Fennel')
  const r = await lucas('PATCH', `/api/leads/${data.leads[0].id}`, { sender: 'victor@astermade.com' })
  assert.equal(r.status, 400)
})

test('pipeline views: no next step, needs new owner, paging', async () => {
  const nns = (await lucas('GET', `/api/leads?view=no_next_step&today=${today}`)).data
  assert.ok(nns.leads.every((l) => !l.next_task_id && ['outreach', 'engaged', 'meeting', 'mockup', 'proposal'].includes(l.stage)))
  const re = (await lucas('GET', '/api/leads?view=reassign')).data
  assert.deepEqual(re.leads.map((l) => l.company).sort(), ['Kestrel Interiors Pte Ltd', 'Victor Test Prospect'])
  const page = (await lucas('GET', '/api/leads?limit=5&offset=0&sort=company')).data
  assert.equal(page.leads.length, 5)
  assert.ok(page.total > 5)
})
