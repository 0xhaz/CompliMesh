import Link from 'next/link'
import { Wordmark } from '@/components/wordmark'
import { VerdictReadout } from '@/components/verdict-readout'
import { runScreening, SCENARIOS } from '@/core/screening'
import { LedgerPreview } from '@/components/landing/ledger-preview'

// Hero readout: the license-required REVIEW scenario — muted ochre, the
// page's remembered moment.
const heroScenario = SCENARIOS.find((s) => s.key === 'review')!
const heroResult = {
  ...runScreening(heroScenario.input, heroScenario.overrides),
  id: 'SCR-20260612-003',
  timestamp: '2026-06-12T09:42:00Z',
}

function Rule() {
  return <div className="h-px w-full bg-hairline" aria-hidden="true" />
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Wordmark />
        <nav className="flex items-center gap-6">
          <Link
            href="#how"
            className="hidden font-mono text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent sm:inline"
          >
            How it works
          </Link>
          <Link
            href="/dashboard"
            className="font-mono text-xs uppercase tracking-widest text-accent underline-offset-4 transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            Open app →
          </Link>
        </nav>
      </header>
      <Rule />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div className="flex flex-col gap-8">
            <span className="label-mono">Trade-compliance screening</span>
            <h1 className="text-balance font-sans text-4xl font-medium leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              One check. Three controls. A record you can defend.
            </h1>
            <p className="max-w-md text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              Screen a product, a buyer, and a destination together — and keep a
              tamper-evident audit trail of every decision you make.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/dashboard"
                className="inline-flex h-11 items-center justify-center bg-accent px-6 font-mono text-xs uppercase tracking-widest text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Start a screening
              </Link>
              <Link
                href="#how"
                className="inline-flex h-11 items-center justify-center border border-ink/20 px-6 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                See how it works
              </Link>
            </div>
          </div>

          {/* The centerpiece */}
          <div className="lg:pl-4">
            <VerdictReadout result={heroResult} />
          </div>
        </div>
      </section>
      <Rule />

      {/* 1. The problem */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div className="flex flex-col gap-4">
            <span className="label-mono">The problem</span>
            <h2 className="text-balance font-sans text-2xl font-medium tracking-tight sm:text-3xl">
              Three tools and a stale spreadsheet
            </h2>
            <p className="max-w-sm text-pretty leading-relaxed text-muted-foreground">
              Classification lives in one place, restricted-party screening in
              another, destination controls in a third — and the spreadsheet
              tying them together is always one revision behind. That is exactly
              where things slip through.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-3">
            {[
              {
                n: '01',
                t: 'Classification tool',
                d: 'HS codes guessed in a separate system, rarely re-checked.',
              },
              {
                n: '02',
                t: 'Screening service',
                d: 'Restricted-party lists checked ad hoc, results pasted around.',
              },
              {
                n: '03',
                t: 'A spreadsheet',
                d: 'Destination rules tracked by hand, out of date by the week.',
              },
            ].map((f) => (
              <div key={f.n} className="flex flex-col gap-3 bg-background p-6">
                <span className="font-mono text-xs text-muted-foreground">
                  {f.n}
                </span>
                <span className="font-sans font-medium">{f.t}</span>
                <span className="text-sm leading-relaxed text-muted-foreground">
                  {f.d}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-10 flex items-center gap-3">
          <div className="h-px flex-1 bg-hairline" aria-hidden="true" />
          <span className="font-mono text-xs uppercase tracking-widest text-accent">
            meshed into one check
          </span>
          <div className="h-px flex-1 bg-hairline" aria-hidden="true" />
        </div>
      </section>
      <Rule />

      {/* 2. How it works */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <div className="flex flex-col gap-4">
          <span className="label-mono">How it works</span>
          <h2 className="max-w-2xl text-balance font-sans text-2xl font-medium tracking-tight sm:text-3xl">
            Three checks, run in sequence, resolved into one verdict.
          </h2>
        </div>
        <ol className="mt-12 grid grid-cols-1 gap-px bg-hairline md:grid-cols-3">
          {[
            {
              n: 'classify',
              t: 'Classify',
              d: 'Resolve the product to an HS code with a confidence score. Below the floor, it routes to review.',
              v: '8525.83 · conf 0.63',
            },
            {
              n: 'screen',
              t: 'Screen',
              d: 'Match the counterparty against restricted-party lists. Exact hits stop; fuzzy hits route to review.',
              v: '0.61 · BIS Entity List',
            },
            {
              n: 'destination',
              t: 'Destination',
              d: 'Check the HS code against destination controls — allowed, license required, or prohibited.',
              v: 'LICENSE_REQUIRED · TR',
            },
          ].map((step, i) => (
            <li key={step.n} className="flex flex-col gap-4 bg-background p-6">
              <div className="flex items-center justify-between">
                <span className="label-mono">{`0${i + 1} · ${step.n}`}</span>
                <span className="font-sans text-sm text-muted-foreground">
                  →
                </span>
              </div>
              <span className="font-sans text-lg font-medium">{step.t}</span>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {step.d}
              </p>
              <span className="mt-auto block border-t border-hairline pt-3 font-mono text-xs text-foreground/80">
                {step.v}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <Rule />

      {/* 3. The audit trail */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div className="flex flex-col gap-4">
            <span className="label-mono">The audit trail</span>
            <h2 className="text-balance font-sans text-2xl font-medium tracking-tight sm:text-3xl">
              Every decision is recorded and provable
            </h2>
            <p className="max-w-sm text-pretty leading-relaxed text-muted-foreground">
              Each screening writes an append-only ledger entry, chained to the
              one before it by hash. Reorder a row, edit a verdict, delete an
              event — the chain breaks, and the break is detectable down to the
              exact sequence number.
            </p>
            <p className="max-w-sm font-mono text-xs leading-relaxed text-muted-foreground">
              Even direct tampering is detectable.
            </p>
          </div>
          <LedgerPreview />
        </div>
      </section>
      <Rule />

      {/* 4. Who it's for */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div className="flex flex-col gap-4">
            <span className="label-mono">Who it&apos;s for</span>
            <h2 className="text-balance font-sans text-2xl font-medium tracking-tight sm:text-3xl">
              Built for SMB exporters carrying enterprise risk
            </h2>
          </div>
          <div className="flex flex-col">
            <div className="flex flex-col gap-2 py-5">
              <p className="text-pretty leading-relaxed text-foreground/85">
                Enterprise trade-compliance suites start north of{' '}
                <span className="font-mono text-sm">$50k/yr</span> — out of
                reach for a small exporter. But the legal exposure of a bad
                shipment does not scale down with your headcount.
              </p>
            </div>
            <Rule />
            <div className="flex flex-col gap-2 py-5">
              <p className="text-pretty leading-relaxed text-foreground/85">
                CompliMesh gives a compliance officer or operations lead one
                disciplined check and a defensible record — without a suite, a
                consultant, or a spreadsheet to maintain.
              </p>
            </div>
          </div>
        </div>
      </section>
      <Rule />

      {/* 5. Honest positioning */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <span className="label-mono">A note on what this is</span>
          <p className="text-balance font-sans text-xl leading-relaxed tracking-tight sm:text-2xl">
            CompliMesh is compliance research and decision support. It flags
            what needs review and{' '}
            <span className="text-accent">
              never silently clears a borderline call.
            </span>{' '}
            A REVIEW or NO-GO means stop and consult — not a quiet green light.
          </p>
          <div className="pt-2">
            <Link
              href="/dashboard"
              className="inline-flex h-11 items-center justify-center bg-accent px-6 font-mono text-xs uppercase tracking-widest text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Start a screening
            </Link>
          </div>
        </div>
      </section>
      <Rule />

      {/* Footer */}
      <footer className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-10 sm:flex-row sm:items-center">
        <Wordmark />
        <span className="font-mono text-[0.6875rem] uppercase tracking-widest text-muted-foreground">
          {heroResult.rulesetSnapshot}
        </span>
      </footer>
    </div>
  )
}
