// QuickBooks "watch & screen" webhook endpoint (architecture-v2 §10, stage 1:
// agentic trigger). In production, QuickBooks Online POSTs an event notification
// here when a Customer or Invoice is created; we'd verify the signature, fetch
// the entity via the QBO REST API, map it to (product, counterparty, destination),
// and screen it automatically — no human remembering to check.
//
// For the demo this endpoint accepts a NORMALIZED order directly (the shape we'd
// produce after fetching the QBO entity), so it's a real HTTP endpoint you can
// curl or trigger from the UI, without a live Intuit connection.
//
// Real QBO notification shape (documented, not required here):
//   { eventNotifications: [{ realmId, dataChangeEvent: { entities:
//       [{ name: "Invoice", id: "...", operation: "Create" }] } }] }

import { runScreening } from '@/core/screening/pipeline'
import { toScreeningView } from '@/core/screening/view'
import { getDb } from '@/core/schema/db'
import { findOrCreateCustomer } from '@/core/tenancy'

interface WebhookBody {
  context?: { orgId?: string; clientId?: string; clientName?: string }
  order?: { product?: string; counterparty?: string; destination?: string }
}

export async function GET() {
  // Self-documenting: what this endpoint expects.
  return Response.json({
    endpoint: '/api/integrations/quickbooks/webhook',
    method: 'POST',
    expects: {
      context: { orgId: 'uuid', clientId: 'uuid', clientName: 'string (optional)' },
      order: { product: 'string', counterparty: 'string', destination: 'string e.g. "Germany (DE)"' },
    },
    note: 'Production maps QuickBooks Online event notifications → this normalized order, then screens automatically as an autonomous control.',
  })
}

export async function POST(req: Request) {
  let body: WebhookBody
  try {
    body = (await req.json()) as WebhookBody
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const orgId = body.context?.orgId
  const clientId = body.context?.clientId
  const order = body.order
  if (!orgId || !clientId || !order?.product || !order?.counterparty) {
    return Response.json(
      { ok: false, error: 'Missing context.orgId/clientId or order.product/counterparty.' },
      { status: 400 },
    )
  }
  const destination = order.destination || 'Unknown'

  try {
    const customerId = await findOrCreateCustomer(getDb(), clientId, order.counterparty, null)
    // initiatedBy = null + role SYSTEM: this run was triggered by the integration,
    // not a person — the audit ledger records it as trigger=WEBHOOK, actor=SYSTEM.
    const run = await runScreening(
      { product: order.product, counterparty: order.counterparty, destination },
      { orgId, clientId, customerId, initiatedBy: null, actorRole: 'SYSTEM', trigger: 'WEBHOOK' },
    )
    const view = toScreeningView(run)
    view.input = { product: order.product, counterparty: order.counterparty, destination }
    view.customerName = order.counterparty
    view.clientName = body.context?.clientName ?? null
    return Response.json({ ok: true, view, received: { ...order, destination } })
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
