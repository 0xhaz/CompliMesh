// Audit chain append (architecture §3.3 / techstack §6, rule 3: serialized
// appends). Computing prev_hash requires reading the chain tip; concurrent
// appends could fork the chain. We serialize via a transaction-scoped advisory
// lock on a fixed key — this needs no UPDATE privilege on audit_log (the app
// role has UPDATE/DELETE revoked) and serializes the single global chain.
//
// Must be called INSIDE the screening transaction (techstack §5 step 6) so the
// verdict, its control_hits, and the audit rows commit atomically.
//
// Framework-agnostic (techstack §2.2): no React/Next imports.

import { sql } from 'drizzle-orm'
import { auditLog } from '../schema/schema'
import type { AuditEventType } from '../types'
import { computeRowHash, GENESIS_HASH, normalizeCreatedAt } from './hash'

// Fixed advisory-lock key identifying "the audit chain". Any constant works.
const AUDIT_CHAIN_LOCK = 4_771_001

// Minimal shape we need from a Drizzle transaction.
interface Tx {
  execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }>
  insert: (table: typeof auditLog) => {
    values: (v: typeof auditLog.$inferInsert) => Promise<unknown>
  }
}

export interface AppendInput {
  runId: string | null
  eventType: AuditEventType
  payload: unknown
  /** ISO 8601; defaults to a fresh timestamp. Stored verbatim and hashed. */
  createdAt?: string
}

// Append one event to the global chain. Returns the row's hash so callers can
// observe the chain tip if needed.
export async function appendAudit(tx: Tx, input: AppendInput): Promise<{ rowHash: string }> {
  // Serialize appends for the duration of the transaction.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK}::bigint)`)

  // Read the current chain tip (sees our own prior inserts in this tx).
  const tip = await tx.execute(
    sql`SELECT row_hash FROM audit_log ORDER BY seq DESC LIMIT 1`,
  )
  const prevHash = tip.rows[0] ? String(tip.rows[0].row_hash) : GENESIS_HASH

  const createdAt = normalizeCreatedAt(input.createdAt ?? new Date().toISOString())
  const rowHash = computeRowHash({
    prevHash,
    payload: input.payload,
    runId: input.runId,
    eventType: input.eventType,
    createdAt,
  })

  await tx.insert(auditLog).values({
    runId: input.runId,
    eventType: input.eventType,
    payload: input.payload as typeof auditLog.$inferInsert['payload'],
    prevHash,
    rowHash,
    createdAt: new Date(createdAt),
  })

  return { rowHash }
}
