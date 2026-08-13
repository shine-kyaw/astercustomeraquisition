import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import Editor from './editor'

export const dynamic = 'force-dynamic'

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { id } = await params
  return <Editor id={id} me={session.name} />
}
