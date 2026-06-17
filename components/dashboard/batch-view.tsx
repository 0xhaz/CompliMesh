'use client'

import { useState, useTransition } from 'react'
import { useWorkspace } from '@/components/dashboard/workspace-context'
import { batchScreenAction, type BatchResult } from '@/app/actions'
import { cn } from '@/lib/utils'
import { VERDICT_DOT, verdictLabel } from '@/lib/verdict'


const SAMPLE = `Consumer notebook computer, 14-inch | Bremer Elektronik GmbH | Germany (DE)
Thermal IR camera module | Hikvison Digital | United Arab Emirates (AE)
Aircraft turbine engine components | Mahan Air | Iran (IR)
Network routing equipment | Hannover Tech Distribution | Germany (DE)`

export function BatchView() {
  const ws = useWorkspace()
  const [text, setText] = useState('')
  const [result, setResult] = useState<BatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run() {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0 || pending) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await batchScreenAction(lines, ws.actionCtx())
        setResult(res)
        ws.refresh()
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 lg:px-10 lg:py-12">
      <header className="flex flex-col gap-2">
        <span className="label-mono">Batch screening</span>
        <h1 className="font-sans text-2xl font-medium tracking-tight">Screen a whole order book at once</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          One line per shipment: <span className="font-mono text-foreground">product | counterparty | destination</span>.
          Each is screened and saved to <span className="font-mono text-foreground">{ws.activeClient.name}</span> as
          its own run + audit record.
        </p>
      </header>

      <div className="mt-8 flex flex-col gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={SAMPLE}
          className="w-full resize-y border border-ink/15 bg-background px-3 py-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus-visible:border-accent focus-visible:outline-none"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={run}
            disabled={pending || !text.trim()}
            className="inline-flex h-10 items-center bg-accent px-5 font-mono text-xs uppercase tracking-widest text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending ? 'Screening…' : 'Screen batch'}
          </button>
          <button
            type="button"
            onClick={() => setText(SAMPLE)}
            className="font-mono text-[0.6875rem] uppercase tracking-widest text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Load sample
          </button>
        </div>
        {error ? <p className="font-mono text-[0.6875rem] text-nogo">{error}</p> : null}
      </div>

      {result ? (
        <>
          <div className="mt-8 grid grid-cols-2 gap-px bg-hairline sm:grid-cols-4">
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

          <div className="mt-4 overflow-x-auto border border-hairline">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-hairline bg-card">
                  <th className="label-mono px-4 py-3 font-normal">counterparty</th>
                  <th className="label-mono px-4 py-3 font-normal">destination</th>
                  <th className="label-mono px-4 py-3 font-normal">hs</th>
                  <th className="label-mono px-4 py-3 font-normal">verdict</th>
                </tr>
              </thead>
              <tbody>
                {result.views.map((v) => (
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
        </>
      ) : null}
    </div>
  )
}
