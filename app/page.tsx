import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import LeadList from './lead-list'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  return <LeadList me={session.name} />
}
