import { requireSession } from '@/lib/auth'
import { listLeads, createLead, sanitize } from '@/lib/leads'
import { ok, fail, guard } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return guard(async () => {
    await requireSession()
    return ok({ leads: await listLeads() })
  })
}

export async function POST(req: Request) {
  return guard(async () => {
    const session = await requireSession()
    const body = await req.json().catch(() => null)
    const { patch, errors } = sanitize(body)

    if (errors.length) return fail('Some fields were rejected', 400, { errors })
    if (!patch.company || !String(patch.company).trim()) {
      return fail('A lead needs a company name', 400)
    }

    return ok({ lead: await createLead(patch, session.name) }, 201)
  })
}
