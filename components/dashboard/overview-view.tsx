'use client'

import { useEffect, useState, useTransition } from 'react'
import { useWorkspace } from '@/components/dashboard/workspace-context'
import { listRunsAction, loadListUpdateAction, rescreenClientAction } from '@/app/actions'
import type { RescreenResult } from '@/core/screening/rescreen'
import type { ScreeningView } from '@/core/screening/view'
import { cn } from '@/lib/utils'

const DOT: Record<string, string> = { GO: 'text-go', REVIEW: 'text-review', NO_GO: 'text-nogo' }

interface ClientStat {
  client: string
  total: number
  go: number
  review: number
  noGo: number
  pending: number
}

function fmt(ts: string) {
  return new Date(ts).toISOString().replace('T', ' ').replace(/:\d\d\.\d+Z$/, ' UTC')
}

export function OverviewView({ onGoToReview }: { onGoToReview: () => void }) {
  const ws = useWorkspace()
  const [runs, setRuns] = useState<ScreeningView[]>([])
  const [loading, setLoading] = useState(true)
  const [rescreen, setRescreen] = useState<RescreenResult | null>(null)
  const [rescreenNote, setRescreenNote] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let alive = true
    setLoading(true)
    listRunsAction({ orgId: ws.org.id, limit: 200 })
      .then((r) => alive && setRuns(r))
      .catch(() => alive && setRuns([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [ws.org.id, ws.version])

  const stats: ClientStat[] = ws.clients.map((c) => {
    const cr = runs.filter((r) => r.clientName === c.name)
    return {
      client: c.name,
      total: cr.length,
      go: cr.filter((r) => r.verdict === 'GO').length,
      review: cr.filter((r) => r.verdict === 'REVIEW').length,
      noGo: cr.filter((r) => r.verdict === 'NO_GO').length,
      pending: cr.filter((r) => r.status === 'PENDING_REVIEW').length,
    }
  })
  const totalPending = runs.filter((r) => r.status === 'PENDING_REVIEW').length

  function runRescreen() {
    if (pending) return
    setRescreen(null)
    setRescreenNote(null)
    startTransition(async () => {
      try {
        const upd = await loadListUpdateAction()
        const res = await rescreenClientAction(ws.actionCtx())
        setRescreen(res)
        setRescreenNote(
          `${upd.alreadyCurrent ? 'List already current' : `List updated — newly sanctioned: ${upd.addedParty}`}. Re-screened ${res.rescreened} customers of ${ws.activeClient.name}.`,
        )
        ws.refresh()
      } catch (e) {
        setRescreenNote((e as Error).message)
      }
    })
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-10 lg:py-12">
      <header className="flex flex-col gap-2">
        <span className="label-mono">Overview</span>
        <h1 className="font-sans text-2xl font-medium tracking-tight">{ws.org.name}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Screening across {ws.clients.length} client accounts. One engine, one verdict model, one
          tamper-evident ledger — for every client.
        </p>
      </header>

      {/* Per-client stat cards */}
      <div className="mt-8 grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <div key={s.client} className="flex flex-col gap-3 bg-card p-5">
            <span className="font-mono text-xs text-foreground">{s.client}</span>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-3xl font-medium tracking-tight text-foreground">{s.total}</span>
              <span className="label-mono">runs</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
              <span className="text-go">GO {s.go}</span>
              <span className="text-review">REVIEW {s.review}</span>
              <span className="text-nogo">NO-GO {s.noGo}</span>
            </div>
            {s.pending > 0 ? (
              <span className="font-mono text-[0.6875rem] text-review">● {s.pending} pending review</span>
            ) : (
              <span className="font-mono text-[0.6875rem] text-muted-foreground">● no open items</span>
            )}
          </div>
        ))}
      </div>

      {/* Re-screening on list change — the Haas capability */}
      <div className="mt-8 border border-hairline bg-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xl">
            <span className="label-mono">Re-screening on list change</span>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              A customer clean on Monday can be on the SDN list by Thursday. Simulate a CSL refresh and
              re-screen <span className="font-mono text-foreground">{ws.activeClient.name}</span>&apos;s
              saved customers against the new list.
            </p>
          </div>
          <button
            type="button"
            onClick={runRescreen}
            disabled={pending}
            className="inline-flex h-10 shrink-0 items-center bg-accent px-4 font-mono text-xs uppercase tracking-widest text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending ? 'Re-screening…' : 'Refresh list & re-screen'}
          </button>
        </div>
        {rescreenNote ? (
          <p className="mt-4 font-mono text-xs leading-relaxed text-foreground/80">{rescreenNote}</p>
        ) : null}
        {rescreen && rescreen.newlyFlagged.length > 0 ? (
          <div className="mt-3 border-l-2 border-nogo bg-nogo/5 px-4 py-3">
            <span className="font-mono text-[0.6875rem] uppercase tracking-widest text-nogo">
              {rescreen.newlyFlagged.length} customer(s) now flagged
            </span>
            <ul className="mt-2 flex flex-col gap-1">
              {rescreen.newlyFlagged.map((f) => (
                <li key={f.customerId} className="font-mono text-xs">
                  <span className={cn(DOT[f.verdict])}>● {f.verdict}</span>{' '}
                  <span className="text-foreground">{f.name}</span>{' '}
                  <span className="text-muted-foreground">@{f.score.toFixed(2)} — {f.reason.slice(0, 60)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : rescreen ? (
          <p className="mt-3 font-mono text-xs text-go">● no customers newly flagged.</p>
        ) : null}
      </div>

      {/* Recent activity */}
      <div className="mt-8 flex items-end justify-between">
        <span className="label-mono">Recent activity</span>
        {totalPending > 0 ? (
          <button
            type="button"
            onClick={onGoToReview}
            className="font-mono text-xs uppercase tracking-widest text-review underline-offset-4 hover:underline"
          >
            {totalPending} pending review →
          </button>
        ) : null}
      </div>
      <div className="mt-3 overflow-x-auto border border-hairline">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline bg-card">
              <th className="label-mono px-4 py-3 font-normal">time</th>
              <th className="label-mono px-4 py-3 font-normal">client</th>
              <th className="label-mono px-4 py-3 font-normal">customer</th>
              <th className="label-mono px-4 py-3 font-normal">verdict</th>
              <th className="label-mono px-4 py-3 font-normal">status</th>
              <th className="label-mono px-4 py-3 font-normal">by</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center font-mono text-xs text-muted-foreground">loading…</td></tr>
            ) : runs.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center font-mono text-xs text-muted-foreground">No runs yet.</td></tr>
            ) : (
              runs.slice(0, 12).map((r) => (
                <tr key={r.runId} className="border-b border-hairline last:border-0 hover:bg-card">
                  <td className="px-4 py-3 font-mono text-[0.6875rem] text-muted-foreground">{fmt(r.timestamp)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{r.clientName ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{r.customerName ?? r.input.counterparty}</td>
                  <td className="px-4 py-3 font-mono text-xs"><span className={cn(DOT[r.verdict])}>● {r.verdict === 'NO_GO' ? 'NO-GO' : r.verdict}</span></td>
                  <td className="px-4 py-3 font-mono text-[0.6875rem] text-muted-foreground">{r.status}{r.trigger !== 'MANUAL' ? ` · ${r.trigger}` : ''}</td>
                  <td className="px-4 py-3 font-mono text-[0.6875rem] text-muted-foreground">{r.initiator ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
