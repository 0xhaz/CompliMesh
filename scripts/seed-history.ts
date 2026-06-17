// Generates a spread of demo screening runs (with real audit chain) so the
// dashboard opens with believable history. Runs the tenant-aware pipeline.

import { sql } from 'drizzle-orm'
import { getDb } from '../core/schema/db'
import { runScreening } from '../core/screening/pipeline'

interface Entry {
  client: string
  customer: string
  product: string
  destination: string
}

// Maps to seeded customers; produces a spread of GO / REVIEW / NO_GO.
const ENTRIES: Entry[] = [
  { client: 'Northwind Electronics', customer: 'Bremer Elektronik GmbH', product: 'Consumer notebook computer, 14-inch, retail', destination: 'Germany (DE)' },
  { client: 'Northwind Electronics', customer: 'Hannover Tech Distribution', product: 'Network routing equipment, enterprise grade', destination: 'Germany (DE)' },
  { client: 'Sahara Components FZE', customer: 'Gulf Avionics Trading', product: 'Aircraft turbine engine components', destination: 'United Arab Emirates (AE)' },
  { client: 'Sahara Components FZE', customer: 'Hikvison Digital', product: 'High-resolution thermal / IR surveillance camera module', destination: 'United Arab Emirates (AE)' },
  { client: 'Sahara Components FZE', customer: 'Pacific Components Ltd', product: 'Electronic integrated circuits — processors', destination: 'United Arab Emirates (AE)' },
  { client: 'Pacific Instruments', customer: 'Mahan Air', product: 'Aircraft turbine engine components', destination: 'Iran (IR)' },
  { client: 'Pacific Instruments', customer: 'Tokyo Sensor Works', product: 'Radar apparatus', destination: 'Japan (JP)' },
]

export async function generateDemoHistory(): Promise<number> {
  const db = getDb()
  const org = (await db.execute(sql`SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1`)).rows[0]
  if (!org) return 0
  const orgId = String(org.id)
  const initiator = (
    await db.execute(sql`SELECT id, role FROM users WHERE org_id = ${orgId} AND role = 'INITIATOR' LIMIT 1`)
  ).rows[0]
  const userId = initiator ? String(initiator.id) : null
  const role = initiator ? String(initiator.role) : null

  let count = 0
  for (const e of ENTRIES) {
    const client = (
      await db.execute(sql`SELECT id FROM clients WHERE org_id = ${orgId} AND name = ${e.client} LIMIT 1`)
    ).rows[0]
    if (!client) continue
    const clientId = String(client.id)
    const cust = (
      await db.execute(
        sql`SELECT id FROM customers WHERE client_id = ${clientId} AND lower(name) = lower(${e.customer}) LIMIT 1`,
      )
    ).rows[0]
    const customerId = cust ? String(cust.id) : null

    await runScreening(
      { product: e.product, counterparty: e.customer, destination: e.destination },
      { orgId, clientId, customerId, initiatedBy: userId, actorRole: role, trigger: 'MANUAL' },
    )
    count++
  }
  return count
}
