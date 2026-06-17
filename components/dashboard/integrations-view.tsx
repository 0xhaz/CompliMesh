'use client'

import { useRef, useState, useTransition } from 'react'
import { useWorkspace } from '@/components/dashboard/workspace-context'
import { batchScreenRowsAction, type BatchResult } from '@/app/actions'
import type { ScreeningView } from '@/core/screening/view'
import {
  type ColumnMap,
  type OrderRow,
  SAMPLE_CSV,
  autoMapColumns,
  parseCsv,
  rowsToOrders,
} from '@/lib/csv'
import { cn } from '@/lib/utils'
import { VERDICT_DOT, verdictLabel } from '@/lib/verdict'

function ResultSummary({ result }: { result: BatchResult }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-px bg-hairline sm:grid-cols-4">
      {[
        { label: 'screened', value: result.total, cls: 'text-foreground' },
        { label: 'GO', value: result.go, cls: 'text-go' },
        { label: 'REVIEW', value: result.review, cls: 'text-review' },
        { label: 'NO-GO', value: result.noGo, cls: 'text-nogo' },
      ].map((s) => (
        <div key={s.label} className="flex flex-col gap-1 bg-card p-4">
          <span className={cn('font-mono text-2xl font-medium tracking-tight', s.cls)}>{s.value}</span>
          <span className="label-mono">{s.label}</span>
        </div>
      ))}
    </div>
  )
}

function ResultRows({ views }: { views: ScreeningView[] }) {
  return (
    <div className="mt-4 overflow-x-auto border border-hairline">
      <table className="w-full min-w-[680px] border-collapse text-left">
        <thead>
          <tr className="border-b border-hairline bg-card">
            <th className="label-mono px-4 py-3 font-normal">counterparty</th>
            <th className="label-mono px-4 py-3 font-normal">destination</th>
            <th className="label-mono px-4 py-3 font-normal">hs</th>
            <th className="label-mono px-4 py-3 font-normal">verdict</th>
          </tr>
        </thead>
        <tbody>
          {views.map((v) => (
            <tr key={v.runId} className="border-b border-hairline last:border-0">
              <td className="px-4 py-3 font-mono text-xs text-foreground">{v.input.counterparty}</td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{v.input.destination}</td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{v.classification.hsCode}</td>
              <td className="px-4 py-3 font-mono text-xs">
                <span className={cn(VERDICT_DOT[v.verdict])}>● {verdictLabel(v.verdict)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Panel A: CSV import from a QuickBooks / SAP export ──
function CsvImportPanel() {
  const ws = useWorkspace()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [mapping, setMapping] = useState<{ headers: string[]; map: ColumnMap } | null>(null)
  const [result, setResult] = useState<BatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name)
    setResult(null)
    setError(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const rows = parseCsv(String(reader.result))
        const headers = rows[0] ?? []
        const map = autoMapColumns(headers)
        setMapping({ headers, map })
        setOrders(rowsToOrders(rows, map))
      } catch {
        setError('Could not parse that file as CSV.')
      }
    }
    reader.readAsText(f)
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'quickbooks-export-sample.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function screen() {
    if (orders.length === 0 || pending) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await batchScreenRowsAction(orders, ws.actionCtx())
        setResult(res)
        ws.refresh()
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  const col = (i: number) => (i >= 0 && mapping ? mapping.headers[i] : null)

  return (
    <div className="border border-hairline bg-card p-5">
      <span className="label-mono">Import from file</span>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Export your customer or invoice list from QuickBooks / SAP as CSV and upload it. Columns are
        auto-detected (product, counterparty, destination); each row is screened and saved to{' '}
        <span className="font-mono text-foreground">{ws.activeClient.name}</span>.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-9 items-center border border-ink/20 px-4 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:bg-muted"
        >
          Choose CSV
        </button>
        <button
          type="button"
          onClick={downloadSample}
          className="font-mono text-[0.6875rem] uppercase tracking-widest text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Download sample
        </button>
        {fileName ? <span className="font-mono text-[0.6875rem] text-muted-foreground">{fileName}</span> : null}
      </div>

      {mapping ? (
        <div className="mt-4 flex flex-col gap-2">
          <span className="font-mono text-[0.6875rem] text-muted-foreground">
            detected: product=<span className="text-foreground">{col(mapping.map.product) ?? '—'}</span> ·
            counterparty=<span className="text-foreground">{col(mapping.map.counterparty) ?? '—'}</span> ·
            destination=<span className="text-foreground">{col(mapping.map.destination) ?? '—'}</span>
          </span>
          {mapping.map.product < 0 || mapping.map.counterparty < 0 ? (
            <span className="font-mono text-[0.6875rem] text-nogo">
              ⚠ Could not detect a product and/or counterparty column — check the header names.
            </span>
          ) : null}
          {orders.length > 0 ? (
            <div className="overflow-x-auto border border-hairline">
              <table className="w-full min-w-[600px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-hairline bg-background">
                    <th className="label-mono px-3 py-2 font-normal">product</th>
                    <th className="label-mono px-3 py-2 font-normal">counterparty</th>
                    <th className="label-mono px-3 py-2 font-normal">destination</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 6).map((o, i) => (
                    <tr key={i} className="border-b border-hairline last:border-0">
                      <td className="max-w-[240px] truncate px-3 py-2 font-mono text-[0.6875rem] text-foreground">{o.product}</td>
                      <td className="px-3 py-2 font-mono text-[0.6875rem] text-foreground">{o.counterparty}</td>
                      <td className="px-3 py-2 font-mono text-[0.6875rem] text-muted-foreground">{o.destination || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <button
            type="button"
            onClick={screen}
            disabled={pending || orders.length === 0}
            className="mt-1 inline-flex h-9 w-fit items-center bg-accent px-4 font-mono text-xs uppercase tracking-widest text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending ? 'Screening…' : `Screen ${orders.length} order${orders.length === 1 ? '' : 's'}`}
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-3 font-mono text-[0.6875rem] text-nogo">{error}</p> : null}
      {result ? (
        <>
          <ResultSummary result={result} />
          <ResultRows views={result.views} />
        </>
      ) : null}
    </div>
  )
}

// ── Panel B: Watch & screen (simulated QuickBooks webhook) ──
const SAMPLE_ORDERS: { key: string; label: string; expected: string; order: OrderRow }[] = [
  { key: 'clean', label: 'Clean order', expected: 'GO', order: { product: 'Consumer notebook computer, 14-inch', counterparty: 'Bremer Elektronik GmbH', destination: 'Germany (DE)' } },
  { key: 'sanctioned', label: 'Sanctioned buyer', expected: 'NO_GO', order: { product: 'Aircraft turbine engine components', counterparty: 'Mahan Air', destination: 'Iran (IR)' } },
  { key: 'dualuse', label: 'Dual-use item', expected: 'REVIEW', order: { product: 'Thermal / IR surveillance camera module', counterparty: 'Hikvison Digital', destination: 'United Arab Emirates (AE)' } },
]

function WebhookPanel() {
  const ws = useWorkspace()
  const [received, setReceived] = useState<OrderRow | null>(null)
  const [view, setView] = useState<ScreeningView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function simulate(order: OrderRow) {
    if (pending) return
    setError(null)
    setView(null)
    setReceived(order)
    startTransition(async () => {
      try {
        const ctx = ws.actionCtx()
        const res = await fetch('/api/integrations/quickbooks/webhook', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            context: { orgId: ctx.orgId, clientId: ctx.clientId, clientName: ctx.clientName },
            order,
          }),
        })
        const data = await res.json()
        if (!data.ok) throw new Error(data.error ?? 'Webhook failed.')
        setView(data.view as ScreeningView)
        ws.refresh()
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  return (
    <div className="border border-hairline bg-card p-5">
      <span className="label-mono">Watch &amp; screen — live webhook</span>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Screening as an <em>automatic control</em>: QuickBooks Online POSTs to{' '}
        <span className="font-mono text-foreground">/api/integrations/quickbooks/webhook</span> whenever an
        order is created, and CompliMesh screens it with no human in the loop. Trigger a simulated order to
        see it — the run lands in the ledger as <span className="font-mono text-foreground">trigger=WEBHOOK</span>,{' '}
        <span className="font-mono text-foreground">actor=SYSTEM</span>.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {SAMPLE_ORDERS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => simulate(s.order)}
            disabled={pending}
            className="border border-ink/15 px-3 py-2 text-left font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <span className={cn('mr-2', s.expected === 'GO' && 'text-go', s.expected === 'REVIEW' && 'text-review', s.expected === 'NO_GO' && 'text-nogo')} aria-hidden="true">●</span>
            Simulate: {s.label}
          </button>
        ))}
      </div>

      {error ? <p className="mt-3 font-mono text-[0.6875rem] text-nogo">{error}</p> : null}

      {received ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="border border-hairline bg-background p-4">
            <span className="label-mono">inbound order (normalized)</span>
            <pre className="mt-2 overflow-x-auto font-mono text-[0.6875rem] leading-relaxed text-foreground/80">
{JSON.stringify(received, null, 2)}
            </pre>
          </div>
          <div className="border border-hairline bg-background p-4">
            <span className="label-mono">auto-screen verdict</span>
            {pending ? (
              <p className="mt-2 font-mono text-xs text-muted-foreground">screening…</p>
            ) : view ? (
              <div className="mt-2 flex flex-col gap-1">
                <span className={cn('font-mono text-2xl font-medium tracking-tight', VERDICT_DOT[view.verdict])}>
                  {verdictLabel(view.verdict)}
                </span>
                <span className="font-mono text-[0.6875rem] text-muted-foreground">
                  {view.input.counterparty} · {view.classification.hsCode} · {view.status}
                </span>
                <span className="font-mono text-[0.6875rem] leading-relaxed text-foreground/70">{view.reason.slice(0, 140)}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <details className="mt-4">
        <summary className="cursor-pointer font-mono text-[0.6875rem] uppercase tracking-widest text-muted-foreground hover:text-foreground">
          Real QuickBooks payload shape
        </summary>
        <pre className="mt-2 overflow-x-auto border border-hairline bg-background p-3 font-mono text-[0.625rem] leading-relaxed text-muted-foreground">
{`POST /api/integrations/quickbooks/webhook
{ "eventNotifications": [{
    "realmId": "<qbo company id>",
    "dataChangeEvent": { "entities": [
      { "name": "Invoice", "id": "...", "operation": "Create" }
    ] } }] }

// production: verify signature → fetch the Invoice via the QBO REST API →
// map (customer, line item, ship-to country) → screen. Same engine, no human.`}
        </pre>
      </details>
    </div>
  )
}

export function IntegrationsView() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-10 lg:py-12">
      <header className="flex flex-col gap-2">
        <span className="label-mono">Integrations</span>
        <h1 className="font-sans text-2xl font-medium tracking-tight">Bring screening to where orders live</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Two ways to feed the engine: upload an export today, or wire screening into your order flow as an
          automatic control. Both run the same verdict model and write to the same tamper-evident ledger.
        </p>
      </header>

      <div className="mt-8 flex flex-col gap-6">
        <CsvImportPanel />
        <WebhookPanel />
      </div>
    </div>
  )
}
