-- ============================================================================
-- CompliMesh — Tamper-Detection Demo Runbook (the submission video centerpiece)
-- ============================================================================
-- Run these against Aurora via: Vercel dashboard → Storage → your DB → Query,
-- or psql, or the AWS RDS Query Editor. Pair with `pnpm db:verify` (CLI) or the
-- "Verify chain" button on the Audit trail screen.
--
-- The story (architecture §3.3): TWO layers of defense.
--   Layer B — PREVENTION: the app role cannot UPDATE/DELETE audit_log
--             (REVOKE + an append-only trigger).
--   Layer C — EVIDENCE: even if prevention is bypassed (a DB owner disables the
--             trigger), the SHA-256 hash chain makes any edit mathematically
--             detectable, and the verifier pinpoints the exact row.
--
-- Honest scope: this is tamper-EVIDENCE for single-record edits + app-level
-- PREVENTION. It does NOT defend against a full chain rewrite from genesis —
-- that needs external notarization (v2 roadmap).
-- ----------------------------------------------------------------------------

-- 0) Baseline — confirm the chain is intact first.
--    CLI:  pnpm db:verify        → "✅ CHAIN INTACT"
--    Peek at the ledger:
SELECT seq, event_type, left(row_hash, 12) AS row_hash, left(prev_hash, 12) AS prev_hash
FROM audit_log ORDER BY seq;

-- ----------------------------------------------------------------------------
-- 1) LAYER B — PREVENTION. Try to tamper as the app would. This is BLOCKED.
--    Expect: ERROR "audit_log is append-only; UPDATE is not permitted".
UPDATE audit_log
SET payload = jsonb_set(payload, '{verdict}', '"GO"')
WHERE seq = (SELECT seq FROM audit_log WHERE event_type = 'VERDICT' ORDER BY seq LIMIT 1);
--    ^ Run it. It fails. The application physically cannot rewrite history.

-- ----------------------------------------------------------------------------
-- 2) LAYER C — EVIDENCE. Now play the worst case: a DB owner bypasses
--    prevention by disabling the trigger, then flips a NO_GO verdict to GO.
ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_immutable;

UPDATE audit_log
SET payload = jsonb_set(payload, '{verdict}', '"GO"')
WHERE seq = (
  SELECT seq FROM audit_log
  WHERE event_type = 'VERDICT' AND payload->>'verdict' = 'NO_GO'
  ORDER BY seq LIMIT 1
);

ALTER TABLE audit_log ENABLE TRIGGER trg_audit_log_immutable;
--    The row is now altered, but its stored row_hash was NOT recomputed.

-- 3) Run the verifier — it pinpoints the exact broken seq.
--    CLI:  pnpm db:verify   → "❌ CHAIN BROKEN at seq N"
--    UI:   Audit trail → "Verify chain"  (broken row rendered in oxblood)
--    The hash no longer matches the payload, and every subsequent row's link
--    breaks too — the verifier reports the FIRST break.

-- ----------------------------------------------------------------------------
-- 4) RESTORE — rebuild a clean, known state for a second take.
--    From the project root:  pnpm seed
--    (truncates + reseeds reference data, tenant, and demo history)
-- ============================================================================
