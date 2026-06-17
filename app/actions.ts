'use server'

// Server Actions — the thin app/ wrapper over core/ (techstack §2.2). The
// client components call these; all DB + AI work happens here, server-side.

import { verifyAuditChain, type VerifyResult } from '@/core/audit/hash'
import { fetchAuditChain } from '@/core/audit/read'
import { type AuditEventView, toAuditEventView } from '@/core/audit/view'
import { type ScreeningInput, runScreening } from '@/core/screening/pipeline'
import { type ScreeningView, listRecentRuns, toScreeningView } from '@/core/screening/view'
import { getDb } from '@/core/schema/db'

export async function runScreeningAction(input: ScreeningInput): Promise<ScreeningView> {
  const run = await runScreening(input)
  const view = toScreeningView(run)
  // toScreeningView can't see the raw inputs — fill them from the request.
  view.input = {
    product: input.product,
    counterparty: input.counterparty,
    destination: input.destination,
  }
  return view
}

export async function listRunsAction(): Promise<ScreeningView[]> {
  return listRecentRuns(getDb())
}

export interface AuditChainView {
  events: AuditEventView[]
  verify: VerifyResult
}

export async function auditChainAction(): Promise<AuditChainView> {
  const rows = await fetchAuditChain(getDb())
  return { events: rows.map(toAuditEventView), verify: verifyAuditChain(rows) }
}

export interface TamperSimulation extends AuditChainView {
  tamperedSeq: number | null
}

// Simulate tampering WITHOUT mutating the protected table: fetch the real chain,
// alter one row in memory, and run the same verifier. The DB itself is defended
// by the append-only REVOKE + trigger; this shows what the verifier catches when
// prevention is bypassed (the real SQL-tamper demo is in the submission video).
export async function simulateTamperAction(): Promise<TamperSimulation> {
  const rows = await fetchAuditChain(getDb())
  if (rows.length === 0) {
    return { events: [], verify: { intact: true, brokenSeq: null, reason: null }, tamperedSeq: null }
  }
  const verdictIdx = rows.findIndex((r) => r.eventType === 'VERDICT')
  const idx = verdictIdx >= 0 ? verdictIdx : Math.floor(rows.length / 2)

  const tamperedRows = rows.map((r, i) =>
    i === idx
      ? { ...r, payload: { ...(r.payload as object), verdict: 'GO', _tampered: true } }
      : r,
  )
  const events = tamperedRows.map((r, i) => {
    const view = toAuditEventView(r)
    if (i === idx) view.tampered = true
    return view
  })
  return { events, verify: verifyAuditChain(tamperedRows), tamperedSeq: rows[idx].seq }
}
