# techstack.md — CompliMesh

**Project:** CompliMesh — unified SMB-tier trade/export compliance screening engine.
**Companion doc:** architecture.md (the *why* behind every decision). This doc is the *what to build and in what order*.
**Status:** build-ready.

> One-liner for context: CompliMesh answers, in a single check, "Can THIS product go to THIS company in THIS country under current rules — and can I prove I checked?" It unifies three checks (HS classification → restricted-party screening → destination control) into one verdict (GO / REVIEW / NO_GO) plus a tamper-evident audit trail.

---

## 1. Stack overview

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js (App Router)** | Server Actions / Route Handlers for the screening pipeline |
| Hosting | **Vercel** | Functions co-located with the DB in AWS (no network hop) |
| Database | **Aurora PostgreSQL (serverless)** | Provisioned via Vercel Marketplace AWS integration |
| DB access | **Drizzle ORM** | SQL-first; type-safe; we control the queries |
| Migrations | **Drizzle Kit** + **hand-written SQL** | Postgres-specific machinery is raw SQL (see §4.2) |
| Fuzzy matching | **`pg_trgm`** (Postgres extension) | Trigram similarity for entity-name screening |
| AI | **Anthropic API** (hosted key, server-side) | Classification assist only; key in Vercel env var |
| Language | **TypeScript** throughout | |
| Styling | **Tailwind** (v0 output) | Design tokens in §6 / see architecture.md §5 |
| Fonts | **Space Grotesk** (display/UI) + **Geist Mono / JetBrains Mono** (all data) | NOT Inter |

**Hard rule on connections:** the Vercel AWS integration uses OIDC federation + RDS IAM auth (short-lived tokens), NOT a static connection string. Use the env vars the integration injects; do not hardcode credentials. For local dev, link the project (`vercel link`) and pull env vars (`vercel env pull`).

---

## 2. Folder structure & monorepo-readiness

**Decision: single Next.js app for the hackathon, structured to be monorepo-ready — NOT an actual monorepo yet.** Mobile and other apps are roadmap (near future, not now). A monorepo pays off only when there are *multiple deployable apps sharing real code*; today there's one app. Setting up Turborepo/workspaces now costs hackathon hours and adds v0/Vercel wiring friction (v0 generates a single-app layout; a monorepo forces relocating output into `apps/web/` and configuring Vercel root dir) for a benefit not collected until the second app exists.

**The move:** isolate would-be-shared code into a framework-agnostic `core/` directory, organized exactly how it would become a package later. This gets ~90% of the future benefit at near-zero cost and makes the eventual monorepo migration mechanical rather than a refactor.

### 2.1 Hackathon layout (single app)
```
complimesh/
  app/                    # Next.js App Router (web UI: landing + dashboard)
  core/                   # FRAMEWORK-AGNOSTIC — the future shared package
    schema/               # Drizzle schema (the data model, §3)
    screening/            # pipeline: classify, screen, resolve, verdict logic (§5)
    audit/                # hash-chain + verifier (§6)
    types/                # shared types / API contract
  migrations/
    drizzle/              # generated schema migrations
    sql/                  # hand-written: pg_trgm, REVOKE, trigger (§4.2)
  scripts/
    seed.ts               # deterministic demo seed (§4.3)
```

### 2.2 The boundary discipline (load-bearing — this is what makes it work)
- `core/` MUST NOT import from `app/`.
- `core/` MUST NOT import React or Next.js (no framework deps, no server-only APIs leaking in).
- Dependencies point ONE way: `app/` imports `core/`, never the reverse.
- Keep everything mobile will eventually reuse in `core/`: screening types, verdict/threshold logic, Drizzle schema, validation, the API contract.
- The screening pipeline logic lives in `core/screening/`; the Next.js Server Action / Route Handler in `app/` is a thin wrapper that calls into it. (So mobile can later call the same logic via an API layer without touching web code.)

### 2.3 Future monorepo migration (when mobile becomes the next build, not before)
Trigger: mobile stops being roadmap and becomes the thing you're building next — at that point there's a concrete second consumer of `core/` and the shared-code benefit is immediate.
Migration (≈a day, mechanical, no logic untangling if the boundary held):
```
complimesh/
  apps/
    web/                  # <- today's app/
    mobile/               # new (Expo/React Native)
  packages/
    core/                 # <- today's core/  (now a real workspace package)
  + workspace config (pnpm workspaces / Turborepo)
  + Vercel root dir set to apps/web
```

---

## 3. Data model (Aurora PostgreSQL)

Full rationale in architecture.md §3. Tables:

- `products` — id, description, hs_code, hs_confidence, created_at
- `entities` — id, name, country, created_at (counterparties being screened)
- `ref_snapshots` — id, source_type ('RESTRICTED_PARTY'|'HS'|'DESTINATION_RULE'), label, created_at — **per-source** version anchor
- `restricted_parties` — id, list_source, name, aliases (jsonb), country, snapshot_id → ref_snapshots. **pg_trgm GIN index on name.**
- `hs_reference` — id, hs_code, description, control_flags (jsonb), snapshot_id
- `destination_rules` — id, hs_code_prefix (PREFIX match, 4–6 digit), country, rule_type ('PROHIBITED'|'LICENSE_REQUIRED'|'ALLOWED'), notes, snapshot_id
- `screening_runs` — id, product_id, entity_id, destination, rp_snapshot_id, hs_snapshot_id, dr_snapshot_id, verdict ('GO'|'REVIEW'|'NO_GO'), created_at
- `control_hits` — id, run_id, source_type, source_ref_id, dimension ('ENTITY'|'HS_COUNTRY'|'CONFIDENCE'), rule_type ('PROHIBITED'|'LICENSE_REQUIRED'|'FUZZY_MATCH'|'LOW_CONFIDENCE'), match_score, reason, snapshot_id — **resolution layer** (Option C)
- `audit_log` — id, run_id, seq (bigserial), event_type, payload (jsonb), prev_hash char(64), row_hash char(64), created_at — **append-only + hash-chained**

Key design points the IDE must preserve:
- Every `screening_run` records which snapshot of each source it used (3 snapshot FKs).
- `verdict` is an **aggregation over `control_hits`**, not an ad-hoc combine. Zero hits = GO.
- `audit_log` is the differentiator — append-only AND hash-chained (see §6).

---

## 4. Migrations & DB setup — order of operations

Migrations are split: Drizzle-managed schema + hand-written SQL for Postgres-specific machinery Drizzle can't generate.

**3.1 Drizzle schema migration** (generated from `schema.ts`): creates all tables, FKs, constraints, indexes (except the trgm GIN index, which is raw SQL).

**3.2 Hand-written SQL migration** (`migrations/sql/0001_postgres_machinery.sql`), run after the Drizzle migration:

```sql
-- pg_trgm for fuzzy entity matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on restricted-party names
CREATE INDEX IF NOT EXISTS idx_rp_name_trgm
  ON restricted_parties USING gin (name gin_trgm_ops);

-- audit_log append-only: revoke mutation from the app role
-- (replace APP_ROLE with the role the Vercel integration uses)
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
-- if a specific app role exists: REVOKE UPDATE, DELETE ON audit_log FROM <APP_ROLE>;

-- belt-and-suspenders: trigger that hard-blocks UPDATE/DELETE on audit_log
CREATE OR REPLACE FUNCTION audit_log_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
```

> Note: the integration's DB role and exact role name come from the Vercel AWS setup — adjust the REVOKE target once known. The trigger is the portable guarantee regardless of role config.

**3.3 Seed script** (`scripts/seed.ts`, uses the Drizzle client): loads demo reference data deterministically so the demo DB can be torn down and rebuilt to a known state before recording. Seeds:
- A curated **trim of the real US Consolidated Screening List (CSL)** into `restricted_parties` (real entries, only those the demo scenarios hit) under one `RESTRICTED_PARTY` snapshot.
- A curated synthetic `hs_reference` subset (only the demo product categories) under an `HS` snapshot.
- A curated synthetic `destination_rules` set (a few country/HS-prefix combos producing all three rule_types) under a `DESTINATION_RULE` snapshot.
- The three scripted demo scenarios (clean GO, sanctioned-entity NO_GO, license-required REVIEW).

---

## 5. The screening pipeline (server-side)

One screening run = one transaction. Logic in architecture.md §4.2–4.3.

```
POST /api/screen  (or a Server Action)
  1. CLASSIFY    description -> Anthropic proposes HS candidates -> validate against
                 hs_reference -> hs_code + confidence  (propose-then-validate)
  2. SCREEN      entity.name -> normalize (strip corp suffixes) -> pg_trgm similarity
                 vs restricted_parties (current RP snapshot)
  3. DESTINATION resolve destination_rules(hs_prefix, country) on current DR snapshot
  4. RESOLVE     emit control_hits for every fired control:
                   - exact normalized entity match     -> rule_type PROHIBITED
                   - fuzzy entity match (>0.6 or 0.3–0.6 grey) -> FUZZY_MATCH
                   - destination PROHIBITED             -> PROHIBITED
                   - destination LICENSE_REQUIRED       -> LICENSE_REQUIRED
                   - classification conf below floor    -> LOW_CONFIDENCE
  5. VERDICT     aggregate hits (worst wins): any PROHIBITED -> NO_GO;
                 any FUZZY_MATCH/LICENSE_REQUIRED/LOW_CONFIDENCE -> REVIEW;
                 zero hits -> GO
  6. PERSIST     write screening_run + control_hits + audit_log row(s) in ONE
                 transaction; the audit append locks the chain tip (see §6)
```

**Threshold starting values** (tune against seeded data; philosophy is locked, numbers are not):
- pg_trgm: clean `< 0.3`, grey-zone `0.3–0.6`, confident match `> 0.6`
- classification confidence floor: `~0.5–0.6`
- **A fuzzy match never auto-prohibits** — hard NO_GO only for exact normalized match or destination PROHIBITED.

**Liability rule (must surface in UI + outputs):** output is decision support, not a legal determination. REVIEW/NO_GO = stop and consult; never silently clear a borderline call.

---

## 6. Hash-chained audit log — implementation rules (easy to get wrong)

This is the demo centerpiece (tamper detection). Get these right:

1. **Deterministic canonical serialization.** Do NOT hash raw JSONB (key order not guaranteed). Define a canonical form (sorted keys, fixed field order, text repr of every value) and hash that. This is the #1 way chains silently break.
2. **Hash formula:** `row_hash = SHA-256(prev_hash || canonical(payload) || run_id || event_type || created_at)`. Genesis row `prev_hash` = 64 zeros.
3. **Serialized appends.** Computing prev_hash requires reading the chain tip; concurrent appends can fork the chain. The audit append must **lock the chain tip** (row lock on the latest `seq`) while computing the new hash — inside the same transaction as the screening write.
4. **Single global chain** ordered by `seq` (bigserial).
5. **Verifier:** a read function `verifyAuditChain()` walks rows by `seq`, recomputes each `row_hash`, returns the first `seq` where recomputed ≠ stored (or "intact"). This powers the "Verify chain" UI action and the broken-hash demo.

**Scope of the claim (state precisely, don't overclaim):** tamper-EVIDENCE against single-record alteration + app-level tamper-PREVENTION (REVOKE + trigger). Does NOT defend against a DB owner rewriting the whole chain from genesis — that needs external anchoring (v2, see architecture.md §9).

---

## 7. Frontend

Two pages (generated via v0 — see v0-prompts.md). Aesthetic: **precision instrument**, not dashboard.

Design tokens (also in architecture.md §5.2):
```
--base    #F2F0EB   (warm off-white; never pure white)
--ink     #161719   (near-black)
--accent  #1F4E4A   (deep slate-teal; only accent, used sparingly)
--muted   #6B6E73
--hairline#D8D4CC
GO     #3A5A40   REVIEW #9A6B1F   NO_GO #7A2E2E   (muted, not traffic-light)
```
- Display/UI font: **Space Grotesk** (not Inter). Data font: **Geist Mono / JetBrains Mono**.
- **Signature rule:** every data-bearing element (HS codes, match scores, hashes, timestamps, snapshot IDs, country codes) renders in monospace.
- **Signature element:** the verdict readout as an instrument panel — verdict + three sub-check indicators (CLASSIFICATION / ENTITY / DESTINATION) + ruleset snapshot stamped in mono.
- Landing: marketing; hero leads with the verdict readout. Dashboard: New screening / History / Audit trail (the audit trail is the tamper-detection screen).

---

## 8. Build sequence (do in this order)

1. **Fix Vercel billing address** (the "Action Required" notice) — AWS provisioning needs a valid billing profile even on credit.
2. **Generate frontend in v0** (landing + dashboard, see v0-prompts.md). Iterate to the precision-instrument look.
3. **Pull v0 output into the Next.js repo**; wire up routing for the two pages.
4. **Deploy to a Vercel project** (so there's a project to attach the DB to).
5. **Provision Aurora PostgreSQL:** Vercel dashboard → Storage → **AWS** row (chevron) → Aurora PostgreSQL → **serverless** option → region (Tokyo `ap-northeast-1` or Mumbai `ap-south-1` closest to KL) → attach to the project. Env vars inject automatically. NO AWS console work.
6. **Local dev wiring:** `vercel link`, `vercel env pull` to get connection env vars locally.
7. **Define Drizzle schema** (`schema.ts`) per §3; generate + run the schema migration.
8. **Run the hand-written SQL migration** (§4.2) — pg_trgm, GIN index, REVOKE, trigger. (Can run via the Vercel dashboard Query tab or a migration runner.)
9. **Run the seed script** (§4.3) — curated CSL trim + synthetic HS/destination rules + 3 demo scenarios.
10. **Build the screening pipeline** (§5) as a Server Action / Route Handler; write the transaction with the hash-chain append (§6).
11. **Wire the frontend to the pipeline**; make the verdict readout and audit trail real.
12. **Test the tamper-detection demo:** seed → run a screening → alter an audit row via the Vercel Query tab → run verifier → confirm it pinpoints the break, marked in oxblood.
13. **Capture submission artifacts:** Vercel Storage Configuration screenshot (proves Aurora usage), the published Vercel URL + team ID, architecture diagram.

---

## 9. Cost / credit notes
- $100 AWS credit comes via the Vercel AWS account creation; usable up to ~6 months.
- Use **serverless Aurora** (scales to zero when idle) to protect the credit during build days.
- Anthropic API (classification) is a separate cost from the AWS credit — minimal at demo volume, but note it's not covered by the $100.

---

## 10. Deferred (NOT in the hackathon build — see architecture.md §9)
ECCN determination; Compliance Radar (per-product rule-change monitoring); FTA/rules-of-origin; duty calc; real ERP/shipping integrations; live scheduled CSL refresh; multi-user/RBAC; external notarization of the audit chain tip; full IaC via AWS CDK (TypeScript) if/when staging+prod environments are needed.
