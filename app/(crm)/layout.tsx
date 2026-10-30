import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { roleOf } from '@/lib/roles'
import Shell from '../components/shell'

export const dynamic = 'force-dynamic'

/** Every CRM page sits inside the shell, and none renders without a session. */
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')
  return <Shell me={session.name} role={roleOf(session.name)}>{children}</Shell>
}
