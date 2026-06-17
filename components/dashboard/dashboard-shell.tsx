'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Wordmark } from '@/components/wordmark'
import { NewScreeningView } from '@/components/dashboard/new-screening-view'
import { HistoryView } from '@/components/dashboard/history-view'
import { AuditTrailView } from '@/components/dashboard/audit-trail-view'
import { auditChainAction } from '@/app/actions'
import type { ScreeningView } from '@/core/screening/view'
import type { AuditEventView } from '@/core/audit/view'
import { cn } from '@/lib/utils'

type View = 'new' | 'history' | 'audit'

const NAV: { key: View; label: string }[] = [
  { key: 'new', label: 'New screening' },
  { key: 'history', label: 'History' },
  { key: 'audit', label: 'Audit trail' },
]

export function DashboardShell({
  initialHistory,
  initialEvents,
  initialIntact,
}: {
  initialHistory: ScreeningView[]
  initialEvents: AuditEventView[]
  initialIntact: boolean
}) {
  const [view, setView] = useState<View>('new')
  const [history, setHistory] = useState<ScreeningView[]>(initialHistory)
  const [events, setEvents] = useState<AuditEventView[]>(initialEvents)

  // Ruleset label shown in the rail — from the most recent run, else a default.
  const ruleset = history[0]?.rulesetSnapshot ?? 'No snapshot loaded'

  async function handleNewResult(result: ScreeningView) {
    setHistory((prev) => [result, ...prev])
    // Refresh the real audit ledger from the DB (the run appended 5 events).
    try {
      const chain = await auditChainAction()
      setEvents(chain.events)
    } catch {
      /* leave ledger as-is on transient error */
    }
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
            {ruleset}
          </span>
        </div>
      </aside>

      {/* Workspace */}
      <main className="flex-1 overflow-x-hidden">
        {view === 'new' && <NewScreeningView onResult={handleNewResult} />}
        {view === 'history' && (
          <HistoryView history={history} onOpenAudit={() => setView('audit')} />
        )}
        {view === 'audit' && (
          <AuditTrailView initialEvents={events} initialIntact={initialIntact} />
        )}
      </main>
    </div>
  )
}
