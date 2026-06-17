import Link from 'next/link'
import { PrintButton } from '@/components/print-button'
import { verifyAuditChain } from '@/core/audit/hash'
import { fetchAuditChain } from '@/core/audit/read'
import { toAuditEventView } from '@/core/audit/view'
import { getDb } from '@/core/schema/db'
import { getWorkspace } from '@/core/tenancy'

export const dynamic = 'force-dynamic'

function fmt(ts: string) {
  return new Date(ts).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}

export default async function AuditExportPage() {
  const db = getDb()
  const ws = await getWorkspace(db)
  const rows = await fetchAuditChain(db)
  const events = rows.map(toAuditEventView)
  const verify = verifyAuditChain(rows)
  const generatedAt = new Date().toISOString()

  return (
    <div className="mx-auto min-h-screen max-w-4xl bg-background px-8 py-10 text-foreground">
      {/* Controls (hidden in print) */}
      <div className="mb-8 flex items-center justify-between print:hidden">
        <Link href="/dashboard" className="font-mono text-xs uppercase tracking-widest text-accent underline-offset-4 hover:underline">
          ← Back to dashboard
        </Link>
        <PrintButton />
      </div>

      {/* Document header */}
      <header className="border-b border-ink/20 pb-5">
        <h1 className="font-sans text-xl font-medium tracking-tight">Compliance Audit Export</h1>
        <div className="mt-2 flex flex-col gap-0.5 font-mono text-[0.6875rem] text-muted-foreground">
          <span>organization: <span className="text-foreground">{ws.org?.name ?? '—'}</span> ({ws.org?.kind ?? '—'})</span>
          <span>generated: <span className="text-foreground">{fmt(generatedAt)}</span></span>
          <span>events: <span className="text-foreground">{events.length}</span> · chain ordered by seq · genesis 0000…0000</span>
          <span>
            integrity:{' '}
            {verify.intact ? (
              <span className="text-go">VERIFIED — all hashes consistent</span>
            ) : (
              <span className="text-nogo">BROKEN at seq {verify.brokenSeq}</span>
            )}
          </span>
        </div>
      </header>

      {/* The ledger */}
      <table className="mt-6 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-ink/20">
            <th className="label-mono py-2 pr-3 font-normal">seq</th>
            <th className="label-mono py-2 pr-3 font-normal">event</th>
            <th className="label-mono py-2 pr-3 font-normal">detail</th>
            <th className="label-mono py-2 pr-3 font-normal">time</th>
            <th className="label-mono py-2 font-normal">row hash</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.seq} className="border-b border-hairline align-top">
              <td className="py-2 pr-3 font-mono text-[0.6875rem] text-muted-foreground">{e.seq.toString().padStart(3, '0')}</td>
              <td className="py-2 pr-3 font-mono text-[0.6875rem] text-foreground">{e.type}</td>
              <td className="py-2 pr-3 font-mono text-[0.6875rem] text-foreground/80">{e.detail}</td>
              <td className="py-2 pr-3 font-mono text-[0.625rem] text-muted-foreground">{fmt(e.timestamp)}</td>
              <td className="py-2 font-mono text-[0.5625rem] break-all text-muted-foreground">{e.hash}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-6 font-mono text-[0.625rem] leading-relaxed text-muted-foreground">
        This export reproduces the append-only, hash-chained audit ledger as stored in Aurora PostgreSQL.
        Each row_hash = SHA-256(prev_hash ‖ canonical(payload) ‖ run_id ‖ event_type ‖ created_at). Tamper
        evidence is verifiable by recomputing the chain. Decision support record — not a legal determination.
      </p>
    </div>
  )
}
