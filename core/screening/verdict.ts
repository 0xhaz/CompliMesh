// RESOLVE + VERDICT (architecture §3, §4.2–4.3 / techstack §5.4–5.5).
// Every fired control becomes a uniform control_hit (Option C resolution layer).
// The verdict is an aggregation over hits — worst hit wins, GO is earned.
//
//   Governing principle: asymmetric, review-biased. A false negative (clearing
//   something that should stop) is catastrophic; a false positive is friction.
//   So GO requires ZERO hits; a fuzzy match never auto-prohibits.
//
// Framework-agnostic (techstack §2.2): no React/Next imports.

import type {
  HitDimension,
  HitRuleType,
  HitSourceType,
  Verdict,
} from '../types'
import type { ClassificationResult } from './classify'
import type { DestinationResult } from './destination'
import type { OwnershipResult } from './ownership'
import type { EntityResult } from './screen'

// ≥ this % of sanctioned ownership = the entity is itself blocked (OFAC 50% rule).
export const OWNERSHIP_BLOCK_THRESHOLD = 50

// A resolved control hit, ready to persist into control_hits.
export interface ControlHit {
  sourceType: HitSourceType
  sourceRefId: string | null
  dimension: HitDimension
  ruleType: HitRuleType
  matchScore: number | null
  reason: string
}

export interface VerdictResult {
  verdict: Verdict
  reason: string
  hits: ControlHit[]
}

// RESOLVE: emit a control_hit for every fired control.
export function resolveHits(
  classification: ClassificationResult,
  entity: EntityResult,
  destination: DestinationResult,
  ownership?: OwnershipResult,
): ControlHit[] {
  const hits: ControlHit[] = []

  // --- Entity (restricted-party) controls ---
  if (entity.band === 'EXACT') {
    // Exact normalized match -> hard stop.
    hits.push({
      sourceType: 'RESTRICTED_PARTY',
      sourceRefId: entity.partyId,
      dimension: 'ENTITY',
      ruleType: 'PROHIBITED',
      matchScore: entity.score,
      reason: `Exact match to restricted party "${entity.partyName}" on ${entity.listSource}.`,
    })
  } else if (entity.band === 'CONFIDENT' || entity.band === 'GREY') {
    // A fuzzy match never auto-prohibits (architecture §4.3, Knob 2) -> REVIEW.
    const strength = entity.band === 'CONFIDENT' ? 'Likely' : 'Possible'
    hits.push({
      sourceType: 'RESTRICTED_PARTY',
      sourceRefId: entity.partyId,
      dimension: 'ENTITY',
      ruleType: 'FUZZY_MATCH',
      matchScore: entity.score,
      reason: `${strength} match to "${entity.partyName}" on ${entity.listSource} (similarity ${entity.score.toFixed(2)}). Confirm identity before proceeding.`,
    })
  }

  // --- Destination control ---
  if (destination.ruleType === 'PROHIBITED') {
    hits.push({
      sourceType: 'DESTINATION_RULE',
      sourceRefId: destination.ruleId,
      dimension: 'HS_COUNTRY',
      ruleType: 'PROHIBITED',
      matchScore: null,
      reason: `Destination ${destination.country} prohibited for this item${destination.notes ? ` — ${destination.notes}` : ''}.`,
    })
  } else if (destination.ruleType === 'LICENSE_REQUIRED') {
    hits.push({
      sourceType: 'DESTINATION_RULE',
      sourceRefId: destination.ruleId,
      dimension: 'HS_COUNTRY',
      ruleType: 'LICENSE_REQUIRED',
      matchScore: null,
      reason: `Export license required to ${destination.country}${destination.notes ? ` — ${destination.notes}` : ''}.`,
    })
  }

  // --- Beneficial-ownership control (OFAC 50% rule) ---
  if (ownership?.hasData && ownership.totalSanctionedPct > 0) {
    const owner = ownership.owners.find((o) => o.sanctioned)
    const ownerDesc = owner ? `${owner.matchedParty ?? owner.name} (${owner.pct}%)` : 'a sanctioned party'
    if (ownership.totalSanctionedPct >= OWNERSHIP_BLOCK_THRESHOLD) {
      hits.push({
        sourceType: 'OWNERSHIP',
        sourceRefId: null,
        dimension: 'OWNERSHIP',
        ruleType: 'PROHIBITED',
        matchScore: ownership.totalSanctionedPct / 100,
        reason: `Owned ${ownership.totalSanctionedPct}% by sanctioned ownership — ${ownerDesc}. OFAC 50% rule: treated as blocked even though the name screens clean.`,
      })
    } else {
      hits.push({
        sourceType: 'OWNERSHIP',
        sourceRefId: null,
        dimension: 'OWNERSHIP',
        ruleType: 'OWNERSHIP_RISK',
        matchScore: ownership.totalSanctionedPct / 100,
        reason: `Partial sanctioned ownership (${ownership.totalSanctionedPct}%) — ${ownerDesc}. Below the 50% block threshold; conduct enhanced due diligence.`,
      })
    }
  }

  // --- Classification confidence floor ---
  if (classification.belowFloor) {
    hits.push({
      sourceType: 'CLASSIFICATION',
      sourceRefId: null,
      dimension: 'CONFIDENCE',
      ruleType: 'LOW_CONFIDENCE',
      matchScore: classification.confidence,
      reason: `Classification confidence ${classification.confidence.toFixed(2)} is below the ${0.6} floor — not confident enough about what this product is to clear it.`,
    })
  }

  return hits
}

// VERDICT: aggregate hits — worst wins. NO_GO > REVIEW > GO. Zero hits = GO.
export function aggregateVerdict(hits: ControlHit[]): VerdictResult {
  if (hits.some((h) => h.ruleType === 'PROHIBITED')) {
    const h = hits.find((h) => h.ruleType === 'PROHIBITED')!
    return { verdict: 'NO_GO', reason: h.reason, hits }
  }
  if (hits.length > 0) {
    // Any FUZZY_MATCH / LICENSE_REQUIRED / LOW_CONFIDENCE -> REVIEW.
    return {
      verdict: 'REVIEW',
      reason: hits.map((h) => h.reason).join(' '),
      hits,
    }
  }
  return {
    verdict: 'GO',
    reason: 'All three controls cleared under the current ruleset.',
    hits,
  }
}
