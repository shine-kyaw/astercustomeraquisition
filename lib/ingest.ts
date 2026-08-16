import { createLead, sanitize, logActivity, findDuplicate, companyKey, siteKey } from './leads'

export const MAX_LEADS_PER_BATCH = 50

export type IngestResult = {
  created: number
  duplicates: { index: number; company: string; existing: string; batch: string; status: string }[]
  rejected: { index: number; company?: string; reason: string }[]
  leads: unknown[]
}

/**
 * Accept a researched batch.
 *
 * Shared by the token-authenticated API endpoint and the in-app paste importer, so both
 * apply exactly the same validation and duplicate rules. Insert-only by design: an
 * incoming batch can add leads but never overwrite a status a human has already set.
 */
export async function ingestBatch(
  leads: unknown[],
  opts: { batch?: string; addedBy?: string }
): Promise<IngestResult> {
  const batch = String(opts.batch ?? '').trim()
  const addedBy = String(opts.addedBy ?? 'Claude').slice(0, 120)

  const created: unknown[] = []
  const duplicates: IngestResult['duplicates'] = []
  const rejected: IngestResult['rejected'] = []

  // Collisions inside a single payload need catching separately — neither copy is in the
  // database yet when the first one is checked.
  const seen = new Map<string, number>()

  for (let i = 0; i < leads.length; i++) {
    const { patch, errors } = sanitize(leads[i])

    if (errors.length) { rejected.push({ index: i, reason: errors.join('; ') }); continue }
    if (!patch.company || !String(patch.company).trim()) {
      rejected.push({ index: i, reason: 'missing company name' })
      continue
    }

    const company = String(patch.company)
    const key = siteKey(patch.site) || companyKey(company)

    if (key && seen.has(key)) {
      duplicates.push({
        index: i, company,
        existing: `appears twice in this batch (also at position ${(seen.get(key) ?? 0) + 1})`,
        batch: '', status: '',
      })
      continue
    }

    // With several people researching at once, the same prospect will get found twice.
    // Inserting both would mean two of the team emailing one founder in the same week.
    const existing = await findDuplicate(company, patch.site)
    if (existing) {
      duplicates.push({
        index: i, company,
        existing: existing.company, batch: existing.batch, status: existing.status,
      })
      continue
    }

    if (key) seen.set(key, i)
    if (batch) patch.batch = batch
    if (patch.seq == null) patch.seq = created.length + 1

    try {
      created.push(await createLead(patch, addedBy))
    } catch (e) {
      rejected.push({ index: i, company, reason: (e as Error).message })
    }
  }

  await logActivity(
    null,
    addedBy,
    `imported ${created.length} lead${created.length === 1 ? '' : 's'}` +
      (batch ? ` into ${batch}` : '') +
      (duplicates.length ? ` — ${duplicates.length} skipped as duplicates` : '') +
      (rejected.length ? ` — ${rejected.length} rejected` : '')
  )

  return { created: created.length, duplicates, rejected, leads: created }
}

/**
 * Pull the first balanced JSON object or array out of surrounding prose.
 * Tracks string state so a brace inside an email body doesn't throw off the depth count —
 * which matters here, because lead records contain long free text.
 */
function extractJson(text: string): string | null {
  const start = text.search(/[[{]/)
  if (start === -1) return null

  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Parse whatever the user pasted. Accepts a bare array, a `{ leads: [...] }` object, or
 * that object wrapped in a markdown code fence — because copying from a chat window
 * usually brings the fence along, and failing on that would be a pointless obstacle.
 */
export function parsePastedBatch(
  raw: string
): { ok: true; leads: unknown[]; batch?: string; addedBy?: string } | { ok: false; error: string } {
  let text = String(raw ?? '').trim()
  if (!text) return { ok: false, error: 'Nothing pasted.' }

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // People rarely paste cleanly — there is usually a sentence before or after the block.
    // Pull out the first balanced { … } or [ … ] rather than making them tidy it up.
    const extracted = extractJson(text)
    if (extracted === null) {
      return {
        ok: false,
        error: 'No JSON found. Copy the whole block Claude produced, including the outer { } or [ ].',
      }
    }
    try {
      parsed = JSON.parse(extracted)
    } catch (e) {
      return {
        ok: false,
        error: `That JSON is malformed (${(e as Error).message}). Copy the whole block again.`,
      }
    }
  }

  const payload: { leads?: unknown[]; batch?: string; addedBy?: string } = Array.isArray(parsed)
    ? { leads: parsed }
    : (parsed as { leads?: unknown[]; batch?: string; addedBy?: string })

  if (!payload || !Array.isArray(payload.leads)) {
    return { ok: false, error: 'No leads found. Expected an array of leads, or { "leads": [ ... ] }.' }
  }
  if (!payload.leads.length) return { ok: false, error: 'The batch is empty.' }
  if (payload.leads.length > MAX_LEADS_PER_BATCH) {
    return { ok: false, error: `A batch is capped at ${MAX_LEADS_PER_BATCH} leads; that one has ${payload.leads.length}.` }
  }

  return { ok: true, leads: payload.leads, batch: payload.batch, addedBy: payload.addedBy }
}
