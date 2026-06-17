# architecture.md

**Project:** CompliMesh
**Type:** Unified SMB-tier trade/export compliance engine
**Stack:** Next.js (Vercel) + Aurora PostgreSQL
**Status:** v1.1 — BUILD-READY (design system added)
**Last updated:** 2026-06-17

> Tagging convention: `[DECIDED]` = locked, `[OPEN]` = needs a call, `[DEFERRED]` = post-hackathon / v2.
> This is a living document. Nothing tagged `[OPEN]` should be built against yet.

---

## 0. North Star & Framing

### 0.1 The product in one sentence
**Name: CompliMesh** `[DECIDED]`. "Compli-" signals the compliance category instantly to the buyer; "mesh" encodes the core wedge — meshing together the three checks (classification + entity + destination) that competitors leave fragmented. Domains available across all TLDs; no software namesake (nearest is *Complinity*, a distinct India-focused GRC platform — different name, different lane; and *Trademo*, which we deliberately avoided colliding with). Not AI-named — derived from what it does, per the hackathon guidance.

**What it does (the positioning sentence judges will read):**
> A single tool that answers the question SMB exporters currently stitch from three tools plus a spreadsheet: *"Can THIS product go to THIS entity in THIS country, under current rules — and can I prove I checked?"*

### 0.2 The wedge `[DECIDED]`
The enterprise tier (SAP GTS, Oracle GTM, Descartes, E2open, Thomson Reuters) is locked up at $50k+/yr with multi-quarter implementations. The SMB tier is fragmented into **single-domain tools that don't talk to each other**:
- Entity/sanctions screening engines don't do product classification or destination control.
- Classification engines don't do sanctions screening.
- Destination-control logic lives in an out-of-date spreadsheet.

**Our wedge:** unify the three into one decision + one audit record, for the SMB exporter who can't afford enterprise GTS.

### 0.3 The one-sentence database justification (for the submission) `[DECIDED]`
> "We used Aurora PostgreSQL because a compliance decision is inherently relational and transactional — a product, an entity, a destination, and a ruleset resolve into a single screening verdict that must be written atomically and preserved as an immutable, queryable audit record."

This is the load-bearing answer. The DB is not decorative.

### 0.4 Buyer `[DECIDED]`
Primary: **SMB exporters / manufacturers** shipping cross-border without an enterprise compliance team. Secondary (DEFERRED): customs brokers/3PLs who'd resell.

### 0.5 Non-goals (critical for scope discipline) `[DECIDED]`
- NOT a customs-filing / ABI / entry-submission tool.
- NOT a duty/landed-cost calculator (v2 candidate).
- NOT the system of record for the shipment — we are the **decision + evidence** layer.
- NOT claiming to replace a licensed customs broker (see §6 liability framing).

---

## 1. Scope

### 1.1 Hackathon vertical slice `[DECIDED]`
Ship a convincing end-to-end slice, not a thin spread:

1. **Classification** — product description → candidate HS code(s) with a confidence signal.
2. **Entity screening** — counterparty name → match against restricted-party lists.
3. **ONE destination-control check** — given (HS code OR control classification, destination country, entity result), return a go / review / no-go verdict.
4. **Immutable audit log** — every decision above is written as a tamper-evident record with full provenance (inputs, ruleset version, verdict, timestamp).

The slice tells the *whole story* (the unified decision) while being buildable.

### 1.2 The "screening run" is the core object `[DECIDED]`
Everything orbits a **Screening Run**: one evaluation of (product + entity + destination) → one verdict + one audit record. This is the unit we demo, the unit we'd bill on, and the central table.

### 1.3 Explicitly deferred `[DEFERRED]`
- ECCN determination logic (deep; the real moat later).
- FTA / rules-of-origin qualification.
- Duty/tariff calculation.
- ERP/shipping integrations (SAP, QuickBooks, shipping APIs) — mocked for demo.
- "Compliance Radar" per-product monitoring/alerting on rule changes — this is a strong differentiator but a v2 build.
- Multi-user / org / RBAC beyond a single demo account.

---

## 2. Data Sources & The Moat Problem

### 2.1 Demo data strategy `[DECIDED]` — tiered hybrid (real where it exists, curated where it doesn't)

The real moat later is **maintained reference data**. For the slice, resolve per source tier — real official data where it's public and purpose-built, curated-synthetic where the real thing is unreproducible or a regulatory thicket:

**Restricted parties → REAL data, via a curated CSL snapshot.**
- Source: the US **Consolidated Screening List (CSL)** — the official Commerce/State/Treasury combined feed (SDN, BIS Entity List, Denied Persons, Unverified List), public, free, JSON, built explicitly to help industry screen parties to regulated transactions. Using it is the *intended* use, not a grey area.
- Approach: ingest a **curated trim** of the real CSL — real entries, but only the slice the demo scenarios hit, so the demo stays snappy and we don't ship thousands of unused rows. The data is genuinely real; we've just selected from it.
- **Snapshot, not live API** — and this is architecturally required, not a shortcut: the audit story depends on `ref_snapshots` recording "the rules as they stood on date X." A live call would break reproducibility (the verdict couldn't be re-derived later). So we snapshot CSL into `restricted_parties` with a `snapshot_id`. Live scheduled refresh is roadmap (§9).
- Bonus credibility: the CSL's own guidance mirrors our verdict model exactly — "if a party appears to match, conduct additional due diligence before proceeding; there may be a strict prohibition, a license requirement, or an end-use evaluation." That's our NO_GO / REVIEW distinction stated by the source of truth; quotable in the demo.

**HS classification reference → curated synthetic subset.**
- No clean public "description → HS code" dataset exists, and classification is genuinely hard. Build a small realistic table covering only the product categories the demo scenarios use.
- Honest by construction: positioning (§6) already frames classification as *assisted research, not an authoritative ruling* — a curated demo subset matches that posture.

**Destination-control rules → curated synthetic.**
- Real end-use/destination controls (EAR country chart, license exceptions) are a regulatory thicket. Author a small realistic rule set — a few country/HS-prefix combinations producing PROHIBITED / LICENSE_REQUIRED / ALLOWED — enough to drive the three demo verdicts. Faking the full EAR would be impossible and dishonest.

**The framing we say out loud (honest, doesn't overclaim):**
> "Entity screening runs against the real US Consolidated Screening List; classification and destination rules use a curated demo dataset. The production system extends these the same way it extends the party list — versioned snapshots refreshed from source."

This signals we know exactly where the real moat-data lives without claiming comprehensiveness.

### 2.2 Classification approach `[DECIDED]` — LLM + lookup hybrid
- LLM **proposes** candidate HS codes from the freeform product description.
- Each candidate is **validated** against the curated `hs_reference` table; only codes that exist survive.
- **Confidence** is high when an LLM proposal matches a table entry cleanly, low when it's reaching.
- Why this and not the alternatives: pure-LLM hallucinates HS codes confidently; pure-lookup can't parse freeform descriptions. The hybrid is also what makes the confidence number *mean something* — which is what feeds the `LOW_CONFIDENCE → REVIEW` rule (§4.3). Classification stays *assisted research*, never an authoritative ruling (§6).

### 2.3 Ruleset versioning `[DECIDED]`
Every reference dataset carries a **per-source snapshot id**. Snapshots are scoped by `source_type` ('RESTRICTED_PARTY' | 'HS' | 'DESTINATION_RULE') because real feeds update on different cadences (OFAC ≠ HS schedule ≠ control rules). Every Screening Run records **which snapshot of each source** it evaluated against — not one global version. This is what makes the audit log defensible ("we checked against the rules as they stood on date X") and is a stronger data-model signal. Cheap to build, huge for credibility.

---

## 3. Data Model (Aurora PostgreSQL)

> First-pass schema. All `[OPEN]` until we walk it together. Using Postgres features deliberately: FKs, constraints, JSONB for flexible rule payloads, an append-only audit pattern.

### 3.1 Core tables `[DECIDED]` (shape) / `[OPEN]` (final column tuning)

```
products
  id              uuid pk
  description     text not null          -- raw user input
  hs_code         text                   -- resolved/selected
  hs_confidence   numeric                -- 0..1, from classification
  created_at      timestamptz not null default now()

entities                                 -- counterparties being screened
  id              uuid pk
  name            text not null
  country         text
  created_at      timestamptz not null default now()

ref_snapshots                            -- PER-SOURCE version anchor
  id              uuid pk
  source_type     text not null          -- 'RESTRICTED_PARTY' | 'HS' | 'DESTINATION_RULE'
  label           text not null          -- e.g. 'OFAC SDN 2026-06'
  created_at      timestamptz not null default now()

restricted_parties                       -- reference data (versioned, fuzzy-matched)
  id              uuid pk
  list_source     text not null          -- e.g. 'OFAC_SDN', 'BIS_ENTITY'
  name            text not null
  aliases         jsonb                  -- alt names / transliterations
  country         text
  snapshot_id     uuid not null fk -> ref_snapshots
  -- pg_trgm GIN index on name (and alias expansion) for fuzzy similarity

hs_reference                             -- curated HS subset (versioned)
  id              uuid pk
  hs_code         text not null
  description     text not null
  control_flags   jsonb                  -- e.g. dual-use markers
  snapshot_id     uuid not null fk -> ref_snapshots

destination_rules                        -- product x destination logic (versioned)
  id              uuid pk
  hs_code_prefix  text                   -- PREFIX match (4–6 digit), not full code
  country         text not null
  rule_type       text not null          -- 'PROHIBITED' | 'LICENSE_REQUIRED' | 'ALLOWED'
  notes           text
  snapshot_id     uuid not null fk -> ref_snapshots

screening_runs                           -- THE core object
  id              uuid pk
  product_id      uuid fk -> products
  entity_id       uuid fk -> entities
  destination     text not null          -- country code
  rp_snapshot_id  uuid not null fk -> ref_snapshots   -- restricted-party rules used
  hs_snapshot_id  uuid not null fk -> ref_snapshots   -- HS rules used
  dr_snapshot_id  uuid not null fk -> ref_snapshots   -- destination rules used
  verdict         text not null          -- 'GO' | 'REVIEW' | 'NO_GO'
  created_at      timestamptz not null default now()
  -- verdict_reason is no longer a column: it's the aggregation of control_hits

control_hits                             -- RESOLUTION LAYER (Option C)
  id              uuid pk                -- every fired control, uniform shape
  run_id          uuid fk -> screening_runs
  source_type     text not null          -- 'RESTRICTED_PARTY' | 'DESTINATION_RULE' | 'CLASSIFICATION'
  source_ref_id   uuid                   -- fk into the originating ref table (nullable)
  dimension       text not null          -- what matched: 'ENTITY' | 'HS_COUNTRY' | 'CONFIDENCE'
  rule_type       text not null          -- 'PROHIBITED' | 'LICENSE_REQUIRED' | 'FUZZY_MATCH' | 'LOW_CONFIDENCE'
                                           --   PROHIBITED      = exact entity match OR destination PROHIBITED -> NO_GO
                                           --   FUZZY_MATCH     = confident/grey-zone fuzzy entity match -> REVIEW
                                           --   LICENSE_REQUIRED= destination license needed -> REVIEW
                                           --   LOW_CONFIDENCE  = classification below floor -> REVIEW
  match_score     numeric                -- pg_trgm similarity or classification confidence where relevant
  reason          text not null          -- human-readable, drives the audit log + UI
  snapshot_id     uuid fk -> ref_snapshots

audit_log                                -- append-only + hash-chained (tamper-evident)
  id              uuid pk
  run_id          uuid fk -> screening_runs
  seq             bigserial not null      -- strict chain order (single global chain)
  event_type      text not null          -- 'RUN_CREATED','CLASSIFY','SCREEN','RESOLVE','VERDICT'
  payload         jsonb not null         -- full input + output snapshot
  prev_hash       char(64) not null       -- hex SHA-256 of previous row; genesis = 64x'0'
  row_hash        char(64) not null       -- SHA-256(prev_hash || canonical(payload) || run_id || event_type || created_at)
  created_at      timestamptz not null default now()
  -- append-only enforced two ways (see 3.3): REVOKE UPDATE/DELETE + trigger,
  -- AND hash-chain for tamper-EVIDENCE even against direct DB edits
```

**Note on `control_hits` (Option C, the resolution layer):** reference data *enters* in source-shaped tables (`restricted_parties`, `destination_rules`) — honest to where each feed comes from, clean ingestion. But every screening run *resolves* those into a uniform set of `control_hits` rows. The verdict is an aggregation over hits; the audit log records hits, not raw two-table queries. This is what makes "why was this blocked?" a single-query, provable answer forever — the exact thing single-domain competitors can't show. A run with zero hits = GO.

### 3.2 Why this shape is "deliberate" (judging point) `[DECIDED]`
- **FKs + constraints** enforce that a verdict can't exist without its inputs — relational integrity is the point.
- **Per-source versioned reference data** (`snapshot_id` per source) means every verdict is reproducible against the exact rules used, and sources version independently like real feeds.
- **`pg_trgm` trigram similarity** for fuzzy entity matching — the *correct* Postgres tool for "Huawei Technologies" vs "Huawei Tech Co Ltd" vs transliterated aliases. Not just relational — similarity search done right.
- **`control_hits` resolution layer** — source-shaped ingestion, uniform evaluation. Makes "why was this blocked?" a single-query, provable answer.
- **JSONB** for `control_flags` / audit `payload` — flexible structured detail without exploding the schema.
- **Append-only + hash-chained `audit_log`** — the compliance evidence layer single-domain competitors don't have. Database-enforced append-only *and* tamper-evident.

### 3.3 Immutability mechanism `[DECIDED]` — Option B + C together

The slice does **both** layers; they defend different threats and combine into one strong claim:
> "The application physically cannot alter the audit log, and even direct database tampering is mathematically detectable."

**Layer B — database-enforced append-only (prevention):**
- `REVOKE UPDATE, DELETE ON audit_log` from the application role.
- A `BEFORE UPDATE OR DELETE` trigger on `audit_log` that raises an exception.
- Defends against: the app's own buggy/compromised code corrupting the chain.

**Layer C — hash-chained records (tamper-evidence):**
- Each row stores `prev_hash` (the prior row's `row_hash`) and its own `row_hash`.
- `row_hash = SHA-256(prev_hash || canonical(payload) || run_id || event_type || created_at)`.
- Genesis row uses a fixed sentinel `prev_hash` of 64 zeros.
- Altering any historical row breaks its hash and every subsequent hash; a verifier pinpoints the first break.
- Defends against: tampering that bypasses the app (direct SQL), which Layer B can't catch.

**Load-bearing implementation rules (easy to get wrong, painful to retrofit):**
1. **Deterministic canonical serialization.** The hashed content must serialize byte-identically on recompute. Do NOT hash raw JSONB (key order isn't guaranteed). Define a canonical form: sorted keys, explicit field order, text representation of every value; hash that. This is the #1 way hash-chains silently break.
2. **Serialized appends.** Computing `prev_hash` requires reading the current chain tip; concurrent appends can race and fork the chain. The audit append must lock the chain tip (row lock on the latest `seq`) while computing the new hash. Couples with the single pipeline transaction (§4.2 step 6) — the audit write specifically locks the tip.
3. **Single global chain** ordered by `seq` (bigserial). (A per-run chain is possible but a single chain is simpler to verify and demo.)

**Verification path (the thing we actually demo):**
- A `verify_audit_chain()` read function walks rows by `seq`, recomputes each `row_hash`, and returns the first `seq` where recomputed ≠ stored (or "intact").
- Demo: write records → tamper with one row via direct SQL → run verifier → it pinpoints the exact break. ~20s of compelling video that judges can't get from a README.

**Honest scope of the claim (state precisely; don't overclaim to expert judges):**
- This is tamper-**evidence** against any *single-record* alteration, plus app-level tamper-**prevention**.
- It does NOT defend against a DB owner rewriting the *entire* chain from genesis — the only defense there is anchoring a periodic chain-tip hash **externally** (somewhere we don't control). That external notarization is `[DEFERRED]` to v2 and must be named as roadmap, not claimed as present.

---

## 4. Application Architecture

### 4.1 Shape `[OPEN]`
- Next.js App Router on Vercel.
- Server Actions / Route Handlers for the screening pipeline.
- Aurora PostgreSQL via the Vercel-AWS native integration (env vars auto-injected).
- **ORM/driver: Drizzle** `[DECIDED]`. SQL-first — queries read like SQL with type safety on top, matching the "deliberate SQL" story (the `pg_trgm` query, the in-transaction multi-table write, the hash-chain append). Prisma abstracts the SQL away (works against us when a judge asks to see the atomic commit); raw `pg` is more boilerplate than needed.
  - **Caveat (bank this):** the Postgres-specific machinery is **hand-written SQL migrations**, not Drizzle-generated — `CREATE EXTENSION pg_trgm`, the GIN index, the `REVOKE UPDATE/DELETE`, and the append-only trigger function. So migrations = Drizzle-managed schema + a few hand-written SQL files. Normal, and itself a demonstration of deliberate Postgres use.

### 4.2 The screening pipeline `[DECIDED]` (logic) / `[OPEN]` (impl detail)
```
POST screening run
  1. CLASSIFY    product.description -> hs_code + confidence   (LLM+lookup, §2.2)
  2. SCREEN      entity.name -> pg_trgm fuzzy match vs restricted_parties (current snapshot)
  3. DESTINATION resolve destination_rules(hs_prefix, country)
  4. RESOLVE     emit control_hits for every fired control (entity match, dest rule, low confidence)
  5. VERDICT     aggregate hits -> GO (zero hits) / REVIEW / NO_GO + structured reason
  6. PERSIST     write run + control_hits + audit_log rows in ONE transaction
```
Step 6 atomicity is the Postgres-transaction showcase: the verdict and its evidence commit together or not at all.

### 4.3 Verdict logic & thresholds `[DECIDED]`

**Governing principle — asymmetric, review-biased.** False negative (clear something that should stop) = potential sanctions violation, catastrophic. False positive (flag something fine) = friction, safe. So every threshold tilts toward REVIEW, never toward GO. **GO is rare and earned**, not a default. A tool that says GO easily is dangerous.

**Knob 1 — entity fuzzy-match bands (`pg_trgm` similarity 0..1):**
- `> 0.6` → confident fuzzy match
- `0.3 – 0.6` → grey zone (possible match, human must look)
- `< 0.3` → clean, no hit
- Starting values; tune against real CSL data. Apply **name normalization** (strip corporate suffixes — "Co", "Ltd", "Trading", "International" — before scoring) because short company names inflate trigram similarity on common words.

**Knob 2 — a fuzzy match never auto-prohibits.** A confident *fuzzy* match is not a confident *identity* match ("Smith Trading" ≈ SDN "Smith Trading" may be a different company). Per liability framing (§6), the tool never makes the prohibition call on a name guess:
- Hard `NO_GO` is reserved for an **exact normalized entity match** OR a destination rule = `PROHIBITED`.
- A **confident fuzzy** entity match → `REVIEW` with a strong flag, not auto-`NO_GO`.

**Knob 3 — classification confidence floor (~0.5–0.6).** A low-confidence HS code means we may have looked up the *wrong* destination rules. So below the floor, emit a `LOW_CONFIDENCE` hit → `REVIEW`, regardless of the destination lookup. Framing: "we're not confident enough about *what this product is* to tell you whether it can ship."

**Verdict precedence (worst hit wins, NO_GO > REVIEW > GO):**

| Condition | Verdict |
|---|---|
| Exact normalized entity match to a list, OR destination rule = `PROHIBITED` | **NO_GO** |
| Confident fuzzy entity match (> 0.6) | **REVIEW** (strong flag) |
| Grey-zone fuzzy entity match (0.3–0.6) | **REVIEW** |
| Destination rule = `LICENSE_REQUIRED` | **REVIEW** |
| Classification confidence below floor | **REVIEW** |
| None of the above | **GO** |

`[OPEN]` Exact numeric values (0.3 / 0.6 / 0.5) are starting points to tune against demo data — the *philosophy* (asymmetric, review-biased, GO-earned) is locked.

### 4.4 AI usage & key strategy `[DECIDED]`
- **Where AI is used:** classification assist only (§2.2) — propose-then-validate. Optionally a low-risk "explain this verdict in plain English" generator over the structured hits (explains, never decides).
- **Demo:** single **hosted key** in a Vercel server-side env var. Simple, no user friction, the classification call runs in a Route Handler / Server Action.
- **Product direction: hosted-and-priced-in, NOT BYOK** (a deliberate departure from the usual BYOK pattern). The buyer is a non-technical SMB compliance person, not a developer — "go get an API key and paste it in" is friction they won't tolerate, and a compliance buyer wants a vendor who *owns the stack and stands behind the output*, not a BYOK arrangement that says "the AI part is your problem." The model cost is a per-screening-run cost-of-goods, which folds cleanly into the subscription + per-run metering pricing (§9).

---

## 5. Frontend / UX & Design System `[DECIDED]`

Judges score "does the frontend feel coherent with the backend." The UI makes the *unified decision* obvious — the thing competitors can't show. Direction avoids the generic blue-grey compliance-dashboard default.

### 5.1 Design thesis
**Precision instrument** — calm, exact, technical, like a serious measuring tool, not a status dashboard. The product's real subject is *certainty you can defend*. The verdict is treated like a readout on a well-made instrument, not a colored badge on a card.

### 5.2 Design tokens
**Palette (instrument, not dashboard):**
- `--base` warm off-white `#F2F0EB` (not stark white — stark white reads cheap)
- `--ink` deep near-black `#161719` (text + structure)
- `--accent` deep slate-teal `#1F4E4A` (single disciplined accent — technical, not SaaS-blue)
- `--muted` `#6B6E73` (secondary text, labels)
- `--hairline` `#D8D4CC` (rules, dividers)
- Verdict colors — **muted/sophisticated, legible but not loud** (instrument readouts, not traffic lights):
  - GO → desaturated forest `#3A5A40`
  - REVIEW → dark ochre `#9A6B1F`
  - NO_GO → deep oxblood `#7A2E2E`

**Typography (exact carries the personality):**
- Display/UI: a technical grotesk (NOT Inter — the SaaS default). Candidates: Suisse Int'l feel, or a free analog like Space Grotesk / Geist.
- **Data/mono:** all data-bearing elements render in monospace — HS codes, match scores, audit hashes, timestamps, snapshot IDs. This is the **signature**: it makes screening data look like precise machine output, and makes the hash-chain visually legible as a chain.

### 5.3 Signature element
The **verdict readout** as an instrument panel: when a screening resolves, GO/REVIEW/NO_GO appears as a weighted, precise readout, with the three sub-checks (classification, entity, destination) as discrete instrument-like indicators beneath, and the ruleset snapshot stamped in mono like a serial number. Calm, exact, certain.

### 5.4 Key screens
- **Landing (marketing):** precision-instrument aesthetic; hero leads with the verdict-readout concept, not a generic dashboard screenshot. Communicates the wedge (one tool, three checks, provable) to an SMB compliance buyer.
- **Dashboard / screening screen:** enter product description + counterparty + destination → the verdict readout, with the three sub-checks expandable beneath (each showing its control_hits).
- **Audit trail view:** run history as a monospace append-only ledger — row after row with hashes, visually reinforcing immutability. This is the tamper-detection demo screen, designed to make a broken hash *visible*.
- Ruleset snapshot shown on the verdict readout (the credibility detail) — `[DECIDED]` yes.

### 5.5 Build structure `[DECIDED]`
Two separate pages: marketing landing + a separate app dashboard. Generated via v0.

---

## 6. Liability & Positioning `[DECIDED]`

Non-negotiable framing, in-product and in the demo:
- Output is **"compliance research / decision support,"** NOT a final classification or legal determination.
- A `REVIEW`/`NO_GO` says "stop and consult" — we never green-light a borderline call silently.
- This posture is both ethically correct and the industry-standard legal shield (mirrors how a serious competitor positions classification as "research support for a licensed customs broker").

---

## 7. Demo / Submission Plan `[OPEN]`

- **Video (<3 min):** show the unified screening run end-to-end → land on the audit trail → **show the tamper-detection moment** (alter an audit row via direct SQL, run the verifier, watch it pinpoint the break) → state the one-sentence DB justification (§0.3). Don't read the README aloud. The tamper-detection demo is the visual centerpiece judges can't get from a README.
- `[OPEN]` Seed a few scripted scenarios: one clean GO, one sanctioned-entity NO_GO, one license-required REVIEW — so the demo shows all three verdicts.
- **Bonus content (+0.6):** a "how I built a unified trade-compliance engine on Aurora + Vercel" build-log post before the deadline, #H0Hackathon. Nearly free points and it doubles as launch marketing.
- `[OPEN]` Screenshot of AWS/Vercel storage config proving Aurora usage (required artifact).

---

## 8. Open Decisions Queue (resolve top-down)

**Resolved since v0.1:**
- ✅ Per-source snapshots (not global) — §2.3
- ✅ HS prefix matching for destination rules — §3.1
- ✅ Entity vs product/destination restrictions → **Option C** resolution layer (`control_hits`) — §3
- ✅ `pg_trgm` for fuzzy entity matching — §3.2
- ✅ Audit immutability → **B + C together**: DB-enforced append-only + hash-chained tamper-evidence; external anchoring deferred to v2 — §3.3
- ✅ Demo data → **tiered hybrid**: real CSL snapshot (curated trim) for restricted parties, curated-synthetic for HS + destination rules — §2.1
- ✅ Verdict thresholds → **asymmetric, review-biased**: fuzzy bands 0.3/0.6, confidence floor ~0.5–0.6, fuzzy match never auto-prohibits, GO is earned — §4.3
- ✅ Classification → **LLM + lookup hybrid** (propose-then-validate) — §2.2
- ✅ ORM/driver → **Drizzle** + hand-written SQL migrations for Postgres machinery — §4.1
- ✅ AI key → **hosted for demo; hosted-and-priced-in (not BYOK) as product direction** — §4.4
- ✅ Name → **CompliMesh** (domains clear, no namesake collision) — §0.1

**All architecture decisions resolved.** Document moves from negotiation to build-ready. Remaining `[OPEN]` tags are calibration-against-data items (exact threshold numbers) and lighter UX choices (§5), not blocking decisions.

---

## 9. Post-Hackathon / v2 `[DEFERRED]`
- ECCN determination engine (the deep moat).
- Compliance Radar: per-product monitoring against live rule changes (vendor whitespace we identified).
- FTA / rules-of-origin, duty calculation.
- Real ERP/shipping integrations (SAP GTS-adjacent, QuickBooks, carriers).
- **Live reference-data refresh:** scheduled snapshotting from source feeds — CSL API (hourly-updated), HS schedule, control rules — each landing as a new versioned `ref_snapshot`. (Slice uses a single curated CSL snapshot; this revisits ingestion as a recurring pipeline — see §2.1.)
- Multi-user orgs, RBAC.
- **External notarization** of periodic audit chain-tip hashes (anchor to a store we don't control) — upgrades tamper-evidence to defend against full-chain rewrite (§3.3).
- Pricing model (subscription + per-screening-run metering is the natural shape).
