'use client'

import { useEffect, useState } from 'react'
import { useWorkspace } from '@/components/dashboard/workspace-context'
import { listCustomersAction, listRunsAction } from '@/app/actions'
import type { CustomerView } from '@/core/tenancy'
import type { ScreeningView } from '@/core/screening/view'
import { cn } from '@/lib/utils'

const DOT: Record<string, string> = { GO: 'text-go', REVIEW: 'text-review', NO_GO: 'text-nogo' }

function fmt(ts: string) {
  return new Date(ts).toISOString().replace('T', ' ').replace(/:\d\d\.\d+Z$/, ' UTC')
}

export function CustomersView() {
  const ws = useWorkspace()
  const [customers, setCustomers] = useState<CustomerView[]>([])
  const [runs, setRuns] = useState<ScreeningView[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      listCustomersAction(ws.activeClient.id),
      listRunsAction({ clientId: ws.activeClient.id, limit: 200 }),
    ])
      .then(([cs, rs]) => {
        if (!alive) return
        setCustomers(cs)
        setRuns(rs)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [ws.activeClient.id, ws.version])

  // Latest run per customer name (runs are newest-first).
  function latestFor(name: string): ScreeningView | undefined {
    return runs.find((r) => (r.customerName ?? r.input.counterparty)?.toLowerCase() === name.toLowerCase())
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-10 lg:py-12">
      <header className="flex flex-col gap-2">
        <span className="label-mono">Customers</span>
        <h1 className="font-sans text-2xl font-medium tracking-tight">{ws.activeClient.name}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Saved counterparties for this client. Persisted so they can be re-screened whenever the list
          changes.
        </p>
      </header>

      <div className="mt-8 overflow-x-auto border border-hairline">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline bg-card">
              <th className="label-mono px-4 py-3 font-normal">customer</th>
              <th className="label-mono px-4 py-3 font-normal">country</th>
              <th className="label-mono px-4 py-3 font-normal">runs</th>
              <th className="label-mono px-4 py-3 font-normal">last screened</th>
              <th className="label-mono px-4 py-3 font-normal">last verdict</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center font-mono text-xs text-muted-foreground">loading…</td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center font-mono text-xs text-muted-foreground">No saved customers yet — run a screening to add one.</td></tr>
            ) : (
              customers.map((c) => {
                const last = latestFor(c.name)
                const count = runs.filter(
                  (r) => (r.customerName ?? r.input.counterparty)?.toLowerCase() === c.name.toLowerCase(),
                ).length
                return (
                  <tr key={c.id} className="border-b border-hairline last:border-0 hover:bg-card">
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{c.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.country ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{count}</td>
                    <td className="px-4 py-3 font-mono text-[0.6875rem] text-muted-foreground">{last ? fmt(last.timestamp) : '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {last ? (
                        <span className={cn(DOT[last.verdict])}>● {last.verdict === 'NO_GO' ? 'NO-GO' : last.verdict}</span>
                      ) : (
                        <span className="text-muted-foreground">not screened</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-4 font-mono text-[0.6875rem] text-muted-foreground">
        {customers.length} customer{customers.length === 1 ? '' : 's'} · {ws.activeClient.name}
      </p>
    </div>
  )
}
