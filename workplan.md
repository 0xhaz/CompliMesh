# workplan.md — CompliMesh

**Derived from:** [architecture-complimesh.md](architecture-complimesh.md) + [techstack-complimesh.md](techstack-complimesh.md)
**Goal:** Ship a convincing end-to-end vertical slice — one unified screening run (classify → screen → destination) → one verdict (GO / REVIEW / NO_GO) → one tamper-evident audit record — on Next.js + Aurora PostgreSQL.
**Status:** planning → build.

> The whole story in one line: *"Can THIS product go to THIS entity in THIS country under current rules — and can I prove I checked?"* The demo centerpiece is the **tamper-detection moment** on the audit trail.

---

## 0. Current state (what we already have)

- **Markdown specs** — architecture + techstack, both build-ready.
- **Frontend template** — `compli-mesh-marketing-page/` — a v0-generated Next.js 16 app (App Router, React 19, Tailwind v4, shadcn/base-ui). Already branded "CompliMesh", correct fonts (Space Grotesk + Geist Mono), precision-instrument design tokens, and both screens scaffolded:
  - Landing: [app/page.tsx](compli-mesh-marketing-page/app/page.tsx)
  - Dashboard: [app/dashboard/page.tsx](compli-mesh-marketing-page/app/dashboard/page.tsx) → new-screening / history / audit-trail views.
  - **Caveat:** [lib/screening.ts](compli-mesh-marketing-page/lib/screening.ts) and [lib/audit.ts](compli-mesh-marketing-page/lib/audit.ts) are **client-side mocks** (hardcoded scenarios, FNV-1a hash). These get replaced by the real `core/` logic + a real SHA-256 DB-backed chain.
- **Not yet started:** the backend — DB, schema, migrations, seed, screening pipeline, real audit chain, AI classification.

---

## Phase 0 — Prep & rename (before we start)

- [x] **Rename template to techstack layout** (§2.1). Done: promoted app to repo root; `package.json` name → `complimesh`; `lib/screening.ts` → `core/screening/index.ts`, `lib/audit.ts` → `core/audit/index.ts` (imports rewritten `@/lib/*` → `@/core/*`); scaffolded `core/{schema,types}`, `migrations/{drizzle,sql}`, `scripts/`. `lib/utils.ts` (the `cn()` shadcn helper) stays app-side.
- [ ] Confirm Node/pnpm toolchain; `pnpm install` runs clean.
- [ ] **Fix Vercel billing address** (the "Action Required" notice) — AWS provisioning needs a valid billing profile even on credit. (techstack §8.1)

## Phase 1 — Infra & DB provisioning

- [ ] Deploy template to a **Vercel project** (so there's a project to attach the DB to). (techstack §8.4)
- [ ] **Provision Aurora PostgreSQL (serverless)** via Vercel dashboard → Storage → AWS → Aurora PostgreSQL → serverless → region (Tokyo `ap-northeast-1` or Mumbai `ap-south-1`, closest to KL) → attach to project. Env vars inject automatically; no AWS console work. (techstack §8.5)
- [ ] **Local dev wiring:** `vercel link`, `vercel env pull`. Connection uses OIDC + RDS IAM (short-lived tokens) — never hardcode credentials. (techstack §1 hard rule, §8.6)

## Phase 2 — Schema & migrations

- [ ] **Drizzle schema** (`core/schema/schema.ts`) per architecture §3.1 / techstack §3: `products`, `entities`, `ref_snapshots`, `restricted_parties`, `hs_reference`, `destination_rules`, `screening_runs`, `control_hits`, `audit_log`. Preserve: 3 snapshot FKs on every run; verdict = aggregation over `control_hits`; audit_log append-only + hash-chained.
- [ ] Generate + run the Drizzle schema migration → `migrations/drizzle/`.
- [ ] **Hand-written SQL migration** `migrations/sql/0001_postgres_machinery.sql` (techstack §4.2): `CREATE EXTENSION pg_trgm`, GIN trigram index on `restricted_parties.name`, `REVOKE UPDATE,DELETE ON audit_log`, the `audit_log_immutable()` trigger.

## Phase 3 — Seed data (tiered hybrid, architecture §2.1)

- [ ] **`scripts/seed.ts`** (deterministic, rebuildable to known state):
  - Curated **trim of the real US Consolidated Screening List (CSL)** → `restricted_parties` under one `RESTRICTED_PARTY` snapshot (real entries, only those the demo hits).
  - Curated synthetic `hs_reference` subset (only demo product categories) under an `HS` snapshot.
  - Curated synthetic `destination_rules` (country/HS-prefix combos producing all three rule_types) under a `DESTINATION_RULE` snapshot.
  - The **3 scripted scenarios**: clean GO, sanctioned-entity NO_GO, license-required REVIEW.

## Phase 4 — Core screening pipeline (`core/screening/`, framework-agnostic)

- [ ] Keep `core/` framework-agnostic (techstack §2.2): no React/Next imports; `app/` imports `core/`, never the reverse.
- [ ] **Pipeline** (architecture §4.2 / techstack §5), one run = one transaction:
  1. CLASSIFY — description → Anthropic proposes HS candidates → **validate against `hs_reference`** → hs_code + confidence (propose-then-validate, architecture §2.2).
  2. SCREEN — entity name → **normalize** (strip corp suffixes) → `pg_trgm` similarity vs `restricted_parties` (current RP snapshot).
  3. DESTINATION — resolve `destination_rules(hs_prefix, country)` on current DR snapshot.
  4. RESOLVE — emit `control_hits` for every fired control.
  5. VERDICT — aggregate hits, worst wins: any PROHIBITED → NO_GO; any FUZZY_MATCH/LICENSE_REQUIRED/LOW_CONFIDENCE → REVIEW; zero hits → GO.
  6. PERSIST — write `screening_run` + `control_hits` + `audit_log` row(s) in **ONE transaction**; audit append locks the chain tip.
- [ ] **Verdict thresholds** (architecture §4.3, philosophy locked / numbers tunable): pg_trgm clean `<0.3`, grey `0.3–0.6`, confident `>0.6`; confidence floor `~0.5–0.6`; **a fuzzy match never auto-prohibits** — hard NO_GO only for exact normalized match or destination PROHIBITED. Asymmetric, review-biased: GO is earned.

## Phase 5 — Hash-chained audit log (`core/audit/`, the demo centerpiece)

- [ ] **Real SHA-256 chain** (architecture §3.3 / techstack §6), replacing the template's FNV-1a mock:
  - Deterministic **canonical serialization** (sorted keys, fixed field order, text repr) — do NOT hash raw JSONB.
  - `row_hash = SHA-256(prev_hash || canonical(payload) || run_id || event_type || created_at)`; genesis prev_hash = 64 zeros.
  - **Serialized appends** — lock the chain tip inside the screening transaction.
  - Single global chain ordered by `seq` (bigserial).
- [ ] **`verifyAuditChain()`** read function — walks by `seq`, recomputes each hash, returns first broken `seq` (or "intact"). Powers the "Verify chain" UI action.

## Phase 6 — Wire frontend to the real backend

- [ ] Replace mock `lib/screening.ts` / `lib/audit.ts` calls with Server Actions / Route Handlers that call into `core/`.
- [ ] Make the **verdict readout** real (verdict + 3 sub-check indicators + ruleset snapshot in mono).
- [ ] Make the **audit trail** real — monospace append-only ledger; broken hash rendered in oxblood (`#7A2E2E`).
- [ ] Surface the **liability framing** in-product (architecture §6): decision support, not a legal determination; REVIEW/NO_GO = stop and consult.

## Phase 7 — Demo & submission

- [ ] **Tamper-detection demo:** seed → run a screening → alter an audit row via the Vercel Query tab → run verifier → it pinpoints the break (oxblood). (techstack §8.12)
- [ ] **Video (<3 min):** unified run end-to-end → audit trail → tamper-detection moment → state the one-sentence DB justification (architecture §0.3). Don't read the README.
- [ ] Seed all three verdicts so the demo shows GO + NO_GO + REVIEW.
- [ ] **Submission artifacts:** Vercel Storage Configuration screenshot (proves Aurora), published Vercel URL + team ID, architecture diagram. (techstack §8.13)
- [ ] **Bonus (+0.6):** "how I built a unified trade-compliance engine on Aurora + Vercel" build-log post before deadline, #H0Hackathon.

---

## Explicitly deferred (NOT in this build — architecture §9 / techstack §10)

ECCN determination engine · Compliance Radar (per-product rule-change monitoring) · FTA / rules-of-origin · duty calc · real ERP/shipping integrations · live scheduled CSL refresh · multi-user / org / RBAC · external notarization of the audit chain tip · full IaC (AWS CDK).

---

## Risks / watch-items

- **Hash chain silently breaking** — #1 cause is non-deterministic serialization. Lock the canonical form early; test recompute == stored before building UI on it.
- **trgm similarity on short names** — corporate suffixes ("Co", "Ltd", "Trading") inflate similarity; normalize before scoring.
- **Vercel↔Aurora auth** — OIDC/IAM short-lived tokens, not a connection string. Don't fight it; use injected env vars.
- **Anthropic cost** — not covered by the $100 AWS credit; minimal at demo volume but note it.
- **Scope creep** — the slice tells the *whole* story; resist building deferred items. GO is rare and earned.

## Build order (techstack §8, condensed)

Billing fix → v0 frontend (have it) → deploy to Vercel → provision Aurora → local env pull → Drizzle schema → SQL machinery migration → seed → pipeline + hash chain → wire frontend → tamper test → capture artifacts.
