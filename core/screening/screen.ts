// SCREEN step (architecture §4.2–4.3 / techstack §5.2): fuzzy-match the
// counterparty name against restricted_parties using pg_trgm trigram similarity.
// Both the stored name (and its aliases) and the input are normalized in SQL
// with the SAME transformation as normalize.ts, so scoring is symmetric and
// corporate-suffix noise doesn't inflate similarity.
//
// This is the "correct Postgres tool" showcase — trigram similarity for
// "Huawei Technologies" vs "Huawei Tech Co Ltd" vs transliterated aliases.
//
// Framework-agnostic (techstack §2.2): no React/Next imports.

import { type SQL, sql } from 'drizzle-orm'
import { STOPWORDS } from './normalize'

// Similarity bands (architecture §4.3 — starting values, tuned against real CSL
// data in Phase 3: exact 1.00, confident fuzzy ~0.69, clean ~0.04).
export const BANDS = {
  EXACT: 0.95, // >= EXACT  -> exact normalized match    -> NO_GO
  CONFIDENT: 0.6, // >= 0.6 -> confident fuzzy match     -> REVIEW (strong flag)
  GREY: 0.3, // >= 0.3      -> grey-zone fuzzy match      -> REVIEW
  // < 0.3                  -> clean, no hit
} as const

export type EntityBand = 'EXACT' | 'CONFIDENT' | 'GREY' | 'CLEAR'

export interface EntityResult {
  band: EntityBand
  partyId: string | null
  partyName: string | null
  listSource: string | null
  score: number // 0..1 pg_trgm similarity (normalized)
}

// SQL normalization mirroring normalize.ts, applied to a SQL fragment (a column
// like rp.name, or a bound input value). Regex patterns are passed as bound
// PARAMETERS — no injection risk, and no JS template-literal escape pitfalls.
// \m / \M are Postgres regex word boundaries (literal backslashes in JS source).
const STOPWORD_PATTERN = `\\m(${STOPWORDS.join('|')})\\M`
function NORM(expr: SQL): SQL {
  return sql`regexp_replace(regexp_replace(regexp_replace(lower(${expr}), ${'[.,]'}, ${''}, ${'g'}), ${STOPWORD_PATTERN}, ${''}, ${'g'}), ${'\\s+'}, ${' '}, ${'g'})`
}

function bandFor(score: number): EntityBand {
  if (score >= BANDS.EXACT) return 'EXACT'
  if (score >= BANDS.CONFIDENT) return 'CONFIDENT'
  if (score >= BANDS.GREY) return 'GREY'
  return 'CLEAR'
}

// `db` is a Drizzle client or transaction (anything with .execute(sql)).
export async function screenEntity(
  db: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }> },
  counterparty: string,
  rpSnapshotId: string,
): Promise<EntityResult> {
  const normInput = NORM(sql`${counterparty}`)
  const res = await db.execute(sql`
    WITH cand AS (
      SELECT
        rp.id,
        rp.name,
        rp.list_source,
        GREATEST(
          similarity(${NORM(sql`rp.name`)}, ${normInput}),
          COALESCE(
            (SELECT MAX(similarity(${NORM(sql`a.alias`)}, ${normInput}))
             FROM jsonb_array_elements_text(rp.aliases) AS a(alias)),
            0
          )
        ) AS score
      FROM restricted_parties rp
      WHERE rp.snapshot_id = ${rpSnapshotId}
    )
    SELECT id, name, list_source, score
    FROM cand
    ORDER BY score DESC
    LIMIT 1
  `)

  const top = res.rows[0]
  const score = top ? Math.round(Number(top.score) * 1000) / 1000 : 0
  const band = bandFor(score)

  if (band === 'CLEAR' || !top) {
    return { band: 'CLEAR', partyId: null, partyName: null, listSource: null, score }
  }
  return {
    band,
    partyId: String(top.id),
    partyName: String(top.name),
    listSource: String(top.list_source),
    score,
  }
}
