'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Wordmark } from '@/components/wordmark'
import { NewScreeningView } from '@/components/dashboard/new-screening-view'
import { HistoryView } from '@/components/dashboard/history-view'
import { AuditTrailView } from '@/components/dashboard/audit-trail-view'
import {
  runScreening,
  SCENARIOS,
  type ScreeningResult,
  type Scenario,
} from '@/core/screening'
import {
  appendEvent,
  seedLedger,
  type AuditEvent,
} from '@/core/audit'
import { cn } from '@/lib/utils'

type View = 'new' | 'history' | 'audit'

const NAV: { key: View; label: string }[] = [
  { key: 'new', label: 'New screening' },
  { key: 'history', label: 'History' },
  { key: 'audit', label: 'Audit trail' },
]

// Seed history with the three example scenarios so History/Audit read as a
// real working ledger from first load.
function seedHistory(): ScreeningResult[] {
  const ids = ['SCR-20260612-001', 'SCR-20260612-002', 'SCR-20260612-003']
  const times = [
    '2026-06-12T09:21:00Z',
    '2026-06-12T09:35:00Z',
    '2026-06-12T09:42:00Z',
  ]
  // History is newest-first.
  return SCENARIOS.map((s, i) => ({
    ...runScreening(s.input, s.overrides),
    id: ids[i],
    timestamp: times[i],
  })).reverse()
}

export function DashboardShell() {
  const [view, setView] = useState<View>('new')
  const [history, setHistory] = useState<ScreeningResult[]>(seedHistory)
  const [ledger, setLedger] = useState<AuditEvent[]>(seedLedger)

  function handleNewResult(result: ScreeningResult) {
    setHistory((prev) => [result, ...prev])
    setLedger((prev) => {
      const verdictLabel =
        result.verdict === 'NO_GO' ? 'NO_GO' : result.verdict
      const withRun = appendEvent(
        prev,
        'SCREENING_RUN',
        `${result.id} · ${result.input.product.slice(0, 40)} → ${result.input.destination}`,
      )
      return appendEvent(
        withRun,
        'VERDICT_RECORDED',
        `${result.id} · ${verdictLabel}`,
      )
    })
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground lg:flex-row">
      {/* Left rail */}
      <aside className="flex shrink-0 flex-col border-b border-hairline lg:h-screen lg:w-60 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-5 py-5 lg:block lg:space-y-0">
          <Link
            href="/"
            className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            <Wordmark />
          </Link>
        </div>
        <nav className="flex gap-1 px-3 pb-4 lg:flex-col lg:gap-0.5 lg:pt-2">
          {NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setView(item.key)}
              aria-current={view === item.key ? 'page' : undefined}
              className={cn(
                'flex items-center px-2.5 py-2 text-left font-mono text-xs uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                view === item.key
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-hairline px-5 py-4 lg:block">
          <span className="label-mono block">ruleset</span>
          <span className="mt-1 block font-mono text-[0.6875rem] text-muted-foreground">
            CSL snapshot · 2026-06-12
          </span>
        </div>
      </aside>

      {/* Workspace */}
      <main className="flex-1 overflow-x-hidden">
        {view === 'new' && <NewScreeningView onResult={handleNewResult} />}
        {view === 'history' && (
          <HistoryView history={history} onOpenAudit={() => setView('audit')} />
        )}
        {view === 'audit' && <AuditTrailView ledger={ledger} />}
      </main>
    </div>
  )
}
