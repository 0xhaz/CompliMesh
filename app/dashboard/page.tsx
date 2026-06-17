import Link from 'next/link'
import { DashboardShell } from '@/components/dashboard/dashboard-shell'
import { getDb } from '@/core/schema/db'
import { getWorkspace, type Workspace } from '@/core/tenancy'

// DB-backed — never prerender at build time.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  let workspace: Workspace = { org: null, users: [], clients: [] }
  let dbError = false
  try {
    workspace = await getWorkspace(getDb())
  } catch {
    dbError = true
  }

  // Require a fully-populated workspace — a partial seed (org but no users or
  // clients) would otherwise crash the shell on first render.
  if (!workspace.org || workspace.users.length === 0 || workspace.clients.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <span className="label-mono">CompliMesh</span>
        <h1 className="font-sans text-2xl font-medium tracking-tight text-foreground">
          {dbError ? 'Database unavailable' : 'No workspace seeded'}
        </h1>
        <p className="max-w-md font-mono text-xs leading-relaxed text-muted-foreground">
          {dbError
            ? 'Could not reach Aurora (the OIDC token may have expired — run `vercel env pull .env.local`).'
            : 'Run `pnpm seed` to load the demo tenant, reference data, and screening history.'}
        </p>
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-widest text-accent underline-offset-4 hover:underline"
        >
          ← Back to home
        </Link>
      </div>
    )
  }

  return <DashboardShell workspace={workspace} />
}
