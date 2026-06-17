// View-model for the dashboard UI (Phase 6). Maps the real RunResult and DB
// rows into the shapes the v0 components consume. Pure + DB-as-parameter only —
// NO server-only imports, so client components can import these TYPES safely.
//
// Framework-agnostic (techstack §2.2): no React/Next imports.

import { sql } from 'drizzle-orm'
import type { RunStatus, Verdict } from '../types'
import type { RunResult } from './pipeline'

export type { Verdict, RunStatus }

export interface ScreeningView {
  id: string
  runId: string
  timestamp: string
  status: RunStatus
  trigger: string
  clientName: string | null
  customerName: string | null
  initiator: string | null
  input: { product: string; counterparty: string; destination: string }
  verdict: Verdict
  classification: {
    hsCode: string
    confidence: number
    belowFloor: boolean
    description: string | null
  }
  entity: {
    state: 'CLEAR' | 'MATCH_FUZZY' | 'MATCH_EXACT'
    matchedParty: string | null
    matchScore: number | null
    list: string | null
  }
  destination: {
    state: 'ALLOWED' | 'LICENSE_REQUIRED' | 'PROHIBITED'
    country: string
    rule: string
  }
  // Beneficial-ownership sub-check (OFAC 50% rule). Optional — only present on
  // a fresh run; history rows omit it.
  ownership?: {
    state: 'BLOCKED' | 'RISK' | 'CLEAR' | 'NO_DATA'
    sanctionedPct: number
    topOwner: string | null
  }
  rulesetSnapshot: string
  reason: string
}

// Back-compat alias so components only change the import path, not the type name.
export type ScreeningResult = ScreeningView

function formatRunId(runId: string, createdAt: string): string {
  const d = new Date(createdAt)
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  return `SCR-${ymd}-${runId.replace(/-/g, '').slice(0, 6).toUpperCase()}`
}

function entityState(band: RunResult['entity']['band']): ScreeningView['entity']['state'] {
  if (band === 'EXACT') return 'MATCH_EXACT'
  if (band === 'CONFIDENT' || band === 'GREY') return 'MATCH_FUZZY'
  return 'CLEAR'
}

function destinationRuleText(d: RunResult['destination']): string {
  if (d.notes) return d.notes
  if (d.ruleType === 'ALLOWED') return 'No license requirement for this destination.'
  if (d.ruleType === 'LICENSE_REQUIRED') return 'Export license required.'
  return 'Destination prohibited for this item.'
}

// Full view from a fresh pipeline run.
export function toScreeningView(run: RunResult): ScreeningView {
  return {
    id: formatRunId(run.runId, run.createdAt),
    runId: run.runId,
    timestamp: run.createdAt,
    status: run.status,
    trigger: 'MANUAL',
    clientName: null,
    customerName: null,
    initiator: null,
    input: {
      product: '', // filled by caller from input; see runScreeningAction
      counterparty: '',
      destination: '',
    },
    verdict: run.verdict,
    classification: {
      hsCode: run.classification.hsCode ?? '—',
      confidence: run.classification.confidence,
      belowFloor: run.classification.belowFloor,
      description: run.classification.description ?? run.classification.reasoning,
    },
    entity: {
      state: entityState(run.entity.band),
      matchedParty: run.entity.partyName,
      matchScore: run.entity.band === 'CLEAR' ? null : run.entity.score,
      list: run.entity.listSource,
    },
    destination: {
      state: run.destination.ruleType,
      country: run.destination.country,
      rule: destinationRuleText(run.destination),
    },
    ownership: run.ownership
      ? {
          state: !run.ownership.hasData
            ? 'NO_DATA'
            : run.ownership.totalSanctionedPct >= 50
              ? 'BLOCKED'
              : run.ownership.totalSanctionedPct > 0
                ? 'RISK'
                : 'CLEAR',
          sanctionedPct: run.ownership.totalSanctionedPct,
          topOwner:
            run.ownership.owners.find((o) => o.sanctioned)?.matchedParty ??
            run.ownership.owners.find((o) => o.sanctioned)?.name ??
            null,
        }
      : undefined,
    rulesetSnapshot: run.snapshots.restrictedParty.label,
    reason: run.reason,
  }
}

interface Db {
  execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }>
}

export interface ListRunsOptions {
  clientId?: string | null // filter to one client (forwarder client-switcher)
  orgId?: string | null // filter to one org
  status?: RunStatus | null // filter by workflow status (review queue)
  limit?: number
}

// History list (reconstructed from DB; enriched with client/customer/initiator).
export async function listRecentRuns(db: Db, opts: ListRunsOptions = {}): Promise<ScreeningView[]> {
  const limit = opts.limit ?? 50
  const filters = [sql`TRUE`]
  if (opts.clientId) filters.push(sql`sr.client_id = ${opts.clientId}`)
  if (opts.orgId) filters.push(sql`sr.org_id = ${opts.orgId}`)
  if (opts.status) filters.push(sql`sr.status = ${opts.status}`)
  const where = sql.join(filters, sql` AND `)

  const runs = await db.execute(sql`
    SELECT sr.id, sr.destination, sr.verdict, sr.status, sr.trigger, sr.created_at,
           p.description AS product, p.hs_code, p.hs_confidence,
           e.name AS counterparty,
           rps.label AS rp_label,
           cl.name AS client_name,
           cu.name AS customer_name,
           u.name AS initiator_name,
           (SELECT rp.name FROM control_hits ch
              JOIN restricted_parties rp ON rp.id = ch.source_ref_id
              WHERE ch.run_id = sr.id AND ch.dimension = 'ENTITY' AND ch.rule_type = 'FUZZY_MATCH'
              LIMIT 1) AS fuzzy_party
    FROM screening_runs sr
    JOIN products p ON p.id = sr.product_id
    JOIN entities e ON e.id = sr.entity_id
    JOIN ref_snapshots rps ON rps.id = sr.rp_snapshot_id
    LEFT JOIN clients cl ON cl.id = sr.client_id
    LEFT JOIN customers cu ON cu.id = sr.customer_id
    LEFT JOIN users u ON u.id = sr.initiated_by
    WHERE ${where}
    ORDER BY sr.created_at DESC, sr.id DESC
    LIMIT ${limit}
  `)
  if (runs.rows.length === 0) return []

  const ids = runs.rows.map((r) => String(r.id))
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )
  const hitsRes = await db.execute(sql`
    SELECT run_id, dimension, rule_type, match_score, reason
    FROM control_hits
    WHERE run_id IN (${idList})
  `)
  const hitsByRun = new Map<string, Record<string, unknown>[]>()
  for (const h of hitsRes.rows) {
    const k = String(h.run_id)
    if (!hitsByRun.has(k)) hitsByRun.set(k, [])
    hitsByRun.get(k)!.push(h)
  }

  return runs.rows.map((r) => {
    const runId = String(r.id)
    const hits = hitsByRun.get(runId) ?? []
    const entityHit = hits.find((h) => h.dimension === 'ENTITY')
    const destHit = hits.find((h) => h.dimension === 'HS_COUNTRY')
    const lowConf = hits.some((h) => h.dimension === 'CONFIDENCE')
    const createdAt = (r.created_at as Date | string)
    const createdIso = (createdAt instanceof Date ? createdAt : new Date(createdAt)).toISOString()

    const entState: ScreeningView['entity']['state'] = entityHit
      ? entityHit.rule_type === 'PROHIBITED'
        ? 'MATCH_EXACT'
        : 'MATCH_FUZZY'
      : 'CLEAR'
    const destState: ScreeningView['destination']['state'] =
      (destHit?.rule_type as ScreeningView['destination']['state']) ?? 'ALLOWED'

    return {
      id: formatRunId(runId, createdIso),
      runId,
      timestamp: createdIso,
      status: (r.status as RunStatus) ?? 'CLEARED',
      trigger: r.trigger ? String(r.trigger) : 'MANUAL',
      clientName: r.client_name ? String(r.client_name) : null,
      customerName: r.customer_name ? String(r.customer_name) : null,
      initiator: r.initiator_name ? String(r.initiator_name) : null,
      input: {
        product: String(r.product),
        counterparty: String(r.counterparty),
        destination: String(r.destination),
      },
      verdict: String(r.verdict) as Verdict,
      classification: {
        hsCode: r.hs_code ? String(r.hs_code) : '—',
        confidence: r.hs_confidence ? Number(r.hs_confidence) : 0,
        belowFloor: lowConf,
        description: null,
      },
      entity: {
        state: entState,
        matchedParty: r.fuzzy_party ? String(r.fuzzy_party) : null,
        matchScore: entityHit?.match_score ? Number(entityHit.match_score) : null,
        list: null,
      },
      destination: {
        state: destState,
        country: String(r.destination),
        rule: destHit ? String(destHit.reason) : 'No license requirement for this destination.',
      },
      rulesetSnapshot: String(r.rp_label),
      reason: hits.length ? hits.map((h) => String(h.reason)).join(' ') : 'All three controls cleared.',
    }
  })
}
