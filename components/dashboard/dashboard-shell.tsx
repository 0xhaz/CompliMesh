'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Wordmark } from '@/components/wordmark'
import { WorkspaceProvider, useWorkspace } from '@/components/dashboard/workspace-context'
import { OverviewView } from '@/components/dashboard/overview-view'
import { NewScreeningView } from '@/components/dashboard/new-screening-view'
import { CustomersView } from '@/components/dashboard/customers-view'
import { ReviewQueueView } from '@/components/dashboard/review-queue-view'
import { BatchView } from '@/components/dashboard/batch-view'
import { IntegrationsView } from '@/components/dashboard/integrations-view'
import { AuditTrailView } from '@/components/dashboard/audit-trail-view'
import { reviewQueueAction } from '@/app/actions'
import type { Workspace } from '@/core/tenancy'
import { cn } from '@/lib/utils'

type View = 'overview' | 'new' | 'customers' | 'review' | 'batch' | 'integrations' | 'audit'

const NAV: { key: View; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'new', label: 'New screening' },
  { key: 'customers', label: 'Customers' },
  { key: 'review', label: 'Review queue' },
  { key: 'batch', label: 'Batch' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'audit', label: 'Audit trail' },
]

function ShellInner() {
  const ws = useWorkspace()
  const [view, setView] = useState<View>('overview')
  const [pendingCount, setPendingCount] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    reviewQueueAction(ws.org.id)
      .then((rows) => alive && setPendingCount(rows.length))
      .catch(() => alive && setPendingCount(null))
    return () => {
      alive = false
    }
  }, [ws.org.id, ws.version])

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground lg:flex-row">
      {/* Left rail */}
      <aside className="flex shrink-0 flex-col border-b border-hairline lg:h-screen lg:w-64 lg:border-b-0 lg:border-r">
        <div className="px-5 py-5">
          <Link
            href="/"
            className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            <Wordmark />
          </Link>
        </div>

        {/* Org + switchers */}
        <div className="flex flex-col gap-3 border-y border-hairline px-5 py-4">
          <div>
            <span className="label-mono block">organization</span>
            <span className="mt-1 block font-mono text-xs text-foreground">{ws.org.name}</span>
            <span className="font-mono text-[0.625rem] uppercase tracking-widest text-muted-foreground">
              {ws.org.kind}
            </span>
          </div>

          <label className="flex flex-col gap-1">
            <span className="label-mono">acting as</span>
            <select
              value={ws.activeUser.id}
              onChange={(e) => ws.setActiveUserId(e.target.value)}
              className="border border-ink/15 bg-background px-2 py-1.5 font-mono text-xs text-foreground focus-visible:border-accent focus-visible:outline-none"
            >
              {ws.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="label-mono">client account</span>
            <select
              value={ws.activeClient.id}
              onChange={(e) => ws.setActiveClientId(e.target.value)}
              className="border border-ink/15 bg-background px-2 py-1.5 font-mono text-xs text-foreground focus-visible:border-accent focus-visible:outline-none"
            >
              {ws.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <nav className="flex flex-wrap gap-1 px-3 py-3 lg:flex-col lg:gap-0.5">
          {NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setView(item.key)}
              aria-current={view === item.key ? 'page' : undefined}
              className={cn(
                'flex items-center justify-between px-2.5 py-2 text-left font-mono text-xs uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                view === item.key
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span>{item.label}</span>
              {item.key === 'review' && pendingCount ? (
                <span
                  className={cn(
                    'ml-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.625rem]',
                    view === item.key ? 'bg-accent-foreground text-accent' : 'bg-review/15 text-review',
                  )}
                >
                  {pendingCount}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="mt-auto hidden flex-col gap-2 border-t border-hairline px-5 py-4 lg:flex">
          <Link
            href="/dashboard/audit-export"
            target="_blank"
            className="font-mono text-[0.6875rem] uppercase tracking-widest text-accent underline-offset-4 hover:underline"
          >
            Export audit ↗
          </Link>
        </div>
      </aside>

      {/* Workspace */}
      <main className="flex-1 overflow-x-hidden">
        {view === 'overview' && <OverviewView onGoToReview={() => setView('review')} />}
        {view === 'new' && <NewScreeningView />}
        {view === 'customers' && <CustomersView />}
        {view === 'review' && <ReviewQueueView />}
        {view === 'batch' && <BatchView />}
        {view === 'integrations' && <IntegrationsView />}
        {view === 'audit' && <AuditTrailView />}
      </main>
    </div>
  )
}

export function DashboardShell({ workspace }: { workspace: Workspace }) {
  return (
    <WorkspaceProvider workspace={workspace}>
      <ShellInner />
    </WorkspaceProvider>
  )
}
