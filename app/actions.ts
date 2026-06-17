'use server'

// Server Actions — the thin app/ wrapper over core/ (techstack §2.2). Client
// components call these; all DB + AI work happens here, server-side.

import { verifyAuditChain, type VerifyResult } from '@/core/audit/hash'
import { fetchAuditChain } from '@/core/audit/read'
import { type AuditEventView, toAuditEventView } from '@/core/audit/view'
import { type ScreeningInput, runScreening } from '@/core/screening/pipeline'
import { loadListUpdate, type ListUpdateResult, rescreenClient, type RescreenResult } from '@/core/screening/rescreen'
import { type ListRunsOptions, type ScreeningView, listRecentRuns, toScreeningView } from '@/core/screening/view'
import { approveRun, clearFalsePositive, rejectRun } from '@/core/screening/workflow'
import { getDb } from '@/core/schema/db'
import { type CustomerView, findOrCreateCustomer, getWorkspace, listCustomers, type Workspace } from '@/core/tenancy'

// The active actor + scope, passed from the dashboard's user/client selection.
export interface ActionContext {
  orgId: string
  clientId: string
  clientName?: string
  userId: string
  userName?: string
  role: string
}

// ---- workspace + reads ----

export async function workspaceAction(): Promise<Workspace> {
  return getWorkspace(getDb())
}

export async function listCustomersAction(clientId: string): Promise<CustomerView[]> {
  return listCustomers(getDb(), clientId)
}

export async function listRunsAction(opts: ListRunsOptions = {}): Promise<ScreeningView[]> {
  return listRecentRuns(getDb(), opts)
}

// ---- screening ----

export async function runScreeningAction(
  input: ScreeningInput,
  ctx?: ActionContext,
): Promise<ScreeningView> {
  let customerId: string | null = null
  if (ctx?.clientId) {
    customerId = await findOrCreateCustomer(getDb(), ctx.clientId, input.counterparty, null)
  }
  const run = await runScreening(input, {
    orgId: ctx?.orgId ?? null,
    clientId: ctx?.clientId ?? null,
    customerId,
    initiatedBy: ctx?.userId ?? null,
    actorRole: ctx?.role ?? null,
    trigger: 'MANUAL',
  })
  const view = toScreeningView(run)
  view.input = { product: input.product, counterparty: input.counterparty, destination: input.destination }
  view.customerName = input.counterparty
  view.clientName = ctx?.clientName ?? null
  view.initiator = ctx?.userName ?? null
  return view
}

export interface BatchResult {
  total: number
  go: number
  review: number
  noGo: number
  views: ScreeningView[]
}

// Batch screening: each line "product | counterparty | destination".
export async function batchScreenAction(lines: string[], ctx: ActionContext): Promise<BatchResult> {
  const views: ScreeningView[] = []
  for (const raw of lines) {
    const parts = raw.split('|').map((s) => s.trim())
    if (parts.length < 3 || parts.some((p) => !p)) continue
    const [product, counterparty, destination] = parts
    const customerId = await findOrCreateCustomer(getDb(), ctx.clientId, counterparty, null)
    const run = await runScreening(
      { product, counterparty, destination },
      { orgId: ctx.orgId, clientId: ctx.clientId, customerId, initiatedBy: ctx.userId, actorRole: ctx.role, trigger: 'BATCH' },
    )
    const view = toScreeningView(run)
    view.input = { product, counterparty, destination }
    view.customerName = counterparty
    view.clientName = ctx.clientName ?? null
    views.push(view)
  }
  return {
    total: views.length,
    go: views.filter((v) => v.verdict === 'GO').length,
    review: views.filter((v) => v.verdict === 'REVIEW').length,
    noGo: views.filter((v) => v.verdict === 'NO_GO').length,
    views,
  }
}

// ---- review queue + decisions ----

export async function reviewQueueAction(orgId: string): Promise<ScreeningView[]> {
  return listRecentRuns(getDb(), { orgId, status: 'PENDING_REVIEW' })
}

export async function approveRunAction(runId: string, ctx: ActionContext, reason?: string): Promise<void> {
  await approveRun({ runId, userId: ctx.userId, role: ctx.role, reason })
}

export async function rejectRunAction(runId: string, ctx: ActionContext, reason?: string): Promise<void> {
  await rejectRun({ runId, userId: ctx.userId, role: ctx.role, reason })
}

export async function clearFalsePositiveAction(
  runId: string,
  customerName: string,
  partyName: string,
  reason: string,
  ctx: ActionContext,
): Promise<void> {
  const customerId = await findOrCreateCustomer(getDb(), ctx.clientId, customerName, null)
  await clearFalsePositive({ runId, customerId, partyName, reason, userId: ctx.userId, role: ctx.role })
}

// ---- re-screening on list change ----

export async function loadListUpdateAction(): Promise<ListUpdateResult> {
  return loadListUpdate()
}

export async function rescreenClientAction(ctx: ActionContext): Promise<RescreenResult> {
  return rescreenClient({ orgId: ctx.orgId, clientId: ctx.clientId, userId: ctx.userId, role: ctx.role })
}

// ---- audit ----

export interface AuditChainView {
  events: AuditEventView[]
  verify: VerifyResult
}

export async function auditChainAction(): Promise<AuditChainView> {
  const rows = await fetchAuditChain(getDb())
  return { events: rows.map(toAuditEventView), verify: verifyAuditChain(rows) }
}

export interface TamperSimulation extends AuditChainView {
  tamperedSeq: number | null
}

export async function simulateTamperAction(): Promise<TamperSimulation> {
  const rows = await fetchAuditChain(getDb())
  if (rows.length === 0) {
    return { events: [], verify: { intact: true, brokenSeq: null, reason: null }, tamperedSeq: null }
  }
  const verdictIdx = rows.findIndex((r) => r.eventType === 'VERDICT')
  const idx = verdictIdx >= 0 ? verdictIdx : Math.floor(rows.length / 2)
  const tamperedRows = rows.map((r, i) =>
    i === idx ? { ...r, payload: { ...(r.payload as object), verdict: 'GO', _tampered: true } } : r,
  )
  const events = tamperedRows.map((r, i) => {
    const view = toAuditEventView(r)
    if (i === idx) view.tampered = true
    return view
  })
  return { events, verify: verifyAuditChain(tamperedRows), tamperedSeq: rows[idx].seq }
}
