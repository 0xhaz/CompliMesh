import type { ScreeningResult, Verdict } from '@/core/screening/view'
import { cn } from '@/lib/utils'

const VERDICT_META: Record<
  Verdict,
  { label: string; color: string; line: string }
> = {
  GO: { label: 'GO', color: 'text-go', line: 'bg-go' },
  REVIEW: { label: 'REVIEW', color: 'text-review', line: 'bg-review' },
  NO_GO: { label: 'NO-GO', color: 'text-nogo', line: 'bg-nogo' },
}

function SubIndicator({
  label,
  state,
  value,
  note,
}: {
  label: string
  state: string
  value: string
  note?: string
}) {
  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      <span className="label-mono">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-sm text-foreground">{state}</span>
      </div>
      <span className="font-mono text-[0.8125rem] text-foreground/80">
        {value}
      </span>
      {note ? (
        <span className="font-mono text-[0.6875rem] leading-relaxed text-muted-foreground">
          {note}
        </span>
      ) : null}
    </div>
  )
}

export function VerdictReadout({
  result,
  animate = false,
  className,
}: {
  result: ScreeningResult
  animate?: boolean
  className?: string
}) {
  const meta = VERDICT_META[result.verdict]
  const { classification: c, entity: e, destination: d } = result

  const entityState =
    e.state === 'CLEAR'
      ? 'CLEAR'
      : e.state === 'MATCH_EXACT'
        ? 'MATCH · EXACT'
        : 'MATCH · FUZZY'
  const entityValue =
    e.state === 'CLEAR'
      ? 'no list hits'
      : `${e.matchScore?.toFixed(2)} · ${e.list}`
  const entityNote =
    e.state === 'CLEAR'
      ? undefined
      : e.state === 'MATCH_EXACT'
        ? `${e.matchedParty} → prohibited`
        : `${e.matchedParty} → review`

  return (
    <div
      className={cn(
        'border border-ink/15 bg-card',
        animate && 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-500',
        className,
      )}
      role="group"
      aria-label={`Screening verdict: ${meta.label}`}
    >
      {/* Top bar: serial-number framing */}
      <div className="flex items-center justify-between border-b border-hairline px-5 py-2.5">
        <span className="label-mono">verdict</span>
        <span className="font-mono text-[0.6875rem] text-muted-foreground">
          {result.id}
        </span>
      </div>

      {/* The weighted verdict */}
      <div className="relative flex flex-col gap-3 px-5 py-7">
        <div className={cn('h-1 w-10', meta.line)} aria-hidden="true" />
        <div
          className={cn(
            'font-mono text-5xl font-medium tracking-tight sm:text-6xl',
            meta.color,
            animate &&
              'motion-safe:animate-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-500',
          )}
        >
          {meta.label}
        </div>
        <p className="max-w-prose text-sm leading-relaxed text-foreground/80">
          {result.reason}
        </p>
      </div>

      {/* Three discrete sub-indicators */}
      <div className="grid grid-cols-1 divide-y divide-hairline border-t border-hairline sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <SubIndicator
          label="classification"
          state={c.belowFloor ? 'BELOW FLOOR' : 'RESOLVED'}
          value={`${c.hsCode} · conf ${c.confidence.toFixed(2)}`}
          note={c.belowFloor ? 'reason for review' : (c.description ?? undefined)}
        />
        <SubIndicator
          label="entity"
          state={entityState}
          value={entityValue}
          note={entityNote}
        />
        <SubIndicator
          label="destination"
          state={d.state}
          value={d.country}
          note={d.rule}
        />
      </div>

      {/* Snapshot serial number */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-5 py-2.5">
        <span className="label-mono">ruleset</span>
        <span className="font-mono text-[0.6875rem] text-muted-foreground">
          {result.rulesetSnapshot}
        </span>
      </div>
    </div>
  )
}
