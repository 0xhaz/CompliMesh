// Migration runner. drizzle-kit migrate can't use a dynamically-signed IAM
// password, so we apply migrations through the same IAM-auth pool the app uses:
//   1. migrations/drizzle/*.sql  (generated schema — tables, FKs, checks, indexes)
//   2. migrations/sql/*.sql      (hand-written Postgres machinery — pg_trgm, GIN,
//                                  REVOKE, append-only trigger)
//
// Run: pnpm db:migrate   (after `vercel env pull .env.local`)

import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildPool } from '../core/schema/db'

const ROOT = process.cwd()

function sqlFilesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort() // lexical order == migration order (0000_, 0001_, ...)
    .map((f) => join(dir, f))
}

async function run() {
  const pool = buildPool()
  const client = await pool.connect()
  try {
    // --- 1. Drizzle-generated schema (split on statement-breakpoint markers) ---
    for (const file of sqlFilesIn(join(ROOT, 'migrations/drizzle'))) {
      const sql = readFileSync(file, 'utf8')
      const statements = sql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean)
      console.log(`\n▶ ${file}  (${statements.length} statements)`)
      for (const stmt of statements) {
        await client.query(stmt)
      }
      console.log(`  ✓ applied`)
    }

    // --- 2. Hand-written machinery (run whole file; contains a $$ function body) ---
    for (const file of sqlFilesIn(join(ROOT, 'migrations/sql'))) {
      const sql = readFileSync(file, 'utf8')
      console.log(`\n▶ ${file}`)
      await client.query(sql) // pg simple-query protocol runs multiple statements
      console.log(`  ✓ applied`)
    }

    console.log('\n✅ Migrations applied.')
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch((err) => {
  console.error('\n❌ Migration failed:', err)
  process.exit(1)
})
