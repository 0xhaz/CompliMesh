// Audit view-model for the ledger UI (Phase 6). Maps real audit_log rows into
// the shape the AuditTrailView consumes. Pure — no node:crypto, so it's safe to
// import into client components (unlike hash.ts).
//
// Framework-agnostic (techstack §2.2): no React/Next imports.

import type { AuditRow } from './hash'

// Re-export the verify result type (type-only — pulls no runtime crypto).
export type { VerifyResult } from './hash'

export interface AuditEventView {
  seq: number
  type: string
  detail: string
  timestamp: string
  prevHash: string
  hash: string
  tampered?: boolean
}

// Back-compat alias so the component only changes its import path.
export type AuditEvent = AuditEventView

export function truncateHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

function detailFor(eventType: string, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>
  switch (eventType) {
    case 'RUN_CREATED':
      return `${String(p.product ?? '').slice(0, 44)} → ${String(p.destination ?? '')}`
    case 'CLASSIFY':
      return `HS ${p.hsCode ?? '—'} · conf ${p.confidence ?? '—'} (${p.source ?? '—'})`
    case 'SCREEN':
      return p.party
        ? `${p.band} · ${p.party} @${p.score}`
        : `${p.band} · no list hit`
    case 'RESOLVE': {
      const hits = Array.isArray(p.hits) ? p.hits.length : 0
      return `${hits} control hit${hits === 1 ? '' : 's'} resolved`
    }
    case 'VERDICT':
      return `${p.verdict}${p.snapshots && (p.snapshots as Record<string, unknown>).rp ? ` · ${(p.snapshots as Record<string, unknown>).rp}` : ''}`
    default:
      return JSON.stringify(payload)
  }
}

export function toAuditEventView(row: AuditRow): AuditEventView {
  const createdIso = (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString()
  return {
    seq: row.seq,
    type: row.eventType,
    detail: detailFor(row.eventType, row.payload),
    timestamp: createdIso,
    prevHash: row.prevHash,
    hash: row.rowHash,
  }
}
