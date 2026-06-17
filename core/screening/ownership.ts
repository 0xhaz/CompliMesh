// OWNERSHIP step — OFAC 50%-rule screening (architecture-v2 §9 Tier 1).
// An entity owned ≥50% by one or more sanctioned parties is itself treated as
// blocked, even if its own name screens clean (the Haas failure mode: a Dubai
// distributor clean for 18 months until a shareholder hit 51% designation).
//
// We look up the counterparty's owners in the curated ownership graph, then
// screen each OWNER against the restricted-party list with the SAME pg_trgm
// matching used for the entity itself — so the moat data (the party list) is
// reused, and ownership inherits its quality.
//
// Framework-agnostic (techstack §2.2): no React/Next imports.

import { sql } from 'drizzle-orm'
import { screenEntity } from './screen'

export interface OwnerResult {
  name: string
  pct: number
  sanctioned: boolean
  matchedParty: string | null
  score: number
}

export interface OwnershipResult {
  hasData: boolean // ownership graph had entries for this counterparty
  totalSanctionedPct: number // aggregate % held by sanctioned owners
  owners: OwnerResult[]
}

interface Db {
  execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }>
}

const EMPTY: OwnershipResult = { hasData: false, totalSanctionedPct: 0, owners: [] }

export async function resolveOwnership(
  db: Db,
  counterparty: string,
  rpSnapshotId: string,
  ownSnapshotId: string,
): Promise<OwnershipResult> {
  const res = await db.execute(sql`
    SELECT owner_name, owner_pct
    FROM party_ownership
    WHERE snapshot_id = ${ownSnapshotId} AND lower(subject_name) = lower(${counterparty})
  `)
  if (res.rows.length === 0) return EMPTY

  const owners: OwnerResult[] = []
  let totalSanctionedPct = 0
  for (const row of res.rows) {
    const name = String(row.owner_name)
    const pct = Number(row.owner_pct)
    // An owner counts as sanctioned on a confident-or-exact match (≥0.6) to the
    // restricted-party list — a fuzzy name guess alone doesn't trigger the rule.
    const hit = await screenEntity(db, name, rpSnapshotId)
    const sanctioned = hit.band === 'EXACT' || hit.band === 'CONFIDENT'
    if (sanctioned) totalSanctionedPct += pct
    owners.push({ name, pct, sanctioned, matchedParty: hit.partyName, score: hit.score })
  }
  return { hasData: true, totalSanctionedPct: Math.round(totalSanctionedPct * 100) / 100, owners }
}
