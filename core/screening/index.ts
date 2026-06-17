// CompliMesh screening domain logic + tamper-evident audit chain.
// This is demo logic: deterministic, synchronous, no network. It models how a
// real screening would resolve three controls into one verdict, and how an
// append-only audit ledger chains each event by hash.

export type Verdict = 'GO' | 'REVIEW' | 'NO_GO'

export type CheckState =
  | 'CLEAR'
  | 'MATCH_FUZZY'
  | 'MATCH_EXACT'
  | 'BELOW_FLOOR'
  | 'ALLOWED'
  | 'LICENSE_REQUIRED'
  | 'PROHIBITED'

export interface ClassificationResult {
  hsCode: string
  confidence: number // 0..1
  belowFloor: boolean
  description: string
}

export interface EntityResult {
  state: 'CLEAR' | 'MATCH_FUZZY' | 'MATCH_EXACT'
  matchedParty: string | null
  matchScore: number | null // 0..1
  list: string | null
}

export interface DestinationResult {
  state: 'ALLOWED' | 'LICENSE_REQUIRED' | 'PROHIBITED'
  country: string
  rule: string
}

export interface ScreeningInput {
  product: string
  counterparty: string
  destination: string
}

export interface ScreeningResult {
  id: string
  timestamp: string
  input: ScreeningInput
  verdict: Verdict
  classification: ClassificationResult
  entity: EntityResult
  destination: DestinationResult
  rulesetSnapshot: string
  reason: string
}

// Confidence floor below which classification forces a REVIEW.
export const CONFIDENCE_FLOOR = 0.7

// Stable ruleset snapshot id, stamped like a serial number.
export const RULESET_SNAPSHOT = 'CSL snapshot · 2026-06-12'

function deriveVerdict(
  classification: ClassificationResult,
  entity: EntityResult,
  destination: DestinationResult,
): { verdict: Verdict; reason: string } {
  // Hard stops first.
  if (entity.state === 'MATCH_EXACT') {
    return {
      verdict: 'NO_GO',
      reason: `Exact match to restricted party (${entity.matchedParty}) on ${entity.list}.`,
    }
  }
  if (destination.state === 'PROHIBITED') {
    return {
      verdict: 'NO_GO',
      reason: `Destination prohibited for this classification — ${destination.rule}.`,
    }
  }

  // Things that require human review.
  if (entity.state === 'MATCH_FUZZY') {
    return {
      verdict: 'REVIEW',
      reason: `Possible (fuzzy) match to ${entity.matchedParty} at ${entity.matchScore?.toFixed(
        2,
      )}. Confirm identity before proceeding.`,
    }
  }
  if (destination.state === 'LICENSE_REQUIRED') {
    return {
      verdict: 'REVIEW',
      reason: `Export license required for this item to ${destination.country} — ${destination.rule}.`,
    }
  }
  if (classification.belowFloor) {
    return {
      verdict: 'REVIEW',
      reason: `Classification confidence ${classification.confidence.toFixed(
        2,
      )} is below the ${CONFIDENCE_FLOOR.toFixed(2)} floor. Confirm the HS code.`,
    }
  }

  return {
    verdict: 'GO',
    reason: 'All three controls cleared under the current ruleset.',
  }
}

export function runScreening(
  input: ScreeningInput,
  overrides?: {
    classification?: Partial<ClassificationResult>
    entity?: Partial<EntityResult>
    destination?: Partial<DestinationResult>
  },
): ScreeningResult {
  const classification: ClassificationResult = {
    hsCode: '8471.30',
    confidence: 0.82,
    belowFloor: false,
    description: 'Portable automatic data-processing machines',
    ...overrides?.classification,
  }
  classification.belowFloor = classification.confidence < CONFIDENCE_FLOOR

  const entity: EntityResult = {
    state: 'CLEAR',
    matchedParty: null,
    matchScore: null,
    list: null,
    ...overrides?.entity,
  }

  const destination: DestinationResult = {
    state: 'ALLOWED',
    country: input.destination || 'Unknown',
    rule: 'No license requirement for this HS code and destination.',
    ...overrides?.destination,
  }

  const { verdict, reason } = deriveVerdict(classification, entity, destination)

  return {
    id: makeId(),
    timestamp: new Date().toISOString(),
    input,
    verdict,
    classification,
    entity,
    destination,
    rulesetSnapshot: RULESET_SNAPSHOT,
    reason,
  }
}

let idCounter = 0
function makeId(): string {
  idCounter += 1
  const t = Date.now().toString(36).toUpperCase()
  return `SCR-${t}-${idCounter.toString().padStart(3, '0')}`
}

// ---- Seeded example scenarios (one of each verdict) ----

export interface Scenario {
  key: string
  label: string
  expected: Verdict
  input: ScreeningInput
  overrides: Parameters<typeof runScreening>[1]
}

export const SCENARIOS: Scenario[] = [
  {
    key: 'go',
    label: 'Clean consumer laptop → Germany',
    expected: 'GO',
    input: {
      product: 'Consumer notebook computer, 14-inch, retail',
      counterparty: 'Bremer Elektronik GmbH',
      destination: 'Germany (DE)',
    },
    overrides: {
      classification: {
        hsCode: '8471.30',
        confidence: 0.94,
        description: 'Portable automatic data-processing machines',
      },
      entity: { state: 'CLEAR' },
      destination: {
        state: 'ALLOWED',
        country: 'Germany (DE)',
        rule: 'EU member state — no license requirement.',
      },
    },
  },
  {
    key: 'nogo',
    label: 'Sanctioned buyer → restricted party hit',
    expected: 'NO_GO',
    input: {
      product: 'Network routing equipment, enterprise grade',
      counterparty: 'Volga-Dnepr Logistics LLC',
      destination: 'Russia (RU)',
    },
    overrides: {
      classification: {
        hsCode: '8517.62',
        confidence: 0.88,
        description: 'Machines for reception/transmission of data',
      },
      entity: {
        state: 'MATCH_EXACT',
        matchedParty: 'VOLGA-DNEPR LOGISTICS LLC',
        matchScore: 1.0,
        list: 'OFAC SDN',
      },
      destination: {
        state: 'PROHIBITED',
        country: 'Russia (RU)',
        rule: 'EAR §746.8 — license required, presumption of denial.',
      },
    },
  },
  {
    key: 'review',
    label: 'Dual-use sensor → license required',
    expected: 'REVIEW',
    input: {
      product: 'High-resolution thermal imaging sensor module',
      counterparty: 'Anadolu Savunma A.S.',
      destination: 'Türkiye (TR)',
    },
    overrides: {
      classification: {
        hsCode: '8525.83',
        confidence: 0.63,
        description: 'Cameras incorporating night-vision/thermal sensors',
      },
      entity: {
        state: 'MATCH_FUZZY',
        matchedParty: 'Anadolu Savunma Sanayi',
        matchScore: 0.61,
        list: 'BIS Entity List',
      },
      destination: {
        state: 'LICENSE_REQUIRED',
        country: 'Türkiye (TR)',
        rule: 'ECCN 6A003 — license required for thermal imaging.',
      },
    },
  },
]
