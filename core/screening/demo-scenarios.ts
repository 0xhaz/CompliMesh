// Canonical demo scenarios — the three verdicts the demo must show
// (architecture §7 / techstack §4.3). These are INPUTS run live through the
// screening pipeline (Phase 4); the seed (scripts/seed.ts) loads reference data
// such that each input resolves to its `expected` verdict deterministically.
//
// Framework-agnostic (techstack §2.2): no React/Next imports. Used by Phase 4
// pipeline tests and the Phase 6 UI "load a scenario" affordance.
//
// Keep this in sync with scripts/seed.ts — the `hits` notes below name the exact
// seeded rows each scenario is designed to fire.

import type { Verdict } from '../types'

export interface ScreeningInput {
  product: string
  counterparty: string
  destination: string // ISO-ish "Name (CC)" — pipeline parses the country code
}

export interface DemoScenario {
  key: string
  label: string
  expected: Verdict
  input: ScreeningInput
  /** Why it resolves the way it does — the seeded rows it is designed to hit. */
  hits: string[]
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    key: 'go',
    label: 'Clean consumer laptop → Germany',
    expected: 'GO',
    input: {
      product: 'Consumer notebook computer, 14-inch, retail packaged',
      counterparty: 'Bremer Elektronik GmbH',
      destination: 'Germany (DE)',
    },
    hits: [
      'ENTITY: no match — Bremer Elektronik GmbH is not on the curated CSL trim',
      'CLASSIFICATION: HS 8471.30 high confidence (laptop) — above floor',
      'DESTINATION: DE × 8471 → ALLOWED (EU member state)',
      '=> zero control_hits => GO',
    ],
  },
  {
    key: 'nogo',
    label: 'Sanctioned airline (exact SDN match) → Iran',
    expected: 'NO_GO',
    input: {
      product: 'Aircraft turbine engine components',
      counterparty: 'Mahan Air',
      destination: 'Iran (IR)',
    },
    hits: [
      'ENTITY: exact normalized match to OFAC SDN "Mahan Air" => PROHIBITED => NO_GO',
      'DESTINATION: IR × 8411 → PROHIBITED (Iran embargo) — reinforces NO_GO',
      '=> worst hit PROHIBITED => NO_GO',
    ],
  },
  {
    key: 'review',
    label: 'Dual-use thermal camera (fuzzy match + license) → UAE',
    expected: 'REVIEW',
    input: {
      product: 'High-resolution thermal / IR surveillance camera module',
      counterparty: 'Hikvision Digital Tech',
      destination: 'United Arab Emirates (AE)',
    },
    hits: [
      'ENTITY: fuzzy match to BIS Entity List "Hangzhou Hikvision Digital Technology Co., Ltd." (not exact) => FUZZY_MATCH => REVIEW',
      'CLASSIFICATION: HS 8525.89 thermal/IR — dual-use flagged',
      'DESTINATION: AE × 8525 → LICENSE_REQUIRED (re-export risk, ECCN 6A003) => REVIEW',
      '=> no PROHIBITED, has FUZZY_MATCH + LICENSE_REQUIRED => REVIEW',
    ],
  },
]
