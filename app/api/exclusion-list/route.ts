import { requireSession } from '@/lib/auth'
import { q } from '@/lib/db'
import { formatExclusionList } from '@/lib/exclusion-list'
import { ok, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The text behind "Copy exclusion list": every company in the app — deleted ones
 * included — plus every company ruled out and not since reconsidered. Built on the server
 * now that the list page no longer loads every lead into the browser.
 */
export async function GET() {
  return guard(async () => {
    await requireSession()
    const [leads, ruled] = await Promise.all([
      q<{ company: string; site: string }>('select company, site from leads'),
      q<{ company: string; site: string }>('select company, domain as site from exclusions where revoked_at is null'),
    ])
    const text = formatExclusionList([...leads, ...ruled])
    const count = Number(/\((\d+) compan/.exec(text)?.[1] ?? 0)
    return ok({ text, count })
  })
}
