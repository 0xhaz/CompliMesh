// CompliMesh data model — Aurora PostgreSQL via Drizzle.
// Rationale in architecture-complimesh.md §3 / techstack-complimesh.md §3.
//
// Load-bearing design points (preserve these):
//  - FKs + constraints: a verdict cannot exist without its inputs.
//  - PER-SOURCE versioned reference data: every screening_run records WHICH
//    snapshot of each source (restricted-party / HS / destination) it used.
//  - control_hits is the resolution layer (Option C): every fired control
//    becomes a uniform row; verdict = aggregation over hits; zero hits = GO.
//  - audit_log is append-only + hash-chained (the differentiator). The
//    append-only REVOKE + trigger and the pg_trgm GIN index are hand-written
//    SQL (migrations/sql/0001_postgres_machinery.sql), not generated here.
//
// NOTE: this file is framework-agnostic (techstack §2.2) — no React/Next imports.

import { sql } from 'drizzle-orm'
import {
  bigserial,
  char,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

// ---- Enumerated string domains (kept as text + CHECK, per architecture §3) ----
// We model these as text columns with CHECK constraints rather than native
// pg enums: cheaper to evolve (no ALTER TYPE dance) and the values double as
// the API contract surfaced in core/types.

export const SOURCE_TYPES = ['RESTRICTED_PARTY', 'HS', 'DESTINATION_RULE'] as const
export const DESTINATION_RULE_TYPES = ['PROHIBITED', 'LICENSE_REQUIRED', 'ALLOWED'] as const
export const VERDICTS = ['GO', 'REVIEW', 'NO_GO'] as const
export const HIT_SOURCE_TYPES = ['RESTRICTED_PARTY', 'DESTINATION_RULE', 'CLASSIFICATION'] as const
export const HIT_DIMENSIONS = ['ENTITY', 'HS_COUNTRY', 'CONFIDENCE'] as const
export const HIT_RULE_TYPES = [
  'PROHIBITED', // exact entity match OR destination PROHIBITED -> NO_GO
  'FUZZY_MATCH', // confident/grey-zone fuzzy entity match -> REVIEW
  'LICENSE_REQUIRED', // destination license needed -> REVIEW
  'LOW_CONFIDENCE', // classification below floor -> REVIEW
] as const
export const AUDIT_EVENT_TYPES = [
  'RUN_CREATED',
  'CLASSIFY',
  'SCREEN',
  'RESOLVE',
  'VERDICT',
  'RESCREEN', // re-screening triggered by a list change
  'APPROVE', // approver authorized a flagged shipment
  'REJECT', // approver rejected a flagged shipment
  'CLEAR_FALSE_POSITIVE', // reviewer cleared a fuzzy match as not-a-match
] as const

// --- v2: multi-tenancy, users/roles, run workflow (architecture-v2 §9) ---
export const ORG_KINDS = ['EXPORTER', 'FORWARDER', 'BROKER'] as const
export const USER_ROLES = ['INITIATOR', 'REVIEWER', 'APPROVER', 'ADMIN', 'AUDITOR'] as const
export const RUN_TRIGGERS = ['MANUAL', 'BATCH', 'RESCREEN', 'WEBHOOK'] as const
export const RUN_STATUSES = [
  'CLEARED', // GO — no approval needed
  'PENDING_REVIEW', // REVIEW — awaiting an approver
  'BLOCKED', // NO_GO — not overridable without higher authority
  'APPROVED', // approver authorized despite a REVIEW flag
  'REJECTED', // approver rejected
] as const

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} IN (${values.map((v) => `'${v}'`).join(', ')})`)

// ---------------------------------------------------------------------------
// products — raw user input + resolved classification
// ---------------------------------------------------------------------------
export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  description: text('description').notNull(), // raw user input
  hsCode: text('hs_code'), // resolved/selected
  hsConfidence: numeric('hs_confidence'), // 0..1, from classification
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// entities — counterparties being screened
// ---------------------------------------------------------------------------
export const entities = pgTable('entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  country: text('country'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// ref_snapshots — PER-SOURCE version anchor (architecture §2.3)
// Real feeds update on different cadences, so snapshots are scoped by source.
// ---------------------------------------------------------------------------
export const refSnapshots = pgTable(
  'ref_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceType: text('source_type').notNull(), // SOURCE_TYPES
    label: text('label').notNull(), // e.g. 'OFAC SDN 2026-06'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('ref_snapshots_source_type_ck', inList('source_type', SOURCE_TYPES))],
)

// ---------------------------------------------------------------------------
// restricted_parties — reference data (versioned, fuzzy-matched)
// pg_trgm GIN index on name is created in the hand-written SQL migration.
// ---------------------------------------------------------------------------
export const restrictedParties = pgTable('restricted_parties', {
  id: uuid('id').primaryKey().defaultRandom(),
  listSource: text('list_source').notNull(), // e.g. 'OFAC_SDN', 'BIS_ENTITY'
  name: text('name').notNull(),
  aliases: jsonb('aliases'), // alt names / transliterations
  country: text('country'),
  snapshotId: uuid('snapshot_id')
    .notNull()
    .references(() => refSnapshots.id),
})

// ---------------------------------------------------------------------------
// hs_reference — curated HS subset (versioned)
// ---------------------------------------------------------------------------
export const hsReference = pgTable('hs_reference', {
  id: uuid('id').primaryKey().defaultRandom(),
  hsCode: text('hs_code').notNull(),
  description: text('description').notNull(),
  controlFlags: jsonb('control_flags'), // e.g. dual-use markers
  snapshotId: uuid('snapshot_id')
    .notNull()
    .references(() => refSnapshots.id),
})

// ---------------------------------------------------------------------------
// destination_rules — product x destination logic (versioned)
// hs_code_prefix is a PREFIX match (4–6 digit), not a full code (architecture §3.1).
// ---------------------------------------------------------------------------
export const destinationRules = pgTable(
  'destination_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hsCodePrefix: text('hs_code_prefix'), // PREFIX match (4–6 digit)
    country: text('country').notNull(),
    ruleType: text('rule_type').notNull(), // DESTINATION_RULE_TYPES
    notes: text('notes'),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => refSnapshots.id),
  },
  (t) => [
    check('destination_rules_rule_type_ck', inList('rule_type', DESTINATION_RULE_TYPES)),
    index('idx_destination_rules_lookup').on(t.country, t.hsCodePrefix),
  ],
)

// ---------------------------------------------------------------------------
// ===========================================================================
// v2 — multi-tenancy, users/roles, persistent customers (architecture-v2 §9)
// ===========================================================================

// organizations — the TENANT. A solo exporter or a multi-client forwarder.
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    kind: text('kind').notNull(), // ORG_KINDS
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('organizations_kind_ck', inList('kind', ORG_KINDS))],
)

// users — members of an org, with a role (segregation of duties, §9 Tier 3).
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    email: text('email').notNull(),
    role: text('role').notNull(), // USER_ROLES
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('users_role_ck', inList('role', USER_ROLES)),
    index('idx_users_org').on(t.orgId),
  ],
)

// clients — client accounts within an org. An exporter has one (itself); a
// forwarder has many. The unit the client-switcher and cross-client roll-up use.
export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    country: text('country'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_clients_org').on(t.orgId)],
)

// customers — saved counterparties under a client. Persistence enables history
// and re-screening on list change (§9 Tier 1).
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    name: text('name').notNull(),
    country: text('country'),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | ARCHIVED
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_customers_client').on(t.clientId)],
)

// fp_clearances — a reviewer cleared a fuzzy match to a party as not-a-match.
// Future runs for that customer suppress that party's FUZZY_MATCH hit (§9 Tier 2).
export const fpClearances = pgTable(
  'fp_clearances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    partyName: text('party_name').notNull(), // the restricted-party name cleared
    reason: text('reason').notNull(),
    clearedBy: uuid('cleared_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_fp_customer').on(t.customerId)],
)

// ---------------------------------------------------------------------------
// screening_runs — THE core object. Records which snapshot of EACH source it
// evaluated against (3 snapshot FKs). verdict is an aggregation over control_hits.
// v2: scoped to org/client/customer, with initiator + workflow status.
// ---------------------------------------------------------------------------
export const screeningRuns = pgTable(
  'screening_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id').references(() => products.id),
    entityId: uuid('entity_id').references(() => entities.id),
    destination: text('destination').notNull(), // country code
    // v2 scope (nullable for back-compat with pre-v2 rows; set going forward)
    orgId: uuid('org_id').references(() => organizations.id),
    clientId: uuid('client_id').references(() => clients.id),
    customerId: uuid('customer_id').references(() => customers.id),
    initiatedBy: uuid('initiated_by').references(() => users.id),
    trigger: text('trigger').notNull().default('MANUAL'), // RUN_TRIGGERS
    status: text('status').notNull().default('CLEARED'), // RUN_STATUSES
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rpSnapshotId: uuid('rp_snapshot_id')
      .notNull()
      .references(() => refSnapshots.id), // restricted-party rules used
    hsSnapshotId: uuid('hs_snapshot_id')
      .notNull()
      .references(() => refSnapshots.id), // HS rules used
    drSnapshotId: uuid('dr_snapshot_id')
      .notNull()
      .references(() => refSnapshots.id), // destination rules used
    verdict: text('verdict').notNull(), // VERDICTS
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('screening_runs_verdict_ck', inList('verdict', VERDICTS)),
    check('screening_runs_trigger_ck', inList('trigger', RUN_TRIGGERS)),
    check('screening_runs_status_ck', inList('status', RUN_STATUSES)),
    index('idx_runs_client').on(t.clientId),
    index('idx_runs_customer').on(t.customerId),
    index('idx_runs_status').on(t.status),
  ],
)

// ---------------------------------------------------------------------------
// control_hits — RESOLUTION LAYER (Option C). Every fired control, uniform
// shape. Verdict = aggregation over these. A run with zero hits = GO.
// ---------------------------------------------------------------------------
export const controlHits = pgTable(
  'control_hits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => screeningRuns.id),
    sourceType: text('source_type').notNull(), // HIT_SOURCE_TYPES
    sourceRefId: uuid('source_ref_id'), // fk into originating ref table (nullable, polymorphic)
    dimension: text('dimension').notNull(), // HIT_DIMENSIONS
    ruleType: text('rule_type').notNull(), // HIT_RULE_TYPES
    matchScore: numeric('match_score'), // pg_trgm similarity or classification confidence
    reason: text('reason').notNull(), // human-readable, drives audit log + UI
    snapshotId: uuid('snapshot_id').references(() => refSnapshots.id),
  },
  (t) => [
    check('control_hits_source_type_ck', inList('source_type', HIT_SOURCE_TYPES)),
    check('control_hits_dimension_ck', inList('dimension', HIT_DIMENSIONS)),
    check('control_hits_rule_type_ck', inList('rule_type', HIT_RULE_TYPES)),
    index('idx_control_hits_run').on(t.runId),
  ],
)

// ---------------------------------------------------------------------------
// audit_log — append-only + hash-chained (tamper-evident). architecture §3.3.
// row_hash = SHA-256(prev_hash || canonical(payload) || run_id || event_type || created_at)
// Genesis prev_hash = 64 zeros. Single global chain ordered by seq.
// Append-only is ENFORCED in the hand-written SQL migration (REVOKE + trigger).
// ---------------------------------------------------------------------------
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').references(() => screeningRuns.id),
    seq: bigserial('seq', { mode: 'number' }).notNull(), // strict chain order (single global chain)
    eventType: text('event_type').notNull(), // AUDIT_EVENT_TYPES
    payload: jsonb('payload').notNull(), // full input + output snapshot
    prevHash: char('prev_hash', { length: 64 }).notNull(), // hex SHA-256 of previous row; genesis = 64x'0'
    rowHash: char('row_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('audit_log_event_type_ck', inList('event_type', AUDIT_EVENT_TYPES)),
    index('idx_audit_log_seq').on(t.seq),
  ],
)

// ---- Inferred row types (re-exported via core/types for the API contract) ----
export type Product = typeof products.$inferSelect
export type NewProduct = typeof products.$inferInsert
export type Entity = typeof entities.$inferSelect
export type NewEntity = typeof entities.$inferInsert
export type RefSnapshot = typeof refSnapshots.$inferSelect
export type NewRefSnapshot = typeof refSnapshots.$inferInsert
export type RestrictedParty = typeof restrictedParties.$inferSelect
export type NewRestrictedParty = typeof restrictedParties.$inferInsert
export type HsReference = typeof hsReference.$inferSelect
export type NewHsReference = typeof hsReference.$inferInsert
export type DestinationRule = typeof destinationRules.$inferSelect
export type NewDestinationRule = typeof destinationRules.$inferInsert
export type ScreeningRun = typeof screeningRuns.$inferSelect
export type NewScreeningRun = typeof screeningRuns.$inferInsert
export type ControlHit = typeof controlHits.$inferSelect
export type NewControlHit = typeof controlHits.$inferInsert
export type AuditLogRow = typeof auditLog.$inferSelect
export type NewAuditLogRow = typeof auditLog.$inferInsert
export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Client = typeof clients.$inferSelect
export type NewClient = typeof clients.$inferInsert
export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
export type FpClearance = typeof fpClearances.$inferSelect
export type NewFpClearance = typeof fpClearances.$inferInsert
