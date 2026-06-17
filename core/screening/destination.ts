// DESTINATION step (architecture §3.1, §4.2 / techstack §5.3): resolve the
// destination_rules for (HS-code PREFIX, country). PREFIX match (4–6 digit) so a
// rule on "85" covers "8525.89". Longest matching prefix wins (most specific).
//
// Framework-agnostic (techstack §2.2): no React/Next imports.

import { sql } from 'drizzle-orm'
import type { DestinationRuleType } from '../types'

export interface DestinationResult {
  ruleType: DestinationRuleType | 'ALLOWED' // ALLOWED when no rule matches
  ruleId: string | null
  notes: string | null
  country: string
}

// Parse a 2-letter ISO country code from inputs like "Germany (DE)" or "DE".
export function parseCountryCode(destination: string): string {
  const paren = destination.match(/\(([A-Za-z]{2})\)/)
  if (paren) return paren[1].toUpperCase()
  const bare = destination.trim().match(/^([A-Za-z]{2})$/)
  if (bare) return bare[1].toUpperCase()
  return destination.trim().toUpperCase()
}

// hsCode may be null (classification failed) — then there's no HS to match a
// destination rule against, so we return ALLOWED (the low-confidence hit from
// CLASSIFY already forces REVIEW; we don't invent a destination hit).
export async function resolveDestination(
  db: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }> },
  hsCode: string | null,
  destination: string,
  drSnapshotId: string,
): Promise<DestinationResult> {
  const country = parseCountryCode(destination)
  if (!hsCode) {
    return { ruleType: 'ALLOWED', ruleId: null, notes: null, country }
  }
  const digits = hsCode.replace(/\D/g, '') // "8525.89" -> "852589"

  const res = await db.execute(sql`
    SELECT id, rule_type, notes
    FROM destination_rules
    WHERE snapshot_id = ${drSnapshotId}
      AND country = ${country}
      AND ${digits} LIKE replace(hs_code_prefix, '.', '') || '%'
    ORDER BY length(replace(hs_code_prefix, '.', '')) DESC
    LIMIT 1
  `)

  const row = res.rows[0]
  if (!row) return { ruleType: 'ALLOWED', ruleId: null, notes: null, country }
  return {
    ruleType: String(row.rule_type) as DestinationRuleType,
    ruleId: String(row.id),
    notes: row.notes ? String(row.notes) : null,
    country,
  }
}
