import { defineConfig } from 'drizzle-kit'
import 'dotenv/config'

// Drizzle Kit config. `generate` (schema -> SQL) works offline; `push`/`migrate`
// need a live connection. The Vercel AWS integration injects connection env vars
// (OIDC + RDS IAM, short-lived tokens — NOT a static string, see techstack §1).
// Locally: `vercel link` then `vercel env pull` to populate them.
//
// We accept either a single DATABASE_URL or discrete PG* vars, whichever the
// integration provides — resolved at runtime in core/schema/db.ts too.
export default defineConfig({
  dialect: 'postgresql',
  schema: './core/schema/schema.ts',
  out: './migrations/drizzle',
  // dbCredentials is only consulted by push/migrate; generate ignores it.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://placeholder:placeholder@localhost:5432/placeholder',
  },
  verbose: true,
  strict: true,
})
