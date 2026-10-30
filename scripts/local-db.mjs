// Build a throwaway local database that looks like production did before migration 001,
// so migrations and the app can be tested without touching real data.
//
//   DATABASE_URL=pglite:./.localdb node scripts/local-db.mjs
//
// Companies are fictional. The shapes are not: every legacy status, owners who have left,
// "No fit" leads with an auto-stamped contact date that never meant contact, "Dead" leads
// with and without one, clients won in MMK, and a Batch 001 seed marker.
import { readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { connect, splitStatements } from './dbclient.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env.DATABASE_URL ?? ''
if (!url.startsWith('pglite:')) {
  console.error('Refusing to run: this script only builds a local PGlite database (DATABASE_URL=pglite:<dir>).')
  process.exit(1)
}
rmSync(url.slice('pglite:'.length), { recursive: true, force: true })

const db = await connect()
for (const text of splitStatements(readFileSync(join(here, '..', 'db', 'schema.sql'), 'utf8'))) {
  await db.query(text)
}

const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
const L = (o) => ({
  batch: 'Batch 002', loc: 'Austin, Texas, USA', geo: 'us', site: '', biz: 'Specialty food maker.',
  who: '', role: 'Founder', email: '', estat: 'UNKNOWN', phone: '', pstat: 'UNKNOWN', channel: 'email',
  opp: 4, buy: 7, conf: 'MEDIUM', why: 'Strong product, dated site.', good: '42 five-star reviews.',
  prob: 'Booking button returns a 404.', signals: 'Hiring marketing roles — 3\nActive social — 2',
  recent: '', angle: 'Lead with the broken booking path.', owner: 'Shine Kyaw', sender: 'mtk@astermade.com',
  tmpl: 'Template 1 — Funnel', subj: '', mail: '', script: '', note: '', status: 'Not sent',
  date_sent: null, reply: '', created_days_ago: 20, ...o,
})

const leads = [
  L({ company: 'Fennel & Fig Bakery', site: 'https://fennelfig.example', who: 'Dana Reyes', email: 'dana@fennelfig.example', estat: 'VERIFIED', phone: '+1 512 555 0101', status: 'Not sent', note: 'Gmail draft ready', created_days_ago: 3, tmpl: 'Template 3 — Skipped over', subj: 'Congrats on the Good Food Award', mail: 'Hi Dana,\n\nCongrats on the Good Food Award…\n\nShine' }),
  L({ company: 'Northgate Joinery Ltd', site: 'https://northgatejoinery.example', geo: 'uk', loc: 'Leeds, UK', who: 'Tom Hale', email: 'tom@northgatejoinery.example', estat: 'VERIFIED', status: 'Not sent', created_days_ago: 31, note: 'Draft in mtk@ (not yet sent)' }),
  L({ company: 'Copperline Coffee', site: 'https://copperline.example', who: 'Ari Patel', email: 'ari@copperline.example', estat: 'VERIFIED', phone: '+1 808 555 0144', status: 'Emailed', date_sent: day(2), owner: 'Lucas Lin' }),
  L({ company: 'Harbour Fleet Systems', site: 'https://harbourfleet.example', geo: 'uk', who: 'Marc Lee', email: 'admin@harbourfleet.example', status: 'Called', date_sent: day(6), owner: 'Xiao Long Hein', channel: 'phone', phone: '+44 1273 555 888' }),
  L({ company: 'Saltmarsh Pickles', site: 'https://saltmarsh.example', who: 'Lee Moss', email: 'lee@saltmarsh.example', estat: 'PATTERN-CONFIRMED', status: 'Follow-up 1', date_sent: day(9), owner: 'Shine Kyaw' }),
  L({ company: 'Old Mill Ciderworks', site: 'https://oldmillcider.example', status: 'Follow-up 2', date_sent: day(40), owner: 'Myat Thit Kha' }),
  L({ company: 'Brightwater Dental', site: '', geo: 'other', loc: 'Singapore', who: 'Dr. Tan', phone: '+65 9000 1234', channel: 'phone', status: 'Replied', date_sent: day(12), reply: 'Interested, asked for prices.', owner: 'Xiao Long Hein' }),
  L({ company: 'Kestrel Interiors Pte Ltd', site: 'https://kestrelinteriors.example', geo: 'other', loc: 'Singapore', who: 'James Lim', email: 'contact@kestrelinteriors.example', status: 'Not sent', owner: 'Babullee', sender: 'babullee@astermade.com', batch: 'SG Interior & Renovation 2026-10-24', note: 'Draft in mtk@ (not yet sent, signed Babullee)' }),
  L({ company: 'Lantern Clinic', site: 'https://lanternclinic.example', geo: 'tw', loc: 'Taipei, Taiwan', status: 'Dead', date_sent: day(60), owner: 'Babullee', sender: 'babullee@astermade.com', batch: 'Batch 2026-08-21 TW' }),
  L({ company: 'Meadowlark Studio', site: 'https://meadowlark.example', status: 'Meeting booked', date_sent: day(15), owner: 'Shine Kyaw', reply: 'Booked a call for Thursday.' }),
  L({ company: 'Tidewater Software', site: 'https://tidewater.example', status: 'No fit', date_sent: day(25), owner: 'Shine Kyaw', note: 'Do not send: footer credits an outside designer' }),
  L({ company: 'Gable & Grain', site: 'https://gablegrain.example', status: 'Dead', date_sent: null, owner: '' }),
  L({ company: 'Irrawaddy Packaging Co., Ltd.', site: 'https://irrawaddypack.example', geo: 'other', loc: 'Yangon, Myanmar', status: 'Won', date_sent: day(90), owner: 'Shine Kyaw', note: 'Corporate site + CMS. Contract 7,350,000 MMK.' }),
  L({ company: 'Victor Test Prospect', site: 'https://victortest.example', status: 'Emailed', date_sent: day(30), owner: 'Victor Huang', sender: 'victor@astermade.com' }),
]

for (const lead of leads) {
  const { created_days_ago, ...row } = lead
  const cols = Object.keys(row)
  await db.query(
    `insert into leads (id, ${cols.join(', ')}, created_at, updated_at, created_by, updated_by)
     values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}, now() - ($${cols.length + 2} || ' days')::interval, now() - ($${cols.length + 2} || ' days')::interval, 'Claude', 'Claude')`,
    [randomUUID(), ...cols.map((c) => row[c]), String(created_days_ago)]
  )
}
// The bootstrap's seed marker, so the app doesn't load Batch 001 on top.
await db.query("insert into activity (who, action) values ('Claude', 'seeded Batch 001 — 0 leads')")
await db.query("insert into activity (who, action) values ('Shine Kyaw', 'signed in')")

const [{ c }] = await db.query('select count(*)::int as c from leads')
console.log(`Local database ready at ${url.slice(7)}: ${c} legacy leads, schema version 0 (not migrated).`)
await db.close()
