// The screening pipeline (architecture §4.2 / techstack §5). One screening run:
//   1. CLASSIFY    description -> HS code + confidence (LLM propose, validate)
//   2. SCREEN      counterparty -> pg_trgm fuzzy match vs restricted_parties
//   3. DESTINATION resolve destination_rules(hs_prefix, country)
//   4. RESOLVE     emit control_hits for every fired control
//   5. VERDICT     aggregate hits (worst wins) -> GO / REVIEW / NO_GO
//   6. PERSIST     write run + control_hits + audit rows in ONE transaction
//
// Reads + the (long-running) LLM call happen first against fixed snapshots; the
// transaction is the short, atomic persist step — the Postgres-transaction
// showcase: the verdict and its evidence commit together or not at all.
//
// Framework-agnostic (techstack §2.2): no React/Next imports. The app/ Server
// Action is a thin wrapper that calls runScreening().

import { sql } from 'drizzle-orm'
import { appendAudit } from '../audit/chain'
import { getDb } from '../schema/db'
import {
  controlHits as controlHitsTable,
  entities,
  products,
  screeningRuns,
} from '../schema/schema'
import type { Verdict } from '../types'
import { classify, type ClassificationResult, type HsCandidate } from './classify'
import { parseCountryCode, resolveDestination, type DestinationResult } from './destination'
import { type EntityResult, screenEntity } from './screen'
import { aggregateVerdict, type ControlHit, resolveHits } from './verdict'

export interface ScreeningInput {
  product: string
  counterparty: string
  destination: string
}

export interface SnapshotRef {
  id: string
  label: string
}

export interface RunResult {
  runId: string
  verdict: Verdict
  reason: string
  classification: ClassificationResult
  entity: EntityResult
  destination: DestinationResult
  hits: ControlHit[]
  snapshots: { restrictedParty: SnapshotRef; hs: SnapshotRef; destinationRule: SnapshotRef }
  createdAt: string
}

function round(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10000) / 10000
}

// Resolve the latest snapshot per source_type (per-source versioning, §2.3).
async function currentSnapshots(db: ReturnType<typeof getDb>) {
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

export async function runScreening(input: ScreeningInput): Promise<RunResult> {
  const db = getDb()
  const snap = await currentSnapshots(db)

  // HS candidates for the current HS snapshot (for propose-then-validate).
  const hsRows = await db.execute(sql`
    SELECT hs_code, description FROM hs_reference WHERE snapshot_id = ${snap.hs.id}
  `)
  const candidates: HsCandidate[] = hsRows.rows.map((r) => ({
    hsCode: String(r.hs_code),
    description: String(r.description),
  }))

  // 1–3: classify, screen, destination (reads + LLM, outside the transaction).
  const classification = await classify(input.product, candidates)
  const entity = await screenEntity(db, input.counterparty, snap.rp.id)
  const destination = await resolveDestination(db, classification.hsCode, input.destination, snap.dr.id)

  // 4–5: resolve hits, aggregate verdict.
  const hits = resolveHits(classification, entity, destination)
  const { verdict, reason } = aggregateVerdict(hits)

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

    // Audit events tell the pipeline story in the tamper-evident ledger.
    await appendAudit(tx, {
      runId: run.id,
      eventType: 'RUN_CREATED',
      payload: { product: input.product, counterparty: input.counterparty, destination: input.destination },
      createdAt,
    })
    await appendAudit(tx, {
      runId: run.id,
      eventType: 'CLASSIFY',
      payload: {
        hsCode: classification.hsCode,
        confidence: round(classification.confidence),
        source: classification.source,
        belowFloor: classification.belowFloor,
      },
      createdAt,
    })
    await appendAudit(tx, {
      runId: run.id,
      eventType: 'SCREEN',
      payload: { band: entity.band, party: entity.partyName, list: entity.listSource, score: round(entity.score) },
      createdAt,
    })
    await appendAudit(tx, {
      runId: run.id,
      eventType: 'RESOLVE',
      payload: { hits: hits.map((h) => ({ dimension: h.dimension, ruleType: h.ruleType, reason: h.reason })) },
      createdAt,
    })
    await appendAudit(tx, {
      runId: run.id,
      eventType: 'VERDICT',
      payload: {
        verdict,
        reason,
        snapshots: { rp: snap.rp.label, hs: snap.hs.label, dr: snap.dr.label },
      },
      createdAt,
    })

    return run.id
  })

  return {
    runId,
    verdict,
    reason,
    classification,
    entity,
    destination,
    hits,
    snapshots: { restrictedParty: snap.rp, hs: snap.hs, destinationRule: snap.dr },
    createdAt,
  }
}
