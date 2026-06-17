// Deterministic demo seed (architecture §2.1 / techstack §4.3).
// Rebuilds the demo DB to a known state so it can be torn down and re-recorded.
//
//   Restricted parties → REAL data: a curated trim of the US Consolidated
//     Screening List (CSL) — genuine BIS Entity List / OFAC SDN parties, only
//     the slice the demo scenarios hit. Refresh from the live CSL for production.
//   HS reference        → curated synthetic subset (only demo product categories).
//   Destination rules   → curated synthetic (country × HS-prefix → rule_type).
//
// Each source lands under its own ref_snapshot (per-source versioning, §2.3).
// The three demo scenarios (core/screening/demo-scenarios.ts) resolve against
// this data to GO / NO_GO / REVIEW.
//
// Run: pnpm seed   (needs a valid VERCEL_OIDC_TOKEN — `vercel env pull` to refresh)

import { config } from 'dotenv'
config({ path: '.env.local' })

import { sql } from 'drizzle-orm'
import { getDb } from '../core/schema/db'
import {
  destinationRules,
  hsReference,
  refSnapshots,
  restrictedParties,
} from '../core/schema/schema'

const SNAPSHOT_DATE = '2026-06-12'

// ── Restricted parties: curated trim of the REAL US Consolidated Screening List ──
// Genuine listed parties. `name` is the canonical list name; `aliases` carry
// common short forms / transliterations that fuzzy matching should also catch.
const RESTRICTED_PARTIES = [
  { listSource: 'BIS_ENTITY', name: 'Huawei Technologies Co., Ltd.', country: 'China', aliases: ['Huawei', 'Huawei Technologies'] },
  { listSource: 'BIS_ENTITY', name: 'Hangzhou Hikvision Digital Technology Co., Ltd.', country: 'China', aliases: ['Hikvision', 'Hikvision Digital Technology'] },
  { listSource: 'BIS_ENTITY', name: 'Semiconductor Manufacturing International Corporation', country: 'China', aliases: ['SMIC'] },
  { listSource: 'BIS_ENTITY', name: 'Dahua Technology Co., Ltd.', country: 'China', aliases: ['Dahua'] },
  { listSource: 'BIS_ENTITY', name: 'AO Kaspersky Lab', country: 'Russia', aliases: ['Kaspersky', 'Kaspersky Lab'] },
  { listSource: 'OFAC_SDN', name: 'Mahan Air', country: 'Iran', aliases: ['Mahan Airlines'] },
  { listSource: 'OFAC_SDN', name: 'Rosoboronexport', country: 'Russia', aliases: ['Rosoboron Export', 'JSC Rosoboronexport'] },
  { listSource: 'OFAC_SDN', name: 'Concord Management and Consulting LLC', country: 'Russia', aliases: ['Concord Management'] },
  { listSource: 'OFAC_SDN', name: 'Tornado Cash', country: null, aliases: ['TornadoCash'] },
  { listSource: 'OFAC_SDN', name: 'PMC Wagner', country: 'Russia', aliases: ['Wagner Group', 'Wagner'] },
] as const

// ── HS reference: curated synthetic subset (only the demo product categories) ──
const HS_REFERENCE = [
  { hsCode: '8471.30', description: 'Portable automatic data-processing machines (laptops/notebooks), ≤10kg', controlFlags: { dualUse: false } },
  { hsCode: '8471.41', description: 'Other automatic data-processing machines (desktops)', controlFlags: { dualUse: false } },
  { hsCode: '8517.62', description: 'Machines for reception, conversion & transmission of voice/data (routers, switches)', controlFlags: { dualUse: false } },
  { hsCode: '8525.89', description: 'Television cameras, digital cameras & video camera recorders — incl. thermal/IR imaging modules', controlFlags: { dualUse: true, note: 'thermal/IR may be controlled — ECCN 6A003' } },
  { hsCode: '8526.10', description: 'Radar apparatus', controlFlags: { dualUse: true, military: true } },
  { hsCode: '8411.91', description: 'Parts of turbojets or turbopropellers', controlFlags: { dualUse: true, military: true } },
  { hsCode: '8542.31', description: 'Electronic integrated circuits — processors and controllers', controlFlags: { dualUse: true } },
  { hsCode: '9013.80', description: 'Other optical devices, appliances and instruments (lasers, LCDs)', controlFlags: { dualUse: true } },
] as const

// ── Destination rules: curated synthetic (PREFIX match on HS, §3.1) ──
// rule_type ALLOWED rows are explicit documentation; absence of a rule is also
// treated as allowed by the pipeline (no hit).
const DESTINATION_RULES = [
  { hsCodePrefix: '8471', country: 'DE', ruleType: 'ALLOWED', notes: 'EU member state — no license requirement.' },
  { hsCodePrefix: '8517', country: 'DE', ruleType: 'ALLOWED', notes: 'EU member state — no license requirement.' },
  { hsCodePrefix: '8411', country: 'IR', ruleType: 'PROHIBITED', notes: 'Iran embargo — EAR presumption of denial.' },
  { hsCodePrefix: '85', country: 'IR', ruleType: 'PROHIBITED', notes: 'OFAC Iran sanctions program — broad prohibition.' },
  { hsCodePrefix: '8525', country: 'AE', ruleType: 'LICENSE_REQUIRED', notes: 'Re-export diversion risk — thermal/IR camera, ECCN 6A003 license required.' },
  { hsCodePrefix: '8542', country: 'CN', ruleType: 'LICENSE_REQUIRED', notes: 'Advanced computing / semiconductor controls — license required.' },
  { hsCodePrefix: '8526', country: 'CN', ruleType: 'LICENSE_REQUIRED', notes: 'Radar — military end-use review.' },
  { hsCodePrefix: '8542', country: 'RU', ruleType: 'PROHIBITED', notes: 'EAR §746.8 Russia — semiconductors prohibited.' },
  { hsCodePrefix: '8411', country: 'RU', ruleType: 'PROHIBITED', notes: 'EAR §746.8 Russia — aerospace items prohibited.' },
  { hsCodePrefix: '8525', country: 'TR', ruleType: 'LICENSE_REQUIRED', notes: 'Thermal imaging — license required.' },
] as const

async function main() {
  const db = getDb()

  // Wipe to a known state. postgres (the master/owner role) can TRUNCATE
  // audit_log; the append-only REVOKE/trigger only block UPDATE/DELETE.
  console.log('▶ truncating all tables…')
  await db.execute(
    sql`TRUNCATE products, entities, ref_snapshots, restricted_parties, hs_reference, destination_rules, screening_runs, control_hits, audit_log RESTART IDENTITY CASCADE`,
  )

  // Per-source snapshots (§2.3) — each feed versions independently.
  console.log('▶ inserting ref_snapshots…')
  const [rp] = await db
    .insert(refSnapshots)
    .values({ sourceType: 'RESTRICTED_PARTY', label: `US Consolidated Screening List (curated trim) · ${SNAPSHOT_DATE}` })
    .returning()
  const [hs] = await db
    .insert(refSnapshots)
    .values({ sourceType: 'HS', label: `HS reference (demo subset) · ${SNAPSHOT_DATE}` })
    .returning()
  const [dr] = await db
    .insert(refSnapshots)
    .values({ sourceType: 'DESTINATION_RULE', label: `Destination control rules (demo) · ${SNAPSHOT_DATE}` })
    .returning()

  console.log('▶ inserting restricted_parties (real CSL trim)…')
  await db.insert(restrictedParties).values(
    RESTRICTED_PARTIES.map((p) => ({
      listSource: p.listSource,
      name: p.name,
      country: p.country,
      aliases: p.aliases,
      snapshotId: rp.id,
    })),
  )

  console.log('▶ inserting hs_reference (synthetic subset)…')
  await db.insert(hsReference).values(
    HS_REFERENCE.map((h) => ({
      hsCode: h.hsCode,
      description: h.description,
      controlFlags: h.controlFlags,
      snapshotId: hs.id,
    })),
  )

  console.log('▶ inserting destination_rules (synthetic)…')
  await db.insert(destinationRules).values(
    DESTINATION_RULES.map((d) => ({
      hsCodePrefix: d.hsCodePrefix,
      country: d.country,
      ruleType: d.ruleType,
      notes: d.notes,
      snapshotId: dr.id,
    })),
  )

  console.log(
    `\n✅ Seeded: ${RESTRICTED_PARTIES.length} restricted parties · ${HS_REFERENCE.length} HS codes · ${DESTINATION_RULES.length} destination rules · 3 snapshots.`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Seed failed:', err)
    process.exit(1)
  })
