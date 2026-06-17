// The screening pipeline (architecture §4.2 / techstack §5; v2 §9).
//   1. CLASSIFY    description -> HS code + confidence (LLM propose, validate)
//   2. SCREEN      counterparty -> pg_trgm fuzzy match vs restricted_parties
//   3. DESTINATION resolve destination_rules(hs_prefix, country)
//   4. RESOLVE     emit control_hits; suppress cleared false positives
//   5. VERDICT     aggregate hits (worst wins) -> GO / REVIEW / NO_GO
//   6. PERSIST     write run (scoped to org/client/customer + initiator + status)
//                  + control_hits + audit rows (with actor) in ONE transaction
//
// Framework-agnostic (techstack §2.2): no React/Next imports.

import { sql } from 'drizzle-orm'
import { appendAudit } from '../audit/chain'
import { getDb } from '../schema/db'
import {
  controlHits as controlHitsTable,
  entities,
  fpClearances,
  products,
  screeningRuns,
} from '../schema/schema'
import type { RunStatus, RunTrigger, Verdict } from '../types'
import { classify, type ClassificationResult, type HsCandidate } from './classify'
import { parseCountryCode, resolveDestination, type DestinationResult } from './destination'
import { type EntityResult, screenEntity } from './screen'
import { aggregateVerdict, type ControlHit, resolveHits } from './verdict'

export interface ScreeningInput {
  product: string
  counterparty: string
  destination: string
}

// Who/what/where a run is attributed to (v2 multi-tenancy + roles).
export interface RunContext {
  orgId?: string | null
  clientId?: string | null
  customerId?: string | null
  initiatedBy?: string | null // user id
  actorRole?: string | null // role-at-time, recorded in the audit ledger
  trigger?: RunTrigger // default MANUAL
}

export interface SnapshotRef {
  id: string
  label: string
}

export interface RunResult {
  runId: string
  verdict: Verdict
  status: RunStatus
  reason: string
  classification: ClassificationResult
  entity: EntityResult
  destination: DestinationResult
  hits: ControlHit[]
  suppressed: { partyName: string } | null // a cleared false-positive was suppressed
  snapshots: { restrictedParty: SnapshotRef; hs: SnapshotRef; destinationRule: SnapshotRef }
  createdAt: string
}

function round(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10000) / 10000
}

// Verdict -> initial workflow status (v2 §9 Tier 3).
export function statusForVerdict(v: Verdict): RunStatus {
  if (v === 'GO') return 'CLEARED'
  if (v === 'NO_GO') return 'BLOCKED'
  return 'PENDING_REVIEW'
}

interface Db {
  execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }>
}

// Resolve the latest snapshot per source_type (per-source versioning, §2.3).
async function currentSnapshots(db: Db) {
  const res = await db.execute(sql`
    SELECT DISTINCT ON (source_type) id, source_type, label
    FROM ref_snapshots
    ORDER BY source_type, created_at DESC, id DESC
  `)
  const by: Record<string, SnapshotRef> = {}
  for (const r of res.rows) by[String(r.source_type)] = { id: String(r.id), label: String(r.label) }
  const rp = by['RESTRICTED_PARTY']
  const hs = by['HS']
  const dr = by['DESTINATION_RULE']
  if (!rp || !hs || !dr) {
    throw new Error('Missing reference snapshots — run `pnpm seed` to load demo data.')
  }
  return { rp, hs, dr }
}

// Party names a reviewer has cleared as false positives for this customer.
async function clearedPartyNames(db: Db, customerId: string): Promise<Set<string>> {
  const res = await db.execute(
    sql`SELECT party_name FROM fp_clearances WHERE customer_id = ${customerId}`,
  )
  return new Set(res.rows.map((r) => String(r.party_name).toLowerCase()))
}

export async function runScreening(
  input: ScreeningInput,
  ctx: RunContext = {},
): Promise<RunResult> {
  const db = getDb()
  // Allow overriding the snapshot set (used by re-screening against a new RP
  // snapshot) — defaults to the latest of each source.
  const snap = await currentSnapshots(db)

  const hsRows = await db.execute(sql`
    SELECT hs_code, description FROM hs_reference WHERE snapshot_id = ${snap.hs.id}
  `)
  const candidates: HsCandidate[] = hsRows.rows.map((r) => ({
    hsCode: String(r.hs_code),
    description: String(r.description),
  }))

  // 1–3: classify, screen, destination.
  const classification = await classify(input.product, candidates)
  const entity = await screenEntity(db, input.counterparty, snap.rp.id)
  const destination = await resolveDestination(db, classification.hsCode, input.destination, snap.dr.id)

  // 4: resolve hits, then suppress any cleared false-positive entity match.
  let hits = resolveHits(classification, entity, destination)
  let suppressed: { partyName: string } | null = null
  if (ctx.customerId && entity.partyName) {
    const cleared = await clearedPartyNames(db, ctx.customerId)
    if (cleared.has(entity.partyName.toLowerCase())) {
      const before = hits.length
      hits = hits.filter((h) => !(h.dimension === 'ENTITY' && h.ruleType === 'FUZZY_MATCH'))
      if (hits.length < before) suppressed = { partyName: entity.partyName }
    }
  }

  // 5: aggregate verdict + workflow status.
  const { verdict, reason } = aggregateVerdict(hits)
  const status = statusForVerdict(verdict)
  const actor = { userId: ctx.initiatedBy ?? null, role: ctx.actorRole ?? null }
  const trigger: RunTrigger = ctx.trigger ?? 'MANUAL'

  // 6: PERSIST — run + control_hits + audit rows in ONE transaction.
  const createdAt = new Date().toISOString()
  const runId = await db.transaction(async (tx) => {
    const [product] = await tx
      .insert(products)
      .values({
        description: input.product,
        hsCode: classification.hsCode,
        hsConfidence: classification.hsCode ? String(classification.confidence) : null,
      })
      .returning({ id: products.id })

    const [counterparty] = await tx
      .insert(entities)
      .values({ name: input.counterparty, country: null })
      .returning({ id: entities.id })

    const [run] = await tx
      .insert(screeningRuns)
      .values({
        productId: product.id,
        entityId: counterparty.id,
        destination: parseCountryCode(input.destination),
        orgId: ctx.orgId ?? null,
        clientId: ctx.clientId ?? null,
        customerId: ctx.customerId ?? null,
        initiatedBy: ctx.initiatedBy ?? null,
        trigger,
        status,
        rpSnapshotId: snap.rp.id,
        hsSnapshotId: snap.hs.id,
        drSnapshotId: snap.dr.id,
        verdict,
      })
      .returning({ id: screeningRuns.id })

    if (hits.length > 0) {
      await tx.insert(controlHitsTable).values(
        hits.map((h) => ({
          runId: run.id,
          sourceType: h.sourceType,
          sourceRefId: h.sourceRefId,
          dimension: h.dimension,
          ruleType: h.ruleType,
          matchScore: h.matchScore === null ? null : String(round(h.matchScore)),
          reason: h.reason,
          snapshotId:
            h.sourceType === 'RESTRICTED_PARTY'
              ? snap.rp.id
              : h.sourceType === 'DESTINATION_RULE'
                ? snap.dr.id
                : null,
        })),
      )
    }

    await appendAudit(tx, {
      runId: run.id,
      eventType: 'RUN_CREATED',
      payload: { actor, trigger, product: input.product, counterparty: input.counterparty, destination: input.destination },
      createdAt,
    })
    await appendAudit(tx, {
      runId: run.id,
      eventType: 'CLASSIFY',
      payload: { actor, hsCode: classification.hsCode, confidence: round(classification.confidence), source: classification.source, belowFloor: classification.belowFloor },
      createdAt,
    })
    await appendAudit(tx, {
      runId: run.id,
      eventType: 'SCREEN',
      payload: { actor, band: entity.band, party: entity.partyName, list: entity.listSource, score: round(entity.score), suppressed: suppressed?.partyName ?? null },
      createdAt,
    })
    await appendAudit(tx, {
      runId: run.id,
      eventType: 'RESOLVE',
      payload: { actor, hits: hits.map((h) => ({ dimension: h.dimension, ruleType: h.ruleType, reason: h.reason })) },
      createdAt,
    })
    await appendAudit(tx, {
      runId: run.id,
      eventType: 'VERDICT',
      payload: { actor, verdict, status, reason, snapshots: { rp: snap.rp.label, hs: snap.hs.label, dr: snap.dr.label } },
      createdAt,
    })

    return run.id
  })

  return {
    runId,
    verdict,
    status,
    reason,
    classification,
    entity,
    destination,
    hits,
    suppressed,
    snapshots: { restrictedParty: snap.rp, hs: snap.hs, destinationRule: snap.dr },
    createdAt,
  }
}
