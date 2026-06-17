import { cn } from '@/lib/utils'

// The "mesh" mark: three short strokes converging into one — the brand idea
// of three controls resolving into a single check. Rendered as precise lines,
// not a decorative blob.
export function Wordmark({
  className,
  showText = true,
}: {
  className?: string
  showText?: boolean
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill="none"
        aria-hidden="true"
        className="text-accent"
      >
        <path d="M2 5 L11 11" stroke="currentColor" strokeWidth="1.25" />
        <path d="M2 11 L11 11" stroke="currentColor" strokeWidth="1.25" />
        <path d="M2 17 L11 11" stroke="currentColor" strokeWidth="1.25" />
        <path d="M11 11 L20 11" stroke="currentColor" strokeWidth="1.75" />
        <circle cx="20" cy="11" r="1.6" fill="currentColor" />
      </svg>
      {showText ? (
        <span className="font-sans text-[0.9375rem] font-medium tracking-tight text-foreground">
          CompliMesh
        </span>
      ) : null}
    </span>
  )
}
