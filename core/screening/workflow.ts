// Run workflow: approvals + segregation of duties + false-positive clearance
// (architecture-v2 §9 Tier 2/3). Each decision is recorded as an audit event
// with the actor, extending the tamper-evident decision chain.
//
// Framework-agnostic (techstack §2.2): no React/Next imports.

import { sql } from 'drizzle-orm'
import { appendAudit } from '../audit/chain'
import { fpClearances } from '../schema/schema'
import { getDb } from '../schema/db'

export interface Decision {
  runId: string
  userId: string
  role: string
  reason?: string
}

// Approve a flagged (REVIEW) run. Enforces segregation of duties:
// the approver must not be the initiator; NO_GO (BLOCKED) is not overridable.
export async function approveRun(d: Decision): Promise<void> {
  const db = getDb()
  await db.transaction(async (tx) => {
    const res = await tx.execute(
      sql`SELECT initiated_by, status FROM screening_runs WHERE id = ${d.runId} FOR UPDATE`,
    )
    const run = res.rows[0]
    if (!run) throw new Error('Run not found.')
    const status = String(run.status)
    if (status === 'BLOCKED') throw new Error('NO-GO cannot be overridden — escalate to higher authority.')
    if (status !== 'PENDING_REVIEW') throw new Error(`Run is ${status}, not pending review.`)
    if (run.initiated_by && String(run.initiated_by) === d.userId) {
      throw new Error('Segregation of duties: the approver cannot be the person who initiated the run.')
    }
    await tx.execute(sql`
      UPDATE screening_runs
      SET status = 'APPROVED', approved_by = ${d.userId}, approved_at = now()
      WHERE id = ${d.runId}
    `)
    await appendAudit(tx, {
      runId: d.runId,
      eventType: 'APPROVE',
      payload: { actor: { userId: d.userId, role: d.role }, decision: 'APPROVED', reason: d.reason ?? null },
    })
  })
}

export async function rejectRun(d: Decision): Promise<void> {
  const db = getDb()
  await db.transaction(async (tx) => {
    const res = await tx.execute(
      sql`SELECT status FROM screening_runs WHERE id = ${d.runId} FOR UPDATE`,
    )
    const run = res.rows[0]
    if (!run) throw new Error('Run not found.')
    if (String(run.status) !== 'PENDING_REVIEW') {
      throw new Error(`Run is ${String(run.status)}, not pending review.`)
    }
    await tx.execute(sql`UPDATE screening_runs SET status = 'REJECTED' WHERE id = ${d.runId}`)
    await appendAudit(tx, {
      runId: d.runId,
      eventType: 'REJECT',
      payload: { actor: { userId: d.userId, role: d.role }, decision: 'REJECTED', reason: d.reason ?? null },
    })
  })
}

export interface ClearFpInput {
  runId: string
  customerId: string
  partyName: string
  reason: string
  userId: string
  role: string
}

// Clear a fuzzy match as a false positive: remember it (so it won't re-flag for
// this customer) and resolve the current run.
export async function clearFalsePositive(input: ClearFpInput): Promise<void> {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.insert(fpClearances).values({
      customerId: input.customerId,
      partyName: input.partyName,
      reason: input.reason,
      clearedBy: input.userId,
    })
    await tx.execute(
      sql`UPDATE screening_runs SET status = 'APPROVED', approved_by = ${input.userId}, approved_at = now() WHERE id = ${input.runId}`,
    )
    await appendAudit(tx, {
      runId: input.runId,
      eventType: 'CLEAR_FALSE_POSITIVE',
      payload: {
        actor: { userId: input.userId, role: input.role },
        customerId: input.customerId,
        partyName: input.partyName,
        reason: input.reason,
      },
    })
  })
}
