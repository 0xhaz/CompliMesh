// Shared types / API contract (techstack §2.1). Framework-agnostic — the
// surface mobile and any future client reuse. Re-exports the Drizzle row types
// and derives string-union types from the schema's CHECK-constraint value lists,
// so the TS unions and the DB constraints can never drift apart.

export type {
  Product,
  NewProduct,
  Entity,
  NewEntity,
  RefSnapshot,
  NewRefSnapshot,
  RestrictedParty,
  NewRestrictedParty,
  HsReference,
  NewHsReference,
  DestinationRule,
  NewDestinationRule,
  ScreeningRun,
  NewScreeningRun,
  ControlHit,
  NewControlHit,
  AuditLogRow,
  NewAuditLogRow,
  Organization,
  NewOrganization,
  User,
  NewUser,
  Client,
  NewClient,
  Customer,
  NewCustomer,
  FpClearance,
  NewFpClearance,
} from '../schema/schema'

import {
  SOURCE_TYPES,
  DESTINATION_RULE_TYPES,
  VERDICTS,
  HIT_SOURCE_TYPES,
  HIT_DIMENSIONS,
  HIT_RULE_TYPES,
  AUDIT_EVENT_TYPES,
  ORG_KINDS,
  USER_ROLES,
  RUN_TRIGGERS,
  RUN_STATUSES,
} from '../schema/schema'

export type SourceType = (typeof SOURCE_TYPES)[number]
export type DestinationRuleType = (typeof DESTINATION_RULE_TYPES)[number]
export type Verdict = (typeof VERDICTS)[number]
export type HitSourceType = (typeof HIT_SOURCE_TYPES)[number]
export type HitDimension = (typeof HIT_DIMENSIONS)[number]
export type HitRuleType = (typeof HIT_RULE_TYPES)[number]
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number]
export type OrgKind = (typeof ORG_KINDS)[number]
export type UserRole = (typeof USER_ROLES)[number]
export type RunTrigger = (typeof RUN_TRIGGERS)[number]
export type RunStatus = (typeof RUN_STATUSES)[number]
