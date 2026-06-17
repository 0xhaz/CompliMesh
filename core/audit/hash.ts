// Hash-chained audit log — the tamper-evidence layer (architecture §3.3 /
// techstack §6). This replaces the template's FNV-1a client mock with a real
// SHA-256 chain over a DETERMINISTIC canonical serialization.
//
//   row_hash = SHA-256(prev_hash || canonical(payload) || run_id || event_type || created_at)
//   genesis prev_hash = 64 zeros
//
// The #1 way hash-chains silently break is non-deterministic serialization — do
// NOT hash raw JSONB (key order isn't guaranteed). canonicalize() defines a
// stable form: recursively sorted keys, explicit text representation.
//
// Framework-agnostic (techstack §2.2): no React/Next imports. Pure + node:crypto.

import { createHash } from 'node:crypto'

export const GENESIS_HASH = '0'.repeat(64)

// Deterministic canonical serialization. Sorted object keys; arrays in order;
// primitives as text. Byte-identical on recompute regardless of input key order.
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return JSON.stringify(value) // quoted, escaped
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`
  }
  // object: sort keys
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`
}

export interface HashableRow {
  prevHash: string
  payload: unknown
  runId: string | null
  eventType: string
  createdAt: string // ISO 8601 — see normalizeCreatedAt
}

// timestamptz round-trips through pg as a Date; normalize both at append and
// verify time to the same ISO string so the hash matches on recompute.
export function normalizeCreatedAt(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

export function computeRowHash(row: HashableRow): string {
  const parts = [
    row.prevHash,
    canonicalize(row.payload),
    row.runId ?? '',
    row.eventType,
    normalizeCreatedAt(row.createdAt),
  ].join('\n')
  return createHash('sha256').update(parts, 'utf8').digest('hex')
}

// --- Verifier (the demo's tamper-detection action) ---

export interface AuditRow {
  seq: number
  runId: string | null
  eventType: string
  payload: unknown
  prevHash: string
  rowHash: string
  createdAt: string | Date
}

export interface VerifyResult {
  intact: boolean
  brokenSeq: number | null
  reason: string | null
}

// Walk the chain by seq, recompute each row_hash, and confirm prev_hash links.
// Returns the first seq where it breaks (recomputed ≠ stored, or a broken link),
// or intact. Rows MUST be passed in ascending seq order.
export function verifyAuditChain(rows: AuditRow[]): VerifyResult {
  let expectedPrev = GENESIS_HASH
  for (const row of rows) {
    if (row.prevHash !== expectedPrev) {
      return {
        intact: false,
        brokenSeq: row.seq,
        reason: `prev_hash at seq ${row.seq} does not match the prior row's hash — a row was inserted, removed, or reordered.`,
      }
    }
    const recomputed = computeRowHash({
      prevHash: row.prevHash,
      payload: row.payload,
      runId: row.runId,
      eventType: row.eventType,
      createdAt: normalizeCreatedAt(row.createdAt),
    })
    if (recomputed !== row.rowHash) {
      return {
        intact: false,
        brokenSeq: row.seq,
        reason: `Stored hash at seq ${row.seq} does not match its recomputed payload — the row was altered.`,
      }
    }
    expectedPrev = row.rowHash
  }
  return { intact: true, brokenSeq: null, reason: null }
}
