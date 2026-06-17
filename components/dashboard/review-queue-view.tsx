'use client'

import { useEffect, useState, useTransition } from 'react'
import { useWorkspace } from '@/components/dashboard/workspace-context'
import {
  approveRunAction,
  clearFalsePositiveAction,
  rejectRunAction,
  reviewQueueAction,
} from '@/app/actions'
import type { ScreeningView } from '@/core/screening/view'
import { cn } from '@/lib/utils'

function fmt(ts: string) {
  return new Date(ts).toISOString().replace('T', ' ').replace(/:\d\d\.\d+Z$/, ' UTC')
}

function QueueRow({ run, onDone }: { run: ScreeningView; onDone: () => void }) {
  const ws = useWorkspace()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [reason, setReason] = useState('')

  const isSelf = run.initiator === ws.activeUser.name // hint only; server enforces by id
  const fuzzy = run.entity.matchedParty

  function act(fn: () => Promise<void>) {
    setError(null)
    startTransition(async () => {
      try {
        await fn()
        ws.refresh()
        onDone()
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  return (
    <div className="border border-hairline bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs text-review">● REVIEW · {run.status}</span>
          <span className="font-mono text-sm text-foreground">{run.customerName ?? run.input.counterparty}</span>
          <span className="font-mono text-[0.6875rem] text-muted-foreground">
            {run.clientName} · {run.input.destination} · {fmt(run.timestamp)}
          </span>
        </div>
        <span className="font-mono text-[0.6875rem] text-muted-foreground">
          initiated by {run.initiator ?? '—'}
        </span>
      </div>

      <p className="mt-3 max-w-prose font-mono text-xs leading-relaxed text-foreground/80">{run.reason}</p>

      {/* Actions */}
      <div className="mt-4 flex flex-col gap-3">
        {error ? <p className="font-mono text-[0.6875rem] text-nogo">{error}</p> : null}
        {isSelf ? (
          <p className="font-mono text-[0.6875rem] text-review">
            ⚠ You initiated this run — segregation of duties means a different approver must authorize it.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending || !ws.canApprove}
            onClick={() => act(() => approveRunAction(run.runId, ws.actionCtx()))}
            title={ws.canApprove ? undefined : 'Requires an Approver/Admin role'}
            className="inline-flex h-9 items-center bg-go/90 px-4 font-mono text-xs uppercase tracking-widest text-white transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={pending || !ws.canApprove}
            onClick={() => act(() => rejectRunAction(run.runId, ws.actionCtx()))}
            className="inline-flex h-9 items-center bg-nogo/90 px-4 font-mono text-xs uppercase tracking-widest text-white transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            Reject
          </button>
          {fuzzy ? (
            <button
              type="button"
              disabled={pending || !ws.canReview}
              onClick={() => setClearing((v) => !v)}
              className="inline-flex h-9 items-center border border-ink/20 px-4 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:bg-muted disabled:opacity-30"
            >
              Clear false positive
            </button>
          ) : null}
        </div>

        {clearing && fuzzy ? (
          <div className="flex flex-col gap-2 border-l-2 border-accent bg-accent/5 px-4 py-3">
            <span className="font-mono text-[0.6875rem] text-muted-foreground">
              Clearing the fuzzy match to <span className="text-foreground">{fuzzy}</span> for this customer.
              It won&apos;t re-flag on future runs.
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (e.g. confirmed different entity via incorporation docs)"
              className="w-full border border-ink/15 bg-background px-3 py-2 font-mono text-xs text-foreground focus-visible:border-accent focus-visible:outline-none"
            />
            <button
              type="button"
              disabled={pending || !reason.trim()}
              onClick={() =>
                act(() =>
                  clearFalsePositiveAction(
                    run.runId,
                    run.customerName ?? run.input.counterparty,
                    fuzzy,
                    reason.trim(),
                    ws.actionCtx(),
                  ),
                )
              }
              className="inline-flex h-9 w-fit items-center bg-accent px-4 font-mono text-xs uppercase tracking-widest text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              Record clearance
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function ReviewQueueView() {
  const ws = useWorkspace()
  const [queue, setQueue] = useState<ScreeningView[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    reviewQueueAction(ws.org.id)
      .then((r) => alive && setQueue(r))
      .catch(() => alive && setQueue([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [ws.org.id, ws.version])

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10 lg:py-12">
      <header className="flex flex-col gap-2">
        <span className="label-mono">Review queue</span>
        <h1 className="font-sans text-2xl font-medium tracking-tight">Flagged shipments awaiting a decision</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          REVIEW verdicts route here. An approver authorizes or rejects; the approver may not be the person
          who initiated the run (segregation of duties). Every decision is written to the tamper-evident
          ledger with who decided and why.
        </p>
        <p className="font-mono text-[0.6875rem] text-muted-foreground">
          you are <span className="text-foreground">{ws.activeUser.name}</span> ({ws.activeUser.role})
          {ws.canApprove ? ' · can approve' : ' · cannot approve'}
        </p>
      </header>

      <div className="mt-8 flex flex-col gap-4">
        {loading ? (
          <p className="font-mono text-xs text-muted-foreground">loading…</p>
        ) : queue.length === 0 ? (
          <div className="border border-dashed border-hairline p-8 text-center">
            <span className="font-mono text-xs text-go">● queue clear — no pending reviews.</span>
          </div>
        ) : (
          queue.map((r) => <QueueRow key={r.runId} run={r} onDone={() => {}} />)
        )}
      </div>
    </div>
  )
}
