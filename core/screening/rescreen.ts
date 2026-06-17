// Re-screening on list change (architecture-v2 §9 Tier 1 — the Haas failure
// mode: "a customer clean on Monday can be on the SDN list by Thursday").
//
//   loadListUpdate()  — simulate a CSL refresh: new RESTRICTED_PARTY snapshot
//                       that copies the prior list and newly sanctions a party
//                       matching an existing saved customer.
//   rescreenClient()  — re-screen every active customer of a client against the
//                       latest list (entity-focused) and report newly-flagged.
//
// Framework-agnostic (techstack §2.2): no React/Next imports.

import { sql } from 'drizzle-orm'
import { appendAudit } from '../audit/chain'
import { getDb } from '../schema/db'
import {
  controlHits as controlHitsTable,
  entities,
  products,
  refSnapshots,
  restrictedParties,
  screeningRuns,
} from '../schema/schema'
import type { Verdict } from '../types'
import { resolveDestination } from './destination'
import { type ClassificationResult } from './classify'
import { statusForVerdict } from './pipeline'
import { screenEntity } from './screen'
import { aggregateVerdict, resolveHits } from './verdict'

// The party a CSL refresh newly sanctions (matches saved customer of the same name).
const NEWLY_SANCTIONED = {
  listSource: 'OFAC_SDN',
  name: 'Pacific Components Ltd',
  country: 'AE',
  aliases: ['Pacific Components'],
}

export interface ListUpdateResult {
  snapshotId: string
  label: string
  addedParty: string
  alreadyCurrent: boolean
}

// Create a new RESTRICTED_PARTY snapshot = prior list + one newly-sanctioned party.
export async function loadListUpdate(): Promise<ListUpdateResult> {
  const db = getDb()
  const latest = (
    await db.execute(
      sql`SELECT id, label FROM ref_snapshots WHERE source_type = 'RESTRICTED_PARTY' ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
  ).rows[0]
  if (!latest) throw new Error('No restricted-party snapshot — run `pnpm seed` first.')

  // Idempotent: if the latest snapshot already contains the newly-sanctioned
  // party, it's already current — don't keep stacking snapshots.
  const present = await db.execute(
    sql`SELECT 1 FROM restricted_parties WHERE snapshot_id = ${String(latest.id)} AND lower(name) = lower(${NEWLY_SANCTIONED.name}) LIMIT 1`,
  )
  if (present.rows[0]) {
    return { snapshotId: String(latest.id), label: String(latest.label), addedParty: NEWLY_SANCTIONED.name, alreadyCurrent: true }
  }

  const label = `US Consolidated Screening List (curated trim) · 2026-06-17 (refresh)`
  return db.transaction(async (tx) => {
    const [snap] = await tx
      .insert(refSnapshots)
      .values({ sourceType: 'RESTRICTED_PARTY', label })
      .returning({ id: refSnapshots.id })

    // Copy the prior list into the new snapshot…
    await tx.execute(sql`
      INSERT INTO restricted_parties (list_source, name, aliases, country, snapshot_id)
      SELECT list_source, name, aliases, country, ${snap.id}
      FROM restricted_parties WHERE snapshot_id = ${String(latest.id)}
    `)
    // …then add the newly-sanctioned party.
    await tx.insert(restrictedParties).values({
      listSource: NEWLY_SANCTIONED.listSource,
      name: NEWLY_SANCTIONED.name,
      aliases: NEWLY_SANCTIONED.aliases,
      country: NEWLY_SANCTIONED.country,
      snapshotId: snap.id,
    })

    return { snapshotId: snap.id, label, addedParty: NEWLY_SANCTIONED.name, alreadyCurrent: false }
  })
}

export interface RescreenContext {
  orgId: string
  clientId: string
  userId: string
  role: string
}

export interface RescreenFlag {
  customerId: string
  name: string
  verdict: Verdict
  score: number
  reason: string
}

export interface RescreenResult {
  rescreened: number
  newlyFlagged: RescreenFlag[]
  snapshotLabel: string
}

// Re-screen every active customer of a client against the latest list.
export async function rescreenClient(ctx: RescreenContext): Promise<RescreenResult> {
  const db = getDb()
  const snaps = (
    await db.execute(sql`
      SELECT DISTINCT ON (source_type) id, source_type, label
      FROM ref_snapshots ORDER BY source_type, created_at DESC, id DESC
    `)
  ).rows
  const by: Record<string, { id: string; label: string }> = {}
  for (const r of snaps) by[String(r.source_type)] = { id: String(r.id), label: String(r.label) }
  const rp = by['RESTRICTED_PARTY']
  const hs = by['HS']
  const dr = by['DESTINATION_RULE']
  if (!rp || !hs || !dr) throw new Error('Missing reference snapshots.')

  const custs = (
    await db.execute(
      sql`SELECT id, name, country FROM customers WHERE client_id = ${ctx.clientId} AND status = 'ACTIVE' ORDER BY name ASC`,
    )
  ).rows

  // Prior verdict per customer (before this re-screen) so we report only those
  // the list change NEWLY flagged — not parties already matching last time.
  const priorRows = (
    await db.execute(sql`
      SELECT DISTINCT ON (customer_id) customer_id, verdict
      FROM screening_runs
      WHERE client_id = ${ctx.clientId} AND customer_id IS NOT NULL
      ORDER BY customer_id, created_at DESC, id DESC
    `)
  ).rows
  const priorVerdict = new Map(priorRows.map((r) => [String(r.customer_id), String(r.verdict)]))

  // Entity-only classification stub (re-screen is about list changes, not HS).
  const cleanClassification: ClassificationResult = {
    hsCode: 'N/A',
    confidence: 1,
    belowFloor: false,
    description: 'Re-screen (entity-only)',
    source: 'lookup',
    reasoning: 'List-change re-screen',
  }

  const newlyFlagged: RescreenFlag[] = []
  let rescreened = 0

  for (const c of custs) {
    const customerId = String(c.id)
    const name = String(c.name)
    const country = c.country ? String(c.country) : '—'
    const entity = await screenEntity(db, name, rp.id)
    const destination = await resolveDestination(db, null, country, dr.id)
    const hits = resolveHits(cleanClassification, entity, destination)
    const { verdict, reason } = aggregateVerdict(hits)
    const status = statusForVerdict(verdict)
    const createdAt = new Date().toISOString()
    const actor = { userId: ctx.userId, role: ctx.role }

    await db.transaction(async (tx) => {
      const [product] = await tx
        .insert(products)
        .values({ description: '(re-screen — entity only)', hsCode: null, hsConfidence: null })
        .returning({ id: products.id })
      const [ent] = await tx.insert(entities).values({ name, country }).returning({ id: entities.id })
      const [run] = await tx
        .insert(screeningRuns)
        .values({
          productId: product.id,
          entityId: ent.id,
          destination: country,
          orgId: ctx.orgId,
          clientId: ctx.clientId,
          customerId,
          initiatedBy: ctx.userId,
          trigger: 'RESCREEN',
          status,
          rpSnapshotId: rp.id,
          hsSnapshotId: hs.id,
          drSnapshotId: dr.id,
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
            matchScore: h.matchScore === null ? null : String(Math.round(h.matchScore * 10000) / 10000),
            reason: h.reason,
            snapshotId: h.sourceType === 'RESTRICTED_PARTY' ? rp.id : null,
          })),
        )
      }

      await appendAudit(tx, {
        runId: run.id,
        eventType: 'RESCREEN',
        payload: { actor, customer: name, againstSnapshot: rp.label, trigger: 'RESCREEN' },
        createdAt,
      })
      await appendAudit(tx, {
        runId: run.id,
        eventType: 'VERDICT',
        payload: { actor, verdict, status, reason },
        createdAt,
      })
    })

    rescreened++
    // "Newly flagged" = was clean (GO or never screened) before, now flagged.
    const prev = priorVerdict.get(customerId) ?? null
    if (verdict !== 'GO' && (prev === null || prev === 'GO')) {
      newlyFlagged.push({ customerId, name, verdict, score: entity.score, reason })
    }
  }

  return { rescreened, newlyFlagged, snapshotLabel: rp.label }
}
