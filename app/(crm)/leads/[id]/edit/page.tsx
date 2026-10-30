import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import Editor from '../../editor'

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) redirect('/login')
  return <Editor id={id} me={session.name} />
}
