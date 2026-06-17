'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useWorkspace } from '@/components/dashboard/workspace-context'
import { auditChainAction, simulateTamperAction } from '@/app/actions'
import { type AuditEventView, truncateHash, type VerifyResult } from '@/core/audit/view'
import { cn } from '@/lib/utils'

export function AuditTrailView() {
  const ws = useWorkspace()
  const [events, setEvents] = useState<AuditEventView[]>([])
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)
  const [tampered, setTampered] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pending, startTransition] = useTransition()

  // Load the real chain on mount and whenever a mutation bumps the version.
  useEffect(() => {
    let alive = true
    setLoading(true)
    auditChainAction()
      .then((chain) => {
        if (!alive) return
        setEvents(chain.events)
        setVerifyResult(chain.verify)
        setTampered(false)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [ws.version])

  function handleVerify() {
    startTransition(async () => {
      const chain = await auditChainAction()
      setEvents(chain.events)
      setVerifyResult(chain.verify)
      setTampered(false)
    })
  }

  function handleTamper() {
    startTransition(async () => {
      const sim = await simulateTamperAction()
      setEvents(sim.events)
      setVerifyResult(sim.verify)
      setTampered(true)
    })
  }

  const brokenSeq = verifyResult?.intact === false ? verifyResult.brokenSeq : null

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-10 lg:py-12">
      <header className="flex flex-col gap-2">
        <span className="label-mono">Audit trail</span>
        <h1 className="font-sans text-2xl font-medium tracking-tight">Append-only ledger</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every screening, re-screen, approval, and false-positive clearance is chained to the prior
          event by a SHA-256 hash, under a database-enforced append-only constraint. Alter any past row
          and every hash from that point on stops matching — the verifier pinpoints the break.
        </p>
      </header>

      <div className="mt-8 flex flex-col gap-4 border border-hairline bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleVerify}
            disabled={pending}
            className="inline-flex h-9 items-center bg-accent px-4 font-mono text-xs uppercase tracking-widest text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending ? 'Verifying…' : 'Verify chain'}
          </button>
          {!tampered ? (
            <button
              type="button"
              onClick={handleTamper}
              disabled={pending || events.length === 0}
              className="inline-flex h-9 items-center border border-ink/20 px-4 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:bg-muted disabled:opacity-40"
            >
              Simulate tampering
            </button>
          ) : (
            <button
              type="button"
              onClick={handleVerify}
              disabled={pending}
              className="inline-flex h-9 items-center border border-ink/20 px-4 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:bg-muted disabled:opacity-40"
            >
              Restore ledger
            </button>
          )}
          <Link
            href="/dashboard/audit-export"
            target="_blank"
            className="inline-flex h-9 items-center border border-ink/20 px-4 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:bg-muted"
          >
            Export ↗
          </Link>
        </div>

        <div className="font-mono text-xs">
          {loading ? (
            <span className="text-muted-foreground">● loading…</span>
          ) : verifyResult == null ? (
            <span className="text-muted-foreground">● not yet verified</span>
          ) : verifyResult.intact ? (
            <span className="text-go">● chain intact · all hashes consistent</span>
          ) : (
            <span className="text-nogo">● chain broken at seq {verifyResult.brokenSeq?.toString().padStart(2, '0')}</span>
          )}
        </div>
      </div>

      {verifyResult && !verifyResult.intact ? (
        <div className="mt-4 border-l-2 border-nogo bg-nogo/5 px-4 py-3">
          <p className="font-mono text-xs leading-relaxed text-nogo">{verifyResult.reason}</p>
        </div>
      ) : null}

      <div className="mt-6 overflow-x-auto border border-hairline">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline bg-card">
              <th className="label-mono px-4 py-3 font-normal">seq</th>
              <th className="label-mono px-4 py-3 font-normal">event</th>
              <th className="label-mono px-4 py-3 font-normal">detail</th>
              <th className="label-mono px-4 py-3 font-normal">hash</th>
              <th className="label-mono px-4 py-3 font-normal">prev hash</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const isAltered = Boolean(e.tampered)
              const isBreak = e.seq === brokenSeq
              return (
                <tr key={e.seq} className={cn('border-b border-hairline last:border-0', isBreak && 'bg-nogo/5')}>
                  <td className="px-4 py-3 align-top">
                    <span className={cn('font-mono text-xs', isBreak ? 'text-nogo' : 'text-muted-foreground')}>
                      {e.seq.toString().padStart(2, '0')}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top font-mono text-xs text-foreground">{e.type}</td>
                  <td className="max-w-[280px] px-4 py-3 align-top">
                    <span className={cn('block font-mono text-xs', isAltered ? 'text-nogo' : 'text-foreground/80')}>{e.detail}</span>
                    {isAltered ? (
                      <span className="mt-1 block font-mono text-[0.625rem] uppercase tracking-widest text-nogo">← altered, hash not recomputed</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={cn('font-mono text-xs', isBreak ? 'text-nogo' : 'text-accent')}>{truncateHash(e.hash)}</span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={cn('font-mono text-xs', isBreak ? 'text-nogo' : 'text-muted-foreground')}>{truncateHash(e.prevHash)}</span>
                  </td>
                </tr>
              )
            })}
            {!loading && events.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center font-mono text-xs text-muted-foreground">No audit events yet — run a screening.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="mt-4 font-mono text-[0.6875rem] leading-relaxed text-muted-foreground">
        {events.length} events · genesis hash 0000…0000 · append-only enforced in Aurora; even direct tampering is detectable.
      </p>
    </div>
  )
}
