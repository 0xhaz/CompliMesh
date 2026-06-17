'use client'

export function PrintButton({ label = 'Print / Save as PDF' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-9 items-center bg-accent px-4 font-mono text-xs uppercase tracking-widest text-accent-foreground transition-opacity hover:opacity-90 print:hidden"
    >
      {label}
    </button>
  )
}
