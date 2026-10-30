import { Suspense } from 'react'
import LeadsTable from './leads-table'
import './leads.css'

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="page" />}>
      <LeadsTable />
    </Suspense>
  )
}
