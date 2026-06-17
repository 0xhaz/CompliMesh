// Drizzle client over node-postgres, using AWS RDS IAM authentication.
// Framework-agnostic (techstack §2.2) — app/ Server Actions and scripts/ both
// import this; it never imports from app/.
//
// The Vercel AWS integration does NOT provide a static password (techstack §1):
// it injects PGHOST/PGPORT/PGUSER/PGDATABASE + AWS_ROLE_ARN + a Vercel OIDC
// token. We assume that role via OIDC, sign a short-lived (~15 min) RDS IAM
// auth token, and pass it as the connection password. node-postgres accepts a
// `password` FUNCTION, so the token is regenerated on each new connection —
// which is required because IAM tokens expire.
//
// Works on Vercel (OIDC token auto-injected) and locally after
// `vercel link` + `vercel env pull .env.local` (which includes VERCEL_OIDC_TOKEN).

import { Signer } from '@aws-sdk/rds-signer'
import { awsCredentialsProvider } from '@vercel/functions/oidc'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

let _pool: Pool | undefined
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(
      `Missing env var ${name}. Run \`vercel link\` then \`vercel env pull .env.local\` ` +
        `to get the Aurora connection vars (incl. VERCEL_OIDC_TOKEN for IAM auth).`,
    )
  }
  return v
}

export function buildPool(): Pool {
  const host = required('PGHOST')
  const port = Number(process.env.PGPORT ?? 5432)
  const user = required('PGUSER')
  const database = required('PGDATABASE')
  const region = required('AWS_REGION')
  const roleArn = required('AWS_ROLE_ARN')

  // Assume the Vercel-managed AWS role via OIDC, then sign an RDS IAM token.
  const signer = new Signer({
    hostname: host,
    port,
    username: user,
    region,
    credentials: awsCredentialsProvider({ roleArn }),
  })

  return new Pool({
    host,
    port,
    user,
    database,
    // IAM auth requires SSL. RDS presents an Amazon CA; rejectUnauthorized:false
    // avoids bundling the RDS CA for the hackathon. TODO(v2): pin the RDS CA
    // bundle and use verify-full per PGSSLMODE.
    ssl: { rejectUnauthorized: false },
    // pg supports an async password function — regenerated per new connection,
    // so expired IAM tokens never wedge the pool.
    password: () => signer.getAuthToken(),
  })
}

export function getPool(): Pool {
  if (!_pool) _pool = buildPool()
  return _pool
}

export function getDb() {
  if (!_db) _db = drizzle(getPool(), { schema })
  return _db
}

export { schema }
