import { requireSession } from '@/lib/auth'
import { getSettings, saveSettings, cleanSettings } from '@/lib/settings'
import { requireCan } from '@/lib/roles'
import { logActivity } from '@/lib/leads'
import { ok, fail, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return guard(async () => {
    await requireSession()
    return ok({ settings: await getSettings() })
  })
}

export async function PUT(req: Request) {
  return guard(async () => {
    const session = await requireSession()
    requireCan(session, 'settings')
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return fail('Body must be an object', 400)
    const { values, errors } = cleanSettings(body)
    if (errors.length) return fail(errors.join('; '), 400)
    const settings = await saveSettings(values, session.name)
    await logActivity(null, session.name, `changed settings (${Object.keys(values).join(', ')})`)
    return ok({ settings })
  })
}
