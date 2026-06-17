// Shared verdict display helpers — single source for the dot colour and the
// human label, so the list views don't each redefine them (and drift).

import type { Verdict } from '@/core/types'

export const VERDICT_DOT: Record<Verdict, string> = {
  GO: 'text-go',
  REVIEW: 'text-review',
  NO_GO: 'text-nogo',
}

export function verdictLabel(v: Verdict): string {
  return v === 'NO_GO' ? 'NO-GO' : v
}
