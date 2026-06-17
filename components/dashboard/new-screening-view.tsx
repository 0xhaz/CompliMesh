'use client'

import { useState, useTransition } from 'react'
import { VerdictReadout } from '@/components/verdict-readout'
import { runScreeningAction } from '@/app/actions'
import { DEMO_SCENARIOS } from '@/core/screening/demo-scenarios'
import type { ScreeningView } from '@/core/screening/view'
import { cn } from '@/lib/utils'

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  textarea,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  textarea?: boolean
}) {
  const id = `field-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className="flex flex-col gap-2 border-t border-hairline py-5 first:border-t-0 first:pt-0">
      <label htmlFor={id} className="label-mono">
        {label}
      </label>
      <span className="text-xs leading-relaxed text-muted-foreground">
        {hint}
      </span>
      {textarea ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="mt-1 w-full resize-none border border-ink/15 bg-background px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="mt-1 w-full border border-ink/15 bg-background px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        />
      )}
    </div>
  )
}

export function NewScreeningView({
  onResult,
}: {
  onResult: (result: ScreeningView) => void
}) {
  const [product, setProduct] = useState('')
  const [counterparty, setCounterparty] = useState('')
  const [destination, setDestination] = useState('')
  const [activeScenario, setActiveScenario] = useState<string | null>(null)
  const [result, setResult] = useState<ScreeningView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function loadScenario(key: string) {
    const s = DEMO_SCENARIOS.find((x) => x.key === key)!
    setProduct(s.input.product)
    setCounterparty(s.input.counterparty)
    setDestination(s.input.destination)
    setActiveScenario(key)
    setResult(null)
    setError(null)
  }

  function edit(setter: (v: string) => void) {
    return (v: string) => {
      setter(v)
      setActiveScenario(null)
    }
  }

  function run() {
    if (!product || !counterparty || !destination || pending) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await runScreeningAction({ product, counterparty, destination })
        setResult(res)
        onResult(res)
      } catch (e) {
        setError((e as Error).message ?? 'Screening failed. Check the connection and try again.')
      }
    })
  }

  const canRun = Boolean(product && counterparty && destination)

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 lg:px-10 lg:py-12">
      <header className="flex flex-col gap-2">
        <span className="label-mono">New screening</span>
        <h1 className="font-sans text-2xl font-medium tracking-tight">
          Can this product go to this company in this country?
        </h1>
      </header>

      {/* Scenario loaders */}
      <div className="mt-8 flex flex-col gap-3">
        <span className="label-mono">Load an example</span>
        <div className="flex flex-wrap gap-2">
          {DEMO_SCENARIOS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => loadScenario(s.key)}
              className={cn(
                'border px-3 py-2 text-left font-mono text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                activeScenario === s.key
                  ? 'border-accent bg-accent/10 text-foreground'
                  : 'border-ink/15 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span
                className={cn(
                  'mr-2 inline-block',
                  s.expected === 'GO' && 'text-go',
                  s.expected === 'REVIEW' && 'text-review',
                  s.expected === 'NO_GO' && 'text-nogo',
                )}
                aria-hidden="true"
              >
                ●
              </span>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
        {/* Input panel — the three controls */}
        <div className="flex flex-col">
          <div className="border border-ink/15 bg-card p-5">
            <Field
              label="Product description"
              hint="What are you shipping?"
              value={product}
              onChange={edit(setProduct)}
              placeholder="e.g. portable notebook computer, 14-inch"
              textarea
            />
            <Field
              label="Counterparty"
              hint="The company being screened."
              value={counterparty}
              onChange={edit(setCounterparty)}
              placeholder="e.g. Bremer Elektronik GmbH"
            />
            <Field
              label="Destination"
              hint="Country of final delivery."
              value={destination}
              onChange={edit(setDestination)}
              placeholder="e.g. Germany (DE)"
            />
          </div>
          <button
            type="button"
            onClick={run}
            disabled={!canRun || pending}
            className="mt-4 inline-flex h-11 items-center justify-center bg-accent px-6 font-mono text-xs uppercase tracking-widest text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? 'Running screening…' : 'Run screening'}
          </button>
          {error ? (
            <p className="mt-3 font-mono text-[0.6875rem] leading-relaxed text-nogo">
              {error}
            </p>
          ) : null}
          <p className="mt-4 font-mono text-[0.6875rem] leading-relaxed text-muted-foreground">
            Decision support only. A REVIEW or NO-GO verdict means stop and
            consult — never a silent green light.
          </p>
        </div>

        {/* Result */}
        <div className="flex flex-col">
          {result ? (
            <VerdictReadout result={result} animate />
          ) : (
            <div className="flex h-full min-h-64 flex-col items-start justify-center gap-3 border border-dashed border-hairline p-8">
              <span className="label-mono">Awaiting input</span>
              <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
                Fill the three controls — or load an example — and run a
                screening. The verdict resolves here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
