// Drizzle client over node-postgres. Framework-agnostic (techstack §2.2) — the
// app/ Server Actions and scripts/ both import this; it never imports from app/.
//
// Connection comes from env injected by the Vercel AWS integration (OIDC + RDS
// IAM, short-lived tokens — see techstack §1). Locally: `vercel env pull`.
// We don't hardcode credentials. The client is created lazily so importing the
// schema (e.g. for drizzle-kit generate) never requires a live DB.

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

let _pool: Pool | undefined
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined

function resolveConnectionString(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!url) {
    throw new Error(
      'No database connection string found. Set DATABASE_URL (or POSTGRES_URL). ' +
        'Locally, run `vercel env pull` after `vercel link`.',
    )
  }
  return url
}

export function getDb() {
  if (!_db) {
    _pool = new Pool({ connectionString: resolveConnectionString() })
    _db = drizzle(_pool, { schema })
  }
  return _db
}

export { schema }
