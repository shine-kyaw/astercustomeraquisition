import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import Editor from '../editor'

export default async function NewLeadPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  return <Editor id="new" me={session.name} />
}
