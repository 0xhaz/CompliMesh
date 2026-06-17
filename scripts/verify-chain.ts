// CLI audit-chain verifier — recomputes every row_hash and reports intact or the
// first broken seq. Use it in the demo alongside scripts/tamper-demo.sql:
//   pnpm db:verify   (before and after tampering)

import { config } from 'dotenv'
config({ path: '.env.local' })

import { verifyAuditChain } from '../core/audit/hash'
import { fetchAuditChain } from '../core/audit/read'
import { getDb } from '../core/schema/db'

async function main() {
  const db = getDb()
  const rows = await fetchAuditChain(db)
  const result = verifyAuditChain(rows)
  console.log(`audit_log: ${rows.length} rows`)
  if (result.intact) {
    console.log('✅ CHAIN INTACT — every row_hash recomputes; no tampering detected.')
  } else {
    console.log(`❌ CHAIN BROKEN at seq ${result.brokenSeq}`)
    console.log(`   ${result.reason}`)
  }
  await (db as unknown as { $client?: { end?: () => Promise<void> } }).$client?.end?.()
  process.exit(result.intact ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
