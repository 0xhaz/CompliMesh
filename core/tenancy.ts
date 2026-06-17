// Tenancy reads + customer persistence (v2 §9). Pure-ish: DB passed in. No
// React/Next imports (techstack §2.2). Returns plain view objects for the UI.

import { sql } from 'drizzle-orm'
import { customers } from './schema/schema'
import type { OrgKind, UserRole } from './types'

interface Db {
  execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }>
  insert: (table: typeof customers) => {
    values: (v: typeof customers.$inferInsert) => {
      returning: (cols: { id: typeof customers.id }) => Promise<{ id: string }[]>
    }
  }
}

export interface OrgView {
  id: string
  name: string
  kind: OrgKind
}
export interface UserView {
  id: string
  name: string
  email: string
  role: UserRole
}
export interface ClientView {
  id: string
  name: string
  country: string | null
}
export interface CustomerView {
  id: string
  clientId: string
  name: string
  country: string | null
  status: string
}

// The active actor + scope, passed from the dashboard's user/client selection
// into Server Actions. Defined here (framework-agnostic) so client components
// can import the type without reaching into the 'use server' actions module.
export interface ActionContext {
  orgId: string
  clientId: string
  clientName?: string
  userId: string
  userName?: string
  role: string
}

// The demo has one tenant; return it (latest org) plus its users + clients.
export interface Workspace {
  org: OrgView | null
  users: UserView[]
  clients: ClientView[]
}

export async function getWorkspace(db: Db): Promise<Workspace> {
  const orgRes = await db.execute(sql`SELECT id, name, kind FROM organizations ORDER BY created_at ASC LIMIT 1`)
  const orgRow = orgRes.rows[0]
  if (!orgRow) return { org: null, users: [], clients: [] }
  const org: OrgView = { id: String(orgRow.id), name: String(orgRow.name), kind: orgRow.kind as OrgKind }

  const usersRes = await db.execute(
    sql`SELECT id, name, email, role FROM users WHERE org_id = ${org.id} ORDER BY
        CASE role WHEN 'INITIATOR' THEN 0 WHEN 'REVIEWER' THEN 1 WHEN 'APPROVER' THEN 2 WHEN 'ADMIN' THEN 3 ELSE 4 END,
        name ASC`,
  )
  const usersList: UserView[] = usersRes.rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    email: String(r.email),
    role: r.role as UserRole,
  }))

  const clientsRes = await db.execute(
    sql`SELECT id, name, country FROM clients WHERE org_id = ${org.id} ORDER BY name ASC`,
  )
  const clientsList: ClientView[] = clientsRes.rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    country: r.country ? String(r.country) : null,
  }))

  return { org, users: usersList, clients: clientsList }
}

export async function listCustomers(db: Db, clientId: string): Promise<CustomerView[]> {
  const res = await db.execute(sql`
    SELECT id, client_id, name, country, status
    FROM customers WHERE client_id = ${clientId} ORDER BY name ASC
  `)
  return res.rows.map((r) => ({
    id: String(r.id),
    clientId: String(r.client_id),
    name: String(r.name),
    country: r.country ? String(r.country) : null,
    status: String(r.status),
  }))
}

// Find an existing customer (case-insensitive name) under a client, else create.
export async function findOrCreateCustomer(
  db: Db,
  clientId: string,
  name: string,
  country: string | null,
): Promise<string> {
  const existing = await db.execute(
    sql`SELECT id FROM customers WHERE client_id = ${clientId} AND lower(name) = lower(${name}) LIMIT 1`,
  )
  if (existing.rows[0]) return String(existing.rows[0].id)
  const [created] = await db
    .insert(customers)
    .values({ clientId, name, country })
    .returning({ id: customers.id })
  return created.id
}
