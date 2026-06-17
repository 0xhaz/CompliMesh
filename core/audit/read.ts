// Read + verify the audit chain (powers the "Verify chain" UI action and the
// tamper-detection demo). Pure verification lives in hash.ts; this fetches rows.
//
// Framework-agnostic (techstack §2.2): no React/Next imports.

import { sql } from 'drizzle-orm'
import { type AuditRow, type VerifyResult, verifyAuditChain } from './hash'

interface Db {
  execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }>
}

export async function fetchAuditChain(db: Db): Promise<AuditRow[]> {
  const res = await db.execute(sql`
    SELECT seq, run_id, event_type, payload, prev_hash, row_hash, created_at
    FROM audit_log
    ORDER BY seq ASC
  `)
  return res.rows.map((r) => ({
    seq: Number(r.seq),
    runId: r.run_id ? String(r.run_id) : null,
    eventType: String(r.event_type),
    payload: r.payload,
    prevHash: String(r.prev_hash),
    rowHash: String(r.row_hash),
    createdAt: r.created_at as string | Date,
  }))
}

export async function verifyChain(db: Db): Promise<VerifyResult> {
  return verifyAuditChain(await fetchAuditChain(db))
}
