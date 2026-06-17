import { DashboardShell } from '@/components/dashboard/dashboard-shell'
import { verifyAuditChain } from '@/core/audit/hash'
import { fetchAuditChain } from '@/core/audit/read'
import { type AuditEventView, toAuditEventView } from '@/core/audit/view'
import { listRecentRuns, type ScreeningView } from '@/core/screening/view'
import { getDb } from '@/core/schema/db'

// DB-backed — never prerender at build time.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  let history: ScreeningView[] = []
  let events: AuditEventView[] = []
  let intact = true

  try {
    const db = getDb()
    history = await listRecentRuns(db)
    const rows = await fetchAuditChain(db)
    events = rows.map(toAuditEventView)
    intact = verifyAuditChain(rows).intact
  } catch {
    // DB unavailable (e.g. expired OIDC token) — render an empty dashboard
    // rather than erroring; the user can still load scenarios once it's back.
  }

  return <DashboardShell initialHistory={history} initialEvents={events} initialIntact={intact} />
}
