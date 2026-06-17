// Append-only audit ledger with a tamper-evident hash chain.
// Each event hashes its own payload together with the previous event's hash,
// so altering any past row breaks every hash from that point forward — and the
// verifier can pinpoint exactly which sequence number broke.

export type AuditEventType =
  | 'SCREENING_RUN'
  | 'VERDICT_RECORDED'
  | 'RULESET_SNAPSHOT'
  | 'NOTE_ADDED'
  | 'EXPORT_GENERATED'

export interface AuditEvent {
  seq: number
  type: AuditEventType
  detail: string
  timestamp: string
  prevHash: string
  hash: string
}

export const GENESIS_HASH = '0000000000000000'

// Small, stable, synchronous hash (FNV-1a 32-bit, hex, padded). Not for
// cryptographic use — it's a clear, deterministic stand-in for a real SHA-256
// chain so the demo runs entirely client-side.
export function hashString(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // Mix to widen the output, then render 16 hex chars.
  const a = (h >>> 0).toString(16).padStart(8, '0')
  let h2 = 0x9e3779b1
  for (let i = input.length - 1; i >= 0; i--) {
    h2 ^= input.charCodeAt(i)
    h2 = Math.imul(h2, 0x85ebca77)
  }
  const b = (h2 >>> 0).toString(16).padStart(8, '0')
  return `${a}${b}`
}

export function computeHash(
  event: Omit<AuditEvent, 'hash'>,
): string {
  const payload = `${event.seq}|${event.type}|${event.detail}|${event.timestamp}|${event.prevHash}`
  return hashString(payload)
}

export function appendEvent(
  ledger: AuditEvent[],
  type: AuditEventType,
  detail: string,
  timestamp = new Date().toISOString(),
): AuditEvent[] {
  const prev = ledger[ledger.length - 1]
  const seq = prev ? prev.seq + 1 : 1
  const prevHash = prev ? prev.hash : GENESIS_HASH
  const base = { seq, type, detail, timestamp, prevHash }
  const hash = computeHash(base)
  return [...ledger, { ...base, hash }]
}

export interface VerifyResult {
  intact: boolean
  brokenSeq: number | null
  reason: string | null
}

// Walk the chain. For each event, recompute the hash from its payload and
// confirm prevHash matches the prior event's stored hash.
export function verifyChain(ledger: AuditEvent[]): VerifyResult {
  let expectedPrev = GENESIS_HASH
  for (const event of ledger) {
    if (event.prevHash !== expectedPrev) {
      return {
        intact: false,
        brokenSeq: event.seq,
        reason: `prevHash at seq ${event.seq} does not match the prior event's hash.`,
      }
    }
    const recomputed = computeHash({
      seq: event.seq,
      type: event.type,
      detail: event.detail,
      timestamp: event.timestamp,
      prevHash: event.prevHash,
    })
    if (recomputed !== event.hash) {
      return {
        intact: false,
        brokenSeq: event.seq,
        reason: `Stored hash at seq ${event.seq} does not match its recomputed payload — the row was altered.`,
      }
    }
    expectedPrev = event.hash
  }
  return { intact: true, brokenSeq: null, reason: null }
}

// Build a believable starting ledger for the demo.
export function seedLedger(): AuditEvent[] {
  let ledger: AuditEvent[] = []
  const base = new Date('2026-06-12T09:14:00Z').getTime()
  const step = 7 * 60 * 1000
  let i = 0
  const at = () => new Date(base + step * i++).toISOString()

  ledger = appendEvent(ledger, 'RULESET_SNAPSHOT', 'CSL snapshot · 2026-06-12 loaded', at())
  ledger = appendEvent(
    ledger,
    'SCREENING_RUN',
    'SCR-20260612-001 · laptop → Germany (DE)',
    at(),
  )
  ledger = appendEvent(ledger, 'VERDICT_RECORDED', 'SCR-20260612-001 · GO', at())
  ledger = appendEvent(
    ledger,
    'SCREENING_RUN',
    'SCR-20260612-002 · routing equipment → Russia (RU)',
    at(),
  )
  ledger = appendEvent(
    ledger,
    'VERDICT_RECORDED',
    'SCR-20260612-002 · NO_GO (OFAC SDN exact match)',
    at(),
  )
  ledger = appendEvent(
    ledger,
    'SCREENING_RUN',
    'SCR-20260612-003 · thermal sensor → Türkiye (TR)',
    at(),
  )
  ledger = appendEvent(
    ledger,
    'VERDICT_RECORDED',
    'SCR-20260612-003 · REVIEW (license required)',
    at(),
  )
  ledger = appendEvent(
    ledger,
    'EXPORT_GENERATED',
    'Audit export · 3 screenings · PDF',
    at(),
  )
  return ledger
}

// Produce a tampered copy of the ledger: alter one row's detail WITHOUT
// recomputing downstream hashes, so the chain breaks at that seq. Used to
// demonstrate tamper detection.
export function tamperLedger(ledger: AuditEvent[], seq: number): AuditEvent[] {
  return ledger.map((e) =>
    e.seq === seq
      ? { ...e, detail: e.detail.replace(/NO_GO[^·]*/, 'GO ') + '(altered)' }
      : e,
  )
}

export function truncateHash(hash: string): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`
}
