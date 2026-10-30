import { Suspense } from 'react'
import Board from './board'
import './pipeline.css'

export const metadata = { title: 'Pipeline · Aster CRM' }

export default function PipelinePage() {
  return (
    <Suspense fallback={<div className="page"><div className="phead"><div><h1>Pipeline</h1></div></div></div>}>
      <Board />
    </Suspense>
  )
}
