// View-model for the dashboard UI (Phase 6). Maps the real RunResult and DB
// rows into the shapes the v0 components consume. Pure + DB-as-parameter only —
// NO server-only imports, so client components can import these TYPES safely.
//
// Framework-agnostic (techstack §2.2): no React/Next imports.

import { sql } from 'drizzle-orm'
import type { Verdict } from '../types'
import type { RunResult } from './pipeline'

export type { Verdict }

export interface ScreeningView {
  id: string
  timestamp: string
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
    timestamp: run.createdAt,
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
    rulesetSnapshot: run.snapshots.restrictedParty.label,
    reason: run.reason,
  }
}

interface Db {
  execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }>
}

// History list (best-effort reconstruction from DB; HistoryView only renders
// timestamp / product / hsCode / counterparty / destination / verdict).
export async function listRecentRuns(db: Db, limit = 25): Promise<ScreeningView[]> {
  const runs = await db.execute(sql`
    SELECT sr.id, sr.destination, sr.verdict, sr.created_at,
           p.description AS product, p.hs_code, p.hs_confidence,
           e.name AS counterparty,
           rps.label AS rp_label
    FROM screening_runs sr
    JOIN products p ON p.id = sr.product_id
    JOIN entities e ON e.id = sr.entity_id
    JOIN ref_snapshots rps ON rps.id = sr.rp_snapshot_id
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
      timestamp: createdIso,
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
        matchedParty: null,
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
