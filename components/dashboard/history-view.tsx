'use client'

import type { ScreeningResult, Verdict } from '@/core/screening/view'
import { cn } from '@/lib/utils'

const DOT: Record<Verdict, string> = {
  GO: 'text-go',
  REVIEW: 'text-review',
  NO_GO: 'text-nogo',
}

const LABEL: Record<Verdict, string> = {
  GO: 'GO',
  REVIEW: 'REVIEW',
  NO_GO: 'NO-GO',
}

function fmt(ts: string): string {
  const d = new Date(ts)
  return d
    .toISOString()
    .replace('T', ' ')
    .replace(/:\d\d\.\d+Z$/, ' UTC')
}

export function HistoryView({
  history,
  onOpenAudit,
}: {
  history: ScreeningResult[]
  onOpenAudit: () => void
}) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-10 lg:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="label-mono">History</span>
          <h1 className="font-sans text-2xl font-medium tracking-tight">
            Past screening runs
          </h1>
        </div>
        <button
          type="button"
          onClick={onOpenAudit}
          className="font-mono text-xs uppercase tracking-widest text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          View audit trail →
        </button>
      </header>

      <div className="mt-8 overflow-x-auto border border-hairline">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline bg-card">
              <th className="label-mono px-4 py-3 font-normal">timestamp</th>
              <th className="label-mono px-4 py-3 font-normal">product</th>
              <th className="label-mono px-4 py-3 font-normal">counterparty</th>
              <th className="label-mono px-4 py-3 font-normal">destination</th>
              <th className="label-mono px-4 py-3 font-normal">verdict</th>
              <th className="label-mono px-4 py-3 font-normal">snapshot</th>
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr
                key={r.id}
                className="border-b border-hairline last:border-0 hover:bg-card"
              >
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {fmt(r.timestamp)}
                </td>
                <td className="max-w-[220px] px-4 py-3">
                  <span className="block truncate font-mono text-xs text-foreground">
                    {r.input.product}
                  </span>
                  <span className="font-mono text-[0.6875rem] text-muted-foreground">
                    {r.classification.hsCode}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-foreground">
                  {r.input.counterparty}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-foreground">
                  {r.input.destination}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2 font-mono text-xs">
                    <span className={cn(DOT[r.verdict])} aria-hidden="true">
                      ●
                    </span>
                    <span className={cn(DOT[r.verdict])}>
                      {LABEL[r.verdict]}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-[0.6875rem] text-muted-foreground">
                  2026-06-12
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 font-mono text-[0.6875rem] text-muted-foreground">
        {history.length} run{history.length === 1 ? '' : 's'} · newest first
      </p>
    </div>
  )
}
