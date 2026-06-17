'use client'

import { useMemo, useState } from 'react'
import {
  verifyChain,
  tamperLedger,
  truncateHash,
  type AuditEvent,
  type VerifyResult,
} from '@/core/audit'
import { cn } from '@/lib/utils'

function fmt(ts: string): string {
  return new Date(ts)
    .toISOString()
    .replace('T', ' ')
    .replace(/:\d\d\.\d+Z$/, ' UTC')
}

export function AuditTrailView({ ledger }: { ledger: AuditEvent[] }) {
  // tamperedSeq: which row has been altered for the demo (null = pristine).
  const [tamperedSeq, setTamperedSeq] = useState<number | null>(null)
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)

  // The ledger we actually display: pristine, or with one row altered.
  const displayedLedger = useMemo(() => {
    if (tamperedSeq == null) return ledger
    return tamperLedger(ledger, tamperedSeq)
  }, [ledger, tamperedSeq])

  function handleVerify() {
    setVerifyResult(verifyChain(displayedLedger))
  }

  function handleTamper() {
    // Alter the NO_GO verdict row if present, else the middle row.
    const target =
      ledger.find((e) => e.detail.includes('NO_GO'))?.seq ??
      ledger[Math.floor(ledger.length / 2)].seq
    setTamperedSeq(target)
    setVerifyResult(null)
  }

  function handleReset() {
    setTamperedSeq(null)
    setVerifyResult(null)
  }

  const brokenSeq = verifyResult?.intact === false ? verifyResult.brokenSeq : null

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-10 lg:py-12">
      <header className="flex flex-col gap-2">
        <span className="label-mono">Audit trail</span>
        <h1 className="font-sans text-2xl font-medium tracking-tight">
          Append-only ledger
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          Each event is chained to the one before it by hash. Alter any past row
          and every hash from that point forward stops matching — the verifier
          pinpoints exactly which sequence number broke.
        </p>
      </header>

      {/* Controls + status */}
      <div className="mt-8 flex flex-col gap-4 border border-hairline bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleVerify}
            className="inline-flex h-9 items-center bg-accent px-4 font-mono text-xs uppercase tracking-widest text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Verify chain
          </button>
          {tamperedSeq == null ? (
            <button
              type="button"
              onClick={handleTamper}
              className="inline-flex h-9 items-center border border-ink/20 px-4 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Tamper with a row
            </button>
          ) : (
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex h-9 items-center border border-ink/20 px-4 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Restore ledger
            </button>
          )}
        </div>

        {/* Status readout */}
        <div className="font-mono text-xs">
          {verifyResult == null ? (
            <span className="text-muted-foreground">
              {tamperedSeq == null
                ? '● not yet verified'
                : '● row altered — run verify'}
            </span>
          ) : verifyResult.intact ? (
            <span className="text-go">● chain intact · all hashes consistent</span>
          ) : (
            <span className="text-nogo">
              ● chain broken at seq{' '}
              {verifyResult.brokenSeq?.toString().padStart(2, '0')}
            </span>
          )}
        </div>
      </div>

      {/* Broken detail */}
      {verifyResult && !verifyResult.intact ? (
        <div className="mt-4 border-l-2 border-nogo bg-nogo/5 px-4 py-3">
          <p className="font-mono text-xs leading-relaxed text-nogo">
            {verifyResult.reason}
          </p>
        </div>
      ) : null}

      {/* The ledger */}
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
            {displayedLedger.map((e) => {
              const isAltered = e.seq === tamperedSeq
              const isBreak = e.seq === brokenSeq
              return (
                <tr
                  key={e.seq}
                  className={cn(
                    'border-b border-hairline last:border-0',
                    isBreak && 'bg-nogo/5',
                  )}
                >
                  <td className="px-4 py-3 align-top">
                    <span
                      className={cn(
                        'font-mono text-xs',
                        isBreak ? 'text-nogo' : 'text-muted-foreground',
                      )}
                    >
                      {e.seq.toString().padStart(2, '0')}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top font-mono text-xs text-foreground">
                    {e.type}
                  </td>
                  <td className="max-w-[260px] px-4 py-3 align-top">
                    <span
                      className={cn(
                        'block font-mono text-xs',
                        isAltered ? 'text-nogo' : 'text-foreground/80',
                      )}
                    >
                      {e.detail}
                    </span>
                    {isAltered ? (
                      <span className="mt-1 block font-mono text-[0.625rem] uppercase tracking-widest text-nogo">
                        ← altered, hash not recomputed
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span
                      className={cn(
                        'font-mono text-xs',
                        isBreak ? 'text-nogo' : 'text-accent',
                      )}
                    >
                      {truncateHash(e.hash)}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span
                      className={cn(
                        'font-mono text-xs',
                        isBreak ? 'text-nogo' : 'text-muted-foreground',
                      )}
                    >
                      {truncateHash(e.prevHash)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-4 font-mono text-[0.6875rem] leading-relaxed text-muted-foreground">
        {displayedLedger.length} events · genesis hash 0000…0000 · even direct
        tampering is detectable.
      </p>
    </div>
  )
}
