# Chikitsa — Evidence-aware healthcare prioritization

**Status:** approved design (2026-06-15), reconciled against `7960b48` (2026-06-15)
**Author:** brainstormed with Claude Opus 4.7 in session
**Scope:** single comprehensive design spec for the Chikitsa hackathon MVP and immediate post-hackathon path
**Companion:** `IMPLEMENTATION_PLAN.md` (commit `1a8b397`) is the execution-ordered work breakdown derived from this design

---

## 0. Implementation status snapshot (as of `7960b48`)

This snapshot exists so a reader doesn't waste time on what's already built. Pipeline, validation, and architecture phases land continuously; this captures the state at the time the spec was reconciled.

**Built and matches spec**

- DQ patch in `pipeline/facilities_curated.sql` (state recovery via PIN-directory longest-match, `state_key_quality` and `facility_row_quality` flags).
- Trust components 1–5 (`t_facility_presence`, `t_geocoding`, `t_pin_unambiguous`, `t_flagged_inverse`, `t_indicator_quality`) in `pipeline/district_planning_signals.sql` and the Lakebase-Postgres twin at `chikitsa-copilot/sql/lakebase_district_planning_signals.sql`.
- Action class CASE expression (with one threshold change from spec; see §11.1).
- `/api/map/state/:state_key/{districts,coverage,facilities}` endpoints in `chikitsa-copilot/server/routes/chikitsa-routes.ts`.
- `/api/quality/contamination` endpoint.
- State-key validation via `parseStateKey` regex.
- 36 per-state district-boundary GeoJSON files at `client/public/state-district-boundaries/{state_key}.json`.
- `client/src/components/DistrictStateMap.tsx` (reusable per-state choropleth).
- State drill mode in `IndiaMapPage` (`mode: 'india' | 'state'` with parallel fetches).
- DQ files `pipeline/dq_checks.sql` and `pipeline/dq_expectations.sql`.
- `queryWithFallback` pattern for degraded reads (see §9).
- `/api/location-options` endpoint for state and district filter dropdowns.

**Not yet built (priority order)**

1. WorldPop population grid (`build_population_grid.py` and `population_grid_h3` Delta).
2. Real `desert_grid` geometry that joins `facility_coverage_h3` × `population_grid_h3` (today's `desert_grid.sql` is a one-row-per-district stub).
3. Service taxonomy (`pipeline/service_taxonomy.yaml`), `facility_services.sql`, per-service `is_covered_<service>` columns, demand-weighted blend.
4. LLM long-tail state recovery (`scripts/llm_state_recovery.py`).
5. Two-pass website evidence pipeline (`scripts/website_check.ts`, `chikitsa_app.facility_website_evidence`, the new trust components `t_website_corroboration`, `t_operator_concordance`, `t_service_evidence`).
6. Agentic copilot loop with 8 tools (today's `/api/copilot/analyze` is single-shot with a richer prompt — see §6 for what changes).
7. Enrichments (RHS, Census 2011, NITI ADP) and the `t_official_concordance` component.
8. ROI estimator `pipeline/intervention_roi.sql` and the `draft_intervention` agent tool.
9. BriefPage as the front door (today's landing is OverviewPage; route at `/` is unchanged).
10. Reliability-framing rename in UI labels and copilot system prompt.
11. Marketplace Delta share.

**Decisions that drifted from earlier conversation but stay in scope**

- Google Places: a `chikitsa_app.facility_external_match` table and `/api/copilot/reviews` endpoint shipped as a stub, returning empty reviews. Section 4.4 had said drop Google entirely; this spec now keeps the *schema and endpoint* as **deferred / stretch** so nothing has to be ripped out, with no enrichment script committed for the MVP. Live reviews are out of MVP scope.

**Design choices the commit got right that the spec didn't anticipate**

- **`queryWithFallback` pattern**: server-side dual-SQL with the inline `DISTRICT_RANKING_SQL` as a fallback when the materialized view isn't synced. Now part of §9.
- **Dual SQL location**: `pipeline/*.sql` for Databricks materialized views and `chikitsa-copilot/sql/lakebase_*.sql` for Postgres-flavor views (no `CREATE OR REFRESH MATERIALIZED VIEW`, explicit `::DOUBLE PRECISION` casts). Documented in §4.
- **`/api/location-options`**: state + district vocabulary for the UI filter dropdowns; sourced from `district_health_profiles`. Added to §5.1.

---

## 1. Context and problem

Indian public-health planners — state directorates, NHM, district CMOs — decide where to build, upgrade, or verify healthcare facilities using registries that are incomplete and inconsistent. When a district shows few facilities, the planner cannot tell whether the district *has* few facilities or whether the data merely *records* few of them. Both cases get the same prescription today: "build more." Sometimes that is right; often it is capital sunk in a district that is actually fine, while a genuinely underserved one nearby is missed because its data happened to be cleaner.

Existing healthcare-coverage maps answer "where is need highest?" Chikitsa answers the question that has to come first: **"where can we trust the answer?"** Each district receives an action class (Build, Verify, Upgrade, Improve access, Investigate) backed by FDR pipeline lineage and external corroboration that a planner can defend in a budget meeting.

This spec turns that thesis into an implementable system: a national pipeline, an agentic copilot, a service-aware geographic-desert map, deliberately sampled external evidence, and an honest data-reliability composite (not "trust" — see §1.3).

### 1.1 Existing state at design time

The repo already has:

- A medallion pipeline of three SQL views (`pipeline/facilities_curated.sql`, `pipeline/pincode_geography.sql`, `pipeline/district_health_profiles.sql`) producing 10,077 facility rows, 19,586 unique PINs, and 706 NFHS-5 district rows in Lakebase.
- A React + Express app (`chikitsa-copilot/`) with five pages (Brief, Map, Evidence, Actions, Copilot) and a working ECharts state-level India choropleth at `/map` driven by `/api/map/india`.
- An inline `DISTRICT_RANKING_SQL` in `server/routes/chikitsa-routes.ts` computing today's `evidence_trust_score`, `desert_score`, and `recommended_action`.
- Authoritative product framing in `AGENTS.md` and `HACKATHON_CONCEPT.md`: planner-facing, evidence-aware, action-classified, no political claims, no clinical advice, "Evidence Confidence" not "trust."

### 1.2 What probing the live data revealed

Connecting to Lakebase via the Databricks Postgres OAuth flow uncovered:

- **88 column-shift rows (~0.87%)**: `facility_id` carries text fragments instead of UUIDs; downstream columns are scrambled (`name` holds JSON specialty arrays; `state_or_region` holds GeoJSON Points; `country` holds latitudes; `pincode` holds longitudes with the decimal stripped). The FDR GenAI extraction emitted these off by N positions and the silver layer's per-column cleaning passes did not catch the structural issue.
- **2,349 address-as-state rows (~23%)**: valid UUIDs but `state_or_region` carries a full address (e.g. `"Pallikulam, Post Chirakkal, Kannur District, Kerala"`) instead of the bare state name. Today's `state_key = LOWER(TRIM(...))` produces dirty join keys; queries silently drop these rows.
- **`completeness_score` is uninformative**: 9,959 of 10,077 facilities (98.8%) score 7/7. The score does not vary, so it cannot rank or distinguish; it cannot function as a trust component.
- **The registry is structurally a private-clinic catalog**: Bihar shows 214 private vs. 18 public facilities, no PHCs/CHCs/sub-centers, and Patna alone holds 56% of Bihar's coverage. Districts like Saharsa, Katihar, Kishanganj, Purnia, Jehanabad — Aspirational Districts in NITI's own list — have ≤5 entries each. This is the literal "data desert" the demo wants to surface.
- **Bihar happens to be clean** (258/258 valid rows), which makes it the right demo opener. The contamination concentrates in Kerala, Tamil Nadu, and a long tail of states with verbose source addresses. Bihar is *not* the project's scope; the system handles any state.

### 1.3 Framing: reliability, not trust

The composite this system ships measures whether the *dataset describing supply* is reliable enough to act on. It does not measure patient trust (that is the Ozawa & Sripad survey-based literature, which we cannot derive from FDR), institutional trust (Edelman / Wellcome territory), or facility-quality trust (clinical outcomes, not in our data).

UI labels read **"evidence reliability"** or **"reliability adjustment."** The DB column stays `evidence_trust_score` for backward compatibility with existing routes and dashboards. The copilot's system prompt forbids the words "trust" and "trustworthy" in user-facing answers and requires the model to use "reliability" or "verifiable."

---

## 2. Goals, non-goals, success criteria

### 2.1 Goals

1. Separate real healthcare deserts from data deserts, with **defensible per-district reliability scoring** built only from signals that vary across districts.
2. Encode "desert" as **physical-space geometry** (H3 hex coverage around facilities) — not as district color — so the metric is honest about catchment access rather than smuggling administrative boundaries into the answer.
3. Differentiate deserts by **service category** (maternal, child health, NCD, etc.) so a district covered by dental clinics is correctly flagged as a maternal-care desert when NFHS shows maternal-care need.
4. Produce a **prioritized national queue** ranked by composite ROI (geometric mean of access and utilization gain, equity-weighted, reliability-discounted) so planners see "where to look first" before they see "where need is high."
5. Run an **agentic copilot** with a small fixed tool surface that explains, compares, and drafts interventions. The agent's reasoning trace is visible to the user; the agent never executes SQL.
6. Make the system **state-agnostic at the code level** while using Bihar as the demo opener.
7. Surface FDR data quality issues **honestly and visibly**, not silently.
8. Ship a **Databricks Marketplace data product** (gold-layer Delta share) alongside the app.

### 2.2 Non-goals

- We do not measure public trust in health facilities or institutions.
- We do not provide clinical advice or individual treatment recommendations.
- We do not claim political causation.
- We do not produce travel-time isochrones (no road graph) — buffers are Euclidean and labeled as such.
- We do not persist Google review content. Google review *summarization* is out of MVP scope; the Place Details schema and stub `/api/copilot/reviews` endpoint that already shipped are retained as a deferred path (§4.4 + §5.4) with no enrichment script committed.
- We do not attempt machine-learning column-position recovery for the 88 column-shift rows; we quarantine them.

### 2.3 Success criteria for the hackathon demo

- BriefPage opens in <2s with a national priority queue whose top-10 includes ≥3 NITI Aspirational Districts (corroboration with the government's own list).
- Map drill from India to Bihar to a district takes <3s end to end on cold cache.
- Reliability toggle visibly grows the desert hexes for at least 3 districts in Bihar (Saharsa, Kishanganj, Jehanabad).
- The copilot answers "what should the government investigate first in Bihar?" in <8s with a reasoning trace showing 1–2 tool calls and an action class cited from deterministic SQL.
- The methodology page is reachable from any user-facing reliability number in one click.
- The 4-minute demo dry-run completes twice from cold cache without manual rescue.

---

## 3. System architecture

```
External sources
  ├── UC: databricks_virtue_foundation_dataset_dais_2026.virtue_foundation
  │   ├── facilities (10,077 rows; FDR GenAI-extracted)
  │   ├── india_post_pincode_directory (~165k rows)
  │   └── nfhs_5_district_health_indicators (706 districts × 109 columns)
  ├── WorldPop India 2020 1km GeoTIFF (one-time download)
  ├── RHS (NHM Rural Health Statistics) CSV
  ├── Census 2011 district CSV
  ├── NITI Aspirational Districts CSV
  ├── DataMeet ADM2 / geoBoundaries ADM1 GeoJSON
  └── Live: HTTP HEAD/GET vs. facilities_curated.official_website
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │  Databricks Workflow: chikitsa_pipeline  (DAG)                │
        └───────────────────────────────┬───────────────────────────────┘
                                        │
   ┌─────────────┬─────────────┬────────┼────────┬─────────────┬─────────────┐
   ▼             ▼             ▼        ▼        ▼             ▼             ▼
 DQ patch:   build_pop_     website_   Google   enrichments  LLM DQ      service_
 facilities_  grid.py        check     (NONE —  (RHS,        recovery    taxonomy
 curated.sql                 pass 1    removed) Census,      (long-tail  .yaml
                            (HEAD)              NITI ADP)    state)
                                        │
                                        ├── facility_services.sql
                                        │
                              website_check pass 2 (sampled body+LLM)
                                        │
                              facility_coverage_h3.sql
                                        │
                              desert_grid.sql (two-pass)
                                        │
                              district_planning_signals.sql (gold)
                                        │
                              intervention_roi.sql (gold)
                                        │
                ┌───────────────────────┴────────────────┐
                ▼                                        ▼
       Lakebase sync (public.*)              Marketplace Delta share
                │
                ▼
       Express API → React app (Brief / Map / Copilot / Plans)
```

The DAG has one cyclic-looking edge: `desert_grid` reads `district_planning_signals` for the trust-adjusted radius scaling pass. Resolution: a 2-step Workflow task — base coverage produces `is_covered_*`, gold layer composes the base composite, then a `desert_grid_trust_pass` task rewrites the trust-adjusted columns.

The agent boundary is strict: server-side tools run as the app principal against vetted SQL queries; the LLM never receives a Lakebase connection or a SQL string it can execute.

---

## 4. Components

Eleven components plus the API, frontend, and Marketplace deliverable.

### 4.0 Dual SQL location convention

Most data-layer views are authored twice for the two SQL dialects:

- `pipeline/<view>.sql` — Databricks SQL flavor. Uses `CREATE OR REFRESH MATERIALIZED VIEW`, `h3_longlatash3`, `h3_kring`, `h3_distance`, `h3_index_to_parent`, and Spark-style numeric coercion. This is the lineage source for the medallion DAG.
- `chikitsa-copilot/sql/lakebase_<view>.sql` — Postgres flavor for Lakebase. Uses `CREATE OR REPLACE VIEW`, `::DOUBLE PRECISION` casts, no H3 builtins (Lakebase-side joins read pre-computed H3 columns from synced Delta tables). This is what the app's Express server queries directly through `appkit.lakebase.query`.

Both files must produce the same output schema. Discrepancies are caught by the DQ gate's row-count assertions and the API-layer integration tests. When a view is added or modified, both files change in the same commit.

### 4.1 Data quality layer (`pipeline/facilities_curated.sql`, modified)

Bronze→silver patch. Adds `state_vocab` CTE from the PIN directory (canonical 37 states) and recovers `state_key` for the 2,349 address-as-state rows by longest-suffix match. Quarantines the 88 column-shift rows by detecting `facility_id !~ UUID-shape` and flagging `facility_row_quality = 'contaminated_shift'`. Preserves all existing transformations (dedup, null-byte cleaning, snake_case rename, type coercion, PIN regex normalization).

New columns: `recovered_state_key`, `state_key_quality ∈ {clean, recovered_from_address, recovered_by_llm, contaminated, missing}`, `facility_row_quality ∈ {valid, contaminated_shift}`, `recovery_method`, `llm_confidence`, `llm_reasoning`. The active `state_key` projects to `recovered_state_key`; the original is retained as `state_key_legacy`.

### 4.2 LLM data-quality recovery (`scripts/llm_state_recovery.py`)

Once-off Databricks notebook. For rows where regex couldn't recover state — long-tail typos like `"Kerela"` or unusual phrasing — invokes `databricks-gpt-oss-120b` with structured output: `{state: "kerala", state_quality: "recovered_typo", confidence: 0.94, reasoning: "..."}`. Persists `recovered_state_key`, `recovery_method = 'llm'`, `llm_confidence`, `llm_reasoning` back to `facilities_curated`. Idempotent; skips rows already recovered.

Demo line this unlocks: "FDR's GenAI extraction produced 2,437 dirty rows. Our second-pass GenAI cleanup recovers ~2,200 with confidence ≥0.8 and quarantines the rest with reasoning. AI made the mess; AI cleans it; the lineage is auditable."

### 4.3 Population grid (`scripts/build_population_grid.py`, `public.population_grid_h3`)

One-shot Databricks notebook. Reads WorldPop India 2020 1km GeoTIFF, bins each non-zero pixel centroid to H3 r6, sums populations per hex. Resolves `state_key` via point-in-polygon against the existing `india-adm1.json`. Writes Delta `population_grid_h3 (h3_index, state_key, population, source)` clustered by `(state_key, h3_index)`. National output: ~600k r6 hexes, ~30 MB.

Sanity: `SUM(population)` within 5% of India 2020 (~1.38B); per-state totals within 10% of census × known growth.

### 4.4 Service taxonomy (`pipeline/service_taxonomy.yaml`)

Maps FDR's camelCase specialty tags to 10 NFHS-aligned service categories:

```
maternal_obstetric    : gynecologyAndObstetrics, reproductiveEndocrinologyAndInfertility,
                        familyPlanningAndComplexContraception, neonatologyPerinatalMedicine
child_health          : pediatrics, neonatologyPerinatalMedicine,
                        pediatricCriticalCareMedicine, developmentalAndBehavioralPediatrics
emergency             : emergencyMedicine, criticalCareMedicine, traumaSurgery
internal_medicine     : internalMedicine, familyMedicine
ncd_cardio_metabolic  : cardiology, endocrinologyAndDiabetesAndMetabolism,
                        vascularSurgery, cardiacSurgery
ncd_oncology_screening: medicalOncology, radiologyOncology, gynecologyOncology
mental_health         : psychiatry, addictionMedicine
diagnostic_imaging    : radiology, diagnosticRadiology, pathology, hematology
surgical              : generalSurgery, cardiacSurgery, vascularSurgery, traumaSurgery
allied_dental         : dentistry, oralAndMaxillofacialSurgery
```

Each category aligns to NFHS demand-side indicators so per-district demand weights can be derived (e.g. low `four_anc_visits_pct` boosts `demand_weight_maternal`).

### 4.5 Per-facility service flags (`pipeline/facility_services.sql`, `public.facility_services`)

Materialized view, one row per facility. For each of the 10 service categories, emits a boolean (`offers_maternal`, `offers_child_health`, ...) plus a confidence enum. Confidence is `high` when both FDR `specialties` and website `specialties_listed` agree, `medium` when one source attests, `low` when only inferred from `description` text, `absent` when no signal. Cross-validation between FDR and website signals is the whole point — neither source alone is reliable.

### 4.6 Two-pass website evidence (`scripts/website_check.ts`, `chikitsa_app.facility_website_evidence`)

**Pass 1 — universal HEAD check** for every facility with a non-null `official_website`. Records `status_code`, `error_class ∈ {ok, dns, timeout, tls, http_4xx, http_5xx, blocked, other}`, `crawl_blocked` (robots.txt disallow), `domain`, `is_gov_domain` (regex on `.gov.in` / `.nic.in` / state subdomains), `fetched_at`. Powers `t_website_corroboration` (share of facilities with status_code=200) and `t_operator_concordance` (share of websites whose domain matches declared operator type — `.gov.in` for public, etc.) at full coverage.

**Pass 2 — sampled body fetch + LLM extraction.** Stratified probability sample of ~2,000 facilities nationally (~20%). Strata: `state × facility_type × pre-sampling_reliability_tier × action_class`. Allocation oversamples Verify-class districts and low-reliability districts (Neyman-style), undersamples Monitor-class districts. `chikitsa_app.facility_website_evidence` records `was_sampled`, `sampling_stratum`, `inclusion_probability` for every facility (sampled or not). For sampled facilities: `body_fetched_at`, `body_hash`, then LLM extracts `llm_specialties_listed`, `llm_beds_claimed`, `llm_doctors_claimed`, `llm_content_quality ∈ {rich, sparse, spam, none}`, `llm_confidence`, `llm_last_updated_signal`. **Body content is not persisted** — only structured signals + body hash for change detection.

Crawl politeness: respects robots.txt; 1 req/sec/host; identifying User-Agent with project URL and contact email; ≤2 redirects; 10s timeout; 200 KB body cap. Produces `t_service_evidence` with `confidence_band ∈ {direct, borrowed, insufficient}` derived from the design-weighted estimate per district.

Sampling design lives in `pipeline/sampling_plan.md` — stratification rule, allocation formula, total budget, replication procedure.

### 4.7 Coverage geometry (`pipeline/facility_coverage_h3.sql`, `public.facility_coverage_h3`)

Per-facility H3 r7 home hex + k=8 ring, approximating a 10 km Euclidean buffer. Filter: `coordinate_quality = 'plausible_india' AND facility_row_quality = 'valid'`. National scope; ~9,989 valid facilities × 217 hexes/ring ≈ ~2.2M rows. Materializes in seconds in Databricks SQL via built-in `h3_longlatash3` and `h3_kring`.

### 4.8 Desert grid (`pipeline/desert_grid.sql`, `public.desert_grid`)

National H3 r6 grid. One row per cell. Two passes resolve the cyclic dependency on the trust composite:

- **Pass A — base coverage.** For each hex, `is_covered_<service>` is true if any facility offering that service is within k=8 (10 km). Service-conditional joins use `facility_services`. Also computes `is_covered_any` and per-cell `nearest_facility_distance_km`, `district_key`, `population`.
- **Pass B — trust-adjusted coverage.** Reads `district_planning_signals` for each facility's evidence_trust_score (via the facility's resolved district), scales the radius `trust_radius_km = max(3.0, 10.0 × evidence_trust_score / 100)`, recomputes per-service coverage flags as `is_covered_<service>_trust_adjusted`. Distrusted facilities literally cover less ground.

11 service-conditional flags × 2 (base + trust-adjusted) + meta = ~25 columns per row. Cluster by `(state_key, district_key)`. ~600k rows.

### 4.9 Enrichments (`pipeline/enrichments_*.sql`)

Three district-grain materialized views, joined to `district_planning_signals` by `(state_key, district_key)`:

- **`enrichments_rhs.sql`** — Rural Health Statistics official PHC/CHC/sub-center counts. Powers `t_official_concordance` = (FDR public-facility count) / (RHS official public count). The single highest-value enrichment because it produces the strongest possible "we found vs. they list" comparison.
- **`enrichments_census2011.sql`** — district demographics, SC/ST share, urban/rural split, dependency ratio. Feeds `equity_weight` (default 1.0; slider exposes 1.0–1.5).
- **`enrichments_niti_adp.sql`** — NITI Aspirational Districts list. Single boolean `is_aspirational_district` per district. Powers the corroboration narrative.

### 4.10 Reliability composite + gold layer (`pipeline/district_planning_signals.sql`, `public.district_planning_signals`)

The 706-row gold view. Columns:

- **Identifiers**: `state_name`, `state_key`, `district_name`, `district_key`, `district_geo_key`.
- **NFHS demand**: `health_need_score`, per-service `demand_weight_<service>` derived from matching NFHS indicators, `contains_caution_estimate`, `contains_suppressed_value`.
- **FDR supply counts**: `facility_count`, `public_facility_count`, `private_facility_count`, `unknown_operator_count`, `geocoded_facility_count`, `flagged_facility_count`, `official_phc_count`, `official_chc_count` (RHS).
- **Trust components — each 0–100 *when defined*, NULL when the component cannot be computed** (asymmetric handling: a NULL component drops out of the weighted mean and surviving weights renormalize; absence never penalizes):

  | Component | Meaning |
  |---|---|
  | `t_facility_presence` | `100 × (1 − exp(−facility_count / 3))` — saturating |
  | `t_geocoding` | share of facilities with plausible coordinates |
  | `t_pin_unambiguous` | share of facility rows joined via unambiguous PINs |
  | `t_flagged_inverse` | `1 − flagged_count / facility_count` |
  | `t_indicator_quality` | `100 − 40 × suppressed − 20 × caution` |
  | `t_website_corroboration` | share of facilities with HTTP 200 (Pass 1) |
  | `t_operator_concordance` | share of websites whose domain matches declared operator type |
  | `t_service_evidence` | sampled extraction signal with bootstrap CI |
  | `t_official_concordance` | FDR public count / RHS official public count |
- **Trust composite**: `evidence_trust_score` = weighted mean of NON-NULL components, weights renormalized. Default weights documented in a SQL comment block; they sum to 1.0 across components present.

  **Reference SQL (must replace today's `COALESCE(t_x, 50)` pattern in `pipeline/district_planning_signals.sql` and the Lakebase twin):**

  ```sql
  -- Sum of weights for components that are NOT NULL for this row,
  -- then divide the contribution sum by that to renormalize.
  -- A district with zero facilities (so geocoding/pin/flagged/website
  -- components are NULL) is scored only on facility_presence + indicator_quality
  -- + any other defined components — never penalized for absent data.
  WITH parts AS (
    SELECT
      *,
      -- contribution = component × weight, NULL when component is NULL
      t_facility_presence  * 0.30                                 AS c_pres,
      t_geocoding          * 0.15                                 AS c_geo,
      t_pin_unambiguous    * 0.10                                 AS c_pin,
      t_flagged_inverse    * 0.15                                 AS c_flag,
      t_indicator_quality  * 0.15                                 AS c_ind,
      t_website_corroboration * 0.05                              AS c_web,
      t_operator_concordance  * 0.05                              AS c_opcon,
      t_service_evidence      * 0.03                              AS c_svc,
      t_official_concordance  * 0.02                              AS c_offcon,
      -- weight contribution; 0 if component is NULL
      CASE WHEN t_facility_presence  IS NULL THEN 0 ELSE 0.30 END AS w_pres,
      CASE WHEN t_geocoding          IS NULL THEN 0 ELSE 0.15 END AS w_geo,
      CASE WHEN t_pin_unambiguous    IS NULL THEN 0 ELSE 0.10 END AS w_pin,
      CASE WHEN t_flagged_inverse    IS NULL THEN 0 ELSE 0.15 END AS w_flag,
      CASE WHEN t_indicator_quality  IS NULL THEN 0 ELSE 0.15 END AS w_ind,
      CASE WHEN t_website_corroboration IS NULL THEN 0 ELSE 0.05 END AS w_web,
      CASE WHEN t_operator_concordance  IS NULL THEN 0 ELSE 0.05 END AS w_opcon,
      CASE WHEN t_service_evidence      IS NULL THEN 0 ELSE 0.03 END AS w_svc,
      CASE WHEN t_official_concordance  IS NULL THEN 0 ELSE 0.02 END AS w_offcon
    FROM components
  )
  SELECT
    *,
    CASE
      WHEN (w_pres + w_geo + w_pin + w_flag + w_ind
            + w_web + w_opcon + w_svc + w_offcon) = 0 THEN NULL
      ELSE ROUND(
        (COALESCE(c_pres,0) + COALESCE(c_geo,0) + COALESCE(c_pin,0)
         + COALESCE(c_flag,0) + COALESCE(c_ind,0)
         + COALESCE(c_web,0) + COALESCE(c_opcon,0)
         + COALESCE(c_svc,0) + COALESCE(c_offcon,0))
        / (w_pres + w_geo + w_pin + w_flag + w_ind
           + w_web + w_opcon + w_svc + w_offcon),
        1)
    END AS evidence_trust_score
  FROM parts;
  ```

  **Why not `COALESCE(t_x, 50)`** (the current implementation pattern): defaulting NULL components to 50 silently penalizes — or in our case, silently *flatters* — districts that have no facilities. A district with zero facilities gets `t_geocoding = NULL` because there is nothing to geocode; treating that as "the geocoding is mid-quality" is a fabrication that biases the composite toward 50. The renormalization above is the correct asymmetric handling: absence drops out, presence carries the weight.
- **Confidence**: `confidence_band ∈ {direct, borrowed, insufficient}`, `sample_size_for_service_evidence`, `trust_components_used` (array).
- **Spatial fractions** (per service): `desert_area_pct_<s>`, `desert_area_pct_<s>_trust_adjusted`, `desert_population_<s>`, `desert_population_pct_<s>` and trust-adjusted variants.
- **Demand-weighted headline**: `weighted_desert_pct = Σ desert_pct_<s> × demand_weight_<s>` and trust-adjusted variant.
- **Composites**: `facility_scarcity_score`, legacy `desert_score`, `trust_adjusted_score`.
- **Equity context**: `sc_share_pct`, `st_share_pct`, `urbanization_pct`, `dependency_ratio`, `equity_weight`.
- **Aspirational**: `is_aspirational_district`.
- **Action class** (rule-based, service-aware, priority order):
  1. `Investigate` — `health_need_score IS NULL OR (contains_suppressed_value AND key_indicators_null > 1)`
  2. `Verify` — `evidence_trust_score < 50`
  3. `Build (<service>)` — `health_need_score >= 60 AND weighted_desert_pct >= 40 AND evidence_trust_score >= 60`. Selected service: ARG MAX over services of `demand_weight_<s>`; ties broken by worst supply (highest `desert_population_pct_<s>`).
  4. `Improve access (<service>)` — `health_need_score >= 50 AND weighted_desert_pct ∈ [25, 40)`
  5. `Upgrade (<service>)` — `health_need_score >= 60 AND weighted_desert_pct < 25`
  6. `Investigate` — fallback

  `recommended_action` and `recommended_action_service` are separate columns.
- **Provenance**: `signals_version = 'v3-2026-06'`, `source_period = 'NFHS-5 (2019-2021)'`.

### 4.11 ROI estimator (`pipeline/intervention_roi.sql`, `public.intervention_roi`)

Per district × canonical action. Canonical actions: `build_phc`, `build_chc`, `mobile_unit`, `verify_pass`, `upgrade_facility`. Per row:

- `indicative_capex_cr`, `indicative_opex_cr_yr` from NHM cost norms (lookup table; ~₹2–3 cr capex per PHC, ~₹15–20 cr per CHC, ~₹50L/yr for a mobile unit, ~₹2–5L for a Verify-pass FDR re-discovery).
- `delta_access` — additional reliability-discounted population brought within 10 km of a service-appropriate facility, computed by simulating the action at the largest desert hex cluster of the relevant service. Includes equity weight and reliability discount.
- `delta_utilization_proxy` — projected uplift in the matching NFHS indicator (e.g. institutional birth pp gain) from access elasticity literature; wide CI; treated as directional.
- `roi_geo_mean = sqrt(delta_access × delta_utilization_proxy)` — the geometric mean per the §2 design choice.
- `roi_per_cr = roi_geo_mean / indicative_capex_cr`.
- `roi_per_cr_equity_{1.0, 1.2, 1.5}` — sensitivity bands.
- `priority_rank_national`, `priority_rank_state`.
- `methodology_version = 'roi-v1-2026-06'`.

The unit "AQAP" (access-quality-adjusted persons) is the headline. Spec acknowledges this is an estimate, not a causal projection; the methodology page documents formula, sources, and limitations.

---

## 5. API surface

Express routes, all reading from Lakebase. Three groups: deterministic read, intelligent (agent), CRUD.

### 5.1 Deterministic read endpoints

- `GET /api/brief?state?&service?&equity_weight?&limit=50` — national priority queue, ranked by composite ROI. Each row: state, district, action class + service, key driver phrase, ROI band, `is_aspirational_district`, `confidence_band`. Drives BriefPage.
- `GET /api/map/india` — state-level aggregation for the existing India choropleth.
- `GET /api/map/state/:state_key/districts` — district planning signals for that state. Row count varies (Bihar 38, UP 75, Goa 2). State key validated against canonical NFHS list.
- `GET /api/map/state/:state_key/coverage` — H3 desert grid for that state. Both base and trust-adjusted flags ship in one payload, all 11 services. Server-side filter on `population > 0 OR NOT is_covered_any_trust_adjusted` to halve payload. `Cache-Control: max-age=300`.
- `GET /api/map/state/:state_key/facilities` — scatter overlay rows.
- `GET /api/quality/contamination` — DQ counts for the Brief page header strip.
- `GET /api/location-options?state?` — canonical state and district vocabulary for filter dropdowns. Sourced from `district_health_profiles`. Returns `{ states: [{state_name, state_key, district_count}], districts: [{state_name, state_key, district_name, district_key}] }`. Used by every page that exposes a state/district filter; centralizing the lookup avoids each page re-deriving it from `/api/districts`.

### 5.2 Intelligent endpoints

- `POST /api/copilot/analyze` — agent loop, max 5 turns, 8 tools (see §6). Returns `{answer, reasoning_trace[], evidence_used, attribution, warnings}`.

### 5.3 CRUD endpoints

- `GET/POST/PATCH/DELETE /api/interventions` — existing CRUD, extended with `verification_path`, `target_outcome_metric`, `target_outcome_value`, `est_capex_cr`, `est_aqap` columns.

### 5.4 Deferred endpoints (Google)

The earlier draft of this spec said "drop Google entirely." Commit `7960b48` shipped a stub instead — `chikitsa_app.facility_external_match` table at startup, `/api/copilot/reviews` endpoint that returns `{ reviews: [], reason: 'no_match' }` for every request because no enrichment has run. The spec now reflects what's there:

- The table and the endpoint **stay**, as *deferred* / *stretch*. Nothing in the MVP relies on either.
- No enrichment script ships in the MVP. Without one, the endpoint always returns the empty-reviews shape, which is correct behavior for "no match found."
- If a post-hackathon iteration wants the live-reviews narrative, the enrichment is a single Node script (~250 LOC) using Place Search → Place Details. The schema is already in place to receive it.
- Website evidence (§4.6) remains the primary external corroboration source for the MVP. It exists in the *spec* but not yet in code.

---

## 6. Agentic copilot

The agent decides which evidence to pull, in what order, before synthesizing. Without it, the system just renders SQL. With it, the user asks a question in their own language and the agent's reasoning is visible.

### 6.1 Agent loop

- Server-side loop in `chikitsa-routes.ts` invoking `databricks-gpt-oss-120b` with tool-calling.
- Bounded: **max 5 turns; 8 tools; no SQL generation; no Lakebase access from the model side.**
- Each tool is a thin wrapper over a vetted SQL query running as the app principal.
- Returns `reasoning_trace` (per-step tool, args, summary, duration) for the UI.

### 6.2 Tool surface (8 tools)

```
get_planning_signals(state_key, district_key)
get_top_priority_districts(state_key?, k=5, sort_by='roi'|'need'|'reliability')
get_peer_districts(state_key, district_key, axis, k=5)
get_facility_breakdown(state_key, district_key)
get_trust_component_drivers(state_key, district_key, component?)
get_facility_website_evidence(facility_id)
compare_interventions(district_a, district_b, canonical_action, target_service?)
draft_intervention(state_key, district_key, action_class, target_service?)
```

`get_top_priority_districts` is the planner-shaped tool: it returns the top-K with their drivers and ROI bands deterministically, so the agent doesn't have to build a national priority queue turn by turn.

### 6.3 System prompt commitments

- "Use only the provided tools. Never describe SQL you would write."
- "Cite the trust component(s) by name when explaining a low reliability score."
- "Cite the spatial fraction (X% population in Y desert) when explaining a Build/Improve_access classification."
- "Use 'evidence reliability' or 'verifiable,' not 'trust' or 'trustworthy.'"
- "Action classes are deterministic; do not override them. You may explain or expand."
- "If a tool returns insufficient data (`confidence_band='insufficient'`), say so explicitly and recommend Verify."
- **Fast-path clause**: "If the question is a direct lookup (one district, one fact, no comparison or 'why first' framing), call exactly one tool and then answer. Do not invoke peer-finding, comparison, or prioritization tools unless the question asks for them."

### 6.4 Typical sequences

| Shape | Turns | Tool calls | Latency |
|---|---|---|---|
| Single-fact lookup | 1 | 1 | ~1.5s |
| Explain a classification | 3 | 2 | ~3s |
| Compare two districts | 3 | 3 | ~4s |
| What should we investigate first | 3 | 1–2 | ~3–4s |
| Draft an intervention | 3 | 3 | ~3s |

Cap of 5 turns is a backstop, not a target.

---

## 7. Frontend

Five React pages. The new front door is BriefPage.

### 7.1 BriefPage (new) — landing experience

National priority queue. Top 50 districts ranked by composite ROI. Each row shows action class badge (with service in parentheses), district + state name, single-phrase driver ("Maternal desert 78%, NFHS 4-ANC 25%"), ROI band, NITI Aspirational flag, confidence band. Click a row to drill into Map. Filter pill switches to per-state view. Equity-weight slider exposes 1.0–1.5; default 1.0; sensitivity bands shown.

Header strip: data quality counts ("88 facilities held back from analysis — column-shift contamination flagged for FDR review. ~2,200 facilities state-recovered from address strings. ~500 long-tail rows recovered by LLM with confidence ≥0.8.").

### 7.2 IndiaMapPage (extended)

Existing India ADM1 ECharts choropleth at `mode='india'`. New `mode='state'` triggered by clicking any state. Parallel fetches: districts, coverage, facilities, per-state district GeoJSON.

Three stacked ECharts series:

1. **Bottom**: state's district choropleth shaded by `health_need_score` (sequential muted-red ramp). NFHS demand-side substrate.
2. **Middle**: H3 r6 desert hexes rendered as polygons via `h3-js cellToBoundary`. Hexes with `is_covered_<service>=false` (or trust-adjusted variant when toggle on) shown as semi-transparent red, opacity scaled by population.
3. **Top**: facility scatter, color by operator type (public=teal, private=plum, unknown=gray).

Top bar: **service selector** (All services / Maternal / Child health / Emergency / NCD: cardio / NCD: oncology / Mental health / Diagnostic / Surgical / Allied dental), **reliability adjustment toggle**, **equity slider**.

Corner stat panel: "{State} at base reliability: X% land / Y million people in {service} desert. Reliability-adjusted: X'% / Y' million." Updates instantly on toggle/service-change since both flags ship in the same payload.

Service mini-chart: 8–10 horizontal bars showing `desert_population_pct_<service>` for the selected state, sorted. The longest bar names the state's worst service desert at a glance.

District drill-down side panel (on click):

- Action class badge (with service).
- Spatial fraction citation.
- Trust component stacked bar (recharts) — fixed component order so cross-district comparison is legible.
- Need composition (NFHS percentages with caution/suppressed badges).
- Facility breakdown by operator_type.
- Confidence band badge ("low-confidence reliability" if `confidence_band='insufficient'`).
- "Open in Copilot" → `/copilot?state=<>&district=<>`.

### 7.3 CopilotPage (extended)

Reads `state` and `district` from URL params; pre-fills form. Renders agent reasoning trace as a collapsible panel above the answer (shows tool name, args, summary, duration per step; streams as tool calls return). Below the answer: **Website evidence panel** showing the structured signals from `facility_website_evidence` for the top 3 facilities in the selected district — `is_gov_domain`, status_code, sampled extraction (if present), confidence. No live HTTP fetch from the user's browser. Footer: model identity, source period, methodology link.

### 7.4 PlansPage (extended)

Existing CRUD plus AI-drafted intervention prefill. When a planner clicks "Open in Plans" from a Map district, the agent's `draft_intervention` tool generates a draft with `title`, `action_type`, `priority`, `notes`, `verification_path`, `target_outcome_metric`, `target_outcome_value`, `est_capex_cr`, `est_aqap`, and `citations`. Planner edits and saves.

### 7.5 ExplorePage (existing)

No structural changes. Inherits the new `state_key_quality` and `facility_row_quality` columns in facility result cards.

### 7.6 `DistrictStateMap` reusable component

Lives at `client/src/components/DistrictStateMap.tsx`. Lazy-loads the per-state district-boundary GeoJSON from `client/public/state-district-boundaries/{state_key}.json` (one file per state, 36 total) and registers it with ECharts as `state-districts-{state_key}`. Renders a district choropleth shaded by `trust_adjusted_score` (sequential ramp), with the optionally-passed `districtKey` prop highlighted in red.

Used by IndiaMapPage's drill-down side panel today and by the Copilot page when `?state=&district=` are present. Available for reuse anywhere a small "this district within its state" inset is wanted (Plans page intervention drafts, Explore facility cards).

Props: `{ stateKey, stateName?, districtKey }`. Internal cache keyed by `stateKey` so re-rendering the same state doesn't re-fetch.

---

## 8. Marketplace deliverable

Databricks Delta share publishing the gold-layer tables: `district_planning_signals`, `desert_grid`, `intervention_roi`. Listing description in Marketplace's stripped-markdown subset (headings, bold, lists only). Independent of app deploy; same Delta tables the app reads.

---

## 9. Failure modes (committed degradation paths)

Default policy: **graceful degradation with explicit banners**. Never silently degrade, never hard-fail the whole UI when only one layer is sick. Asymmetric NULL handling on trust components is the property that makes most of this free.

### 9.0 `queryWithFallback` — the canonical degradation pattern

Each Lakebase read endpoint that depends on `district_planning_signals` issues SQL through a small wrapper:

```ts
async function queryWithFallback(
  appkit: ChikitsaAppKit,
  primarySql: string,    // SELECT from public.district_planning_signals
  fallbackSql: string,   // inline DISTRICT_RANKING_SQL against UC sources
  params: unknown[] = [],
) {
  try {
    return await appkit.lakebase.query(primarySql, params);
  } catch (err) {
    console.warn('[chikitsa] Falling back to inline planning SQL:', err.message);
    return appkit.lakebase.query(fallbackSql, params);
  }
}
```

This is what makes the app shippable before pipeline runs and Lakebase syncs. The fallback computes the same trust composite inline against `facilities_curated`, `pincode_geography`, `district_health_profiles` — the three views that already exist in Lakebase. Every endpoint that reads from the gold view must use this wrapper. The fallback covers `district_planning_signals` missing (the one full-stop failure below becomes degraded-graceful through the wrapper); the table below documents the *user-visible* effects when the fallback is the only path that succeeds.

| Component missing | Behavior |
|---|---|
| DQ patch not applied | Banner: "FDR contamination not yet quarantined; ~88 anomalous rows visible." Action endpoints still work. |
| LLM state recovery skipped | Per-facility flag in Explore; Brief footer: "M facilities pending state recovery." Maps unaffected. |
| `population_grid_h3` missing | `desert_population_pct` is NULL; Map corner stats show area-only. |
| `facility_coverage_h3` empty | Map renders need choropleth + facility points only. Banner. Brief degrades to need-only ranking. |
| `facility_services` missing | Service selector disabled; mini-chart hidden; weighted_desert_pct falls back to all-services. |
| `facility_website_evidence` empty | Three trust components NULL → asymmetric handling, weights renormalize. Reliability bar shows fewer segments. No banner needed. |
| Enrichments (RHS / Census / NITI) missing | Per-source banner. Equity slider disabled (Census missing); Aspirational badge hidden (NITI missing); reliability bar drops one segment (RHS missing). |
| `district_planning_signals` missing | Full-page error: "Gold layer not yet materialized." `/api/map/india` returns 503. **The one intentional full-stop failure.** |
| `intervention_roi` missing | Brief sorts by `health_need_score × desert_population_pct`. Banner. |
| LLM serving endpoint down | Agent fails; CopilotPage shows: "Agent temporarily unavailable. Deterministic evidence still loads." Renders the same evidence the agent would have called as tools — flat, unagented, but visible. |
| Lakebase sync lag | Server falls back to direct UC warehouse query. Banner: "Reading from warehouse fallback." |

Website-stage sub-failures (timeout, 4xx/5xx, robots.txt, DNS) record specific `error_class` values and never silently retry inside the request.

---

## 10. Pipeline orchestration

One Databricks Workflow named `chikitsa_pipeline`. Tasks (in dependency order):

1. `dq_patch_facilities_curated`
2. `llm_state_recovery` (depends on 1, optional — runs nightly, not blocking)
3. `build_population_grid` (independent, parallel)
4. `website_check_pass1_universal_head` (depends on 1)
5. `enrichments_rhs`, `enrichments_census2011`, `enrichments_niti_adp` (independent of each other; each depends on 1)
6. `facility_services` (depends on 1, 4 for website signals; 4 may be empty)
7. `facility_coverage_h3` (depends on 1)
8. `desert_grid_pass_a_base` (depends on 7, 6, 3)
9. `district_planning_signals_pass_a` (depends on 8, 5, 4)
10. `desert_grid_pass_b_trust_adjusted` (depends on 9 — resolves the cyclic edge)
11. `district_planning_signals_pass_b` (depends on 10 — final trust-adjusted columns)
12. `intervention_roi` (depends on 11)
13. `dq_checks` + `dq_expectations` (depends on 12 — gates everything below)
14. `lakebase_sync` (depends on 13 passing)
15. `marketplace_share_refresh` (depends on 13 passing, parallel to 14)
16. `website_check_pass2_sampled_body` (depends on 11 for stratification metadata; runs after gold layer; results re-feed `t_service_evidence` on next pipeline run)

The pass-2 website body fetch is a side branch that lands data for the *next* run's reliability composite. It does not block today's deploy.

Pipeline runs on demand for the hackathon (manually triggered before the demo). Post-hackathon: nightly schedule with Lakebase sync gated by DQ pass.

---

## 11. Validation strategy

### 11.1 DQ gate (`pipeline/dq_checks.sql` + `pipeline/dq_expectations.sql`)

Both files return rows only on failure. Pipeline task fails if either returns rows; Lakebase sync is blocked.

`dq_checks.sql` covers structural assertions: row counts (706 districts, ~2.2M coverage rows, etc.), NULL bans on required columns, `purbi/purba champaran` alias regression, trust-component variance ≥ 5 per component (catches flat signals), DQ patch counts within expected bands, sampling design integrity.

`dq_expectations.sql` codifies sanity expectations written before data lands: Bihar Aspirational Districts mostly land in Verify or Build (≥9 of 13); Patna does not land in Verify; Saharsa/Kishanganj/Jehanabad land in Verify with `t_facility_presence < 30`; national Verify rate within 25–65%; districts with high maternal demand and 0 maternal-offering facilities don't end up in Upgrade.

**Action threshold note.** The Verify rule shipped in `7960b48` is `evidence_trust_score < 50 OR t_facility_presence < 30`. Earlier drafts of this spec said `evidence_trust_score < 50` only. The shipped rule is correct — and stricter — because districts with zero or near-zero facility presence should classify Verify even when their other components push the composite above 50 by accident of NULL handling. Once §4.10's renormalization replaces today's `COALESCE(t_x, 50)`, the second clause may no longer be needed and the rule simplifies. Treat both forms as equivalent for testing during the migration; remove the `OR t_facility_presence < 30` clause only after the renormalization lands and the national Verify-rate sensitivity test confirms the distribution stayed in band.

**Trust component weight note.** `7960b48` ships weights `presence 0.35 / geocoding 0.20 / pin_unambiguous 0.20 / flagged_inverse 0.15 / indicator_quality 0.10` summing to 1.0 across the five present components. This spec's §4.10 specifies a different default `presence 0.30 / geo 0.15 / pin 0.10 / flag 0.15 / ind 0.15 / website_corrob 0.05 / op_concord 0.05 / svc_evid 0.03 / off_concord 0.02`. The shipped weights are correct *for the five-component world we're in today*; they will need to be replaced (not extended) by the spec's nine-component weights when the website + RHS components land. Do not attempt to add the new components incrementally to today's weights — the renormalization in §4.10 makes that math wrong. Cut the weights over in one commit alongside the new components.

### 11.2 Sensitivity reports (`pipeline/sensitivity_*.sql`, advisory)

Don't gate; produce reports we read before the demo.

- **Trust component ablation** — drop each component, recompute, log districts that change action class. Each component should shift ≤ 30 districts (~4%); a component shifting > 100 is a single point of failure.
- **Buffer radius** — 5 / 10 / 15 km variants; top-50 priority queue overlap > 70% across radii.
- **Equity weight** — 1.0 / 1.2 / 1.5; top-50 intersection ≥ 35. "Robust top-3" districts appear at all three weights.
- **Demand-weight scheme** — equal vs. NFHS-derived vs. supply-uniform; Spearman > 0.85.
- **Bootstrap CI for `t_service_evidence`** — 200 resamples; flag districts whose CI crosses 50 points.

### 11.3 Agent behavior tests (`tests/agent/*.spec.ts`)

Agent is non-deterministic; tests are invariants:

- **Tool-use bounds**: turns ≤ 5; tool calls ≤ 8 (one per tool max per invocation in the worst case); every tool call's args validate; no SQL strings in answer or reasoning_trace.
- **Fast-path enforcement**: single-fact lookup uses 1 turn, 1 tool call.
- **Hallucination guards**: answer doesn't say "trust"/"trustworthy"; cited percentages appear in `evidence_used`; cited components are in the canonical list; action class in answer matches deterministic SQL.
- **Degradation**: tool errors produce `warnings: ['evidence retrieval partial']` and the agent does not invent data.
- **Latency**: p95 over 30 invocations per shape: ≤4–5s.

### 11.4 End-to-end demo gate

Automated (Playwright, in `tests/e2e/demo_dryrun.spec.ts`):

1. `/api/brief` returns ≥ 50 rows.
2. Brief renders the priority queue; first row's action badge visible.
3. Click → Map opens with state=<> and district=<> from the URL.
4. Coverage endpoint returns 200 with hex count > 0.
5. Reliability toggle changes corner stat numbers.
6. Service selector changes coverage flag.
7. Copilot deep-link → agent responds in <8s with reasoning trace visible.
8. Plans draft prefill works.

Manual (run twice from cold cache):

```
( ) BriefPage opens with priority queue in <2s
( ) Top-3 includes ≥3 NITI Aspirational Districts
( ) Click Bihar → Map drill-in <2s
( ) Reliability toggle visibly grows desert hexes for Saharsa, Kishanganj, Jehanabad
( ) Click Saharsa → side panel cites trust components by name
( ) Copilot deep-link → reasoning trace shows 1–2 tool calls, answer in <8s
( ) Final answer says "reliability" not "trust"
( ) Final answer cites the spatial fraction
( ) Plans draft is editable
( ) Methodology link works from any reliability number
( ) Total demo time < 4:30
```

Every checkbox missed = a fix before public demo.

### 11.5 Validation cadence

- **Per pipeline run** — DQ gate runs as final task. Failure → no Lakebase sync; banner from cached fallback.
- **Pre-deploy (every git push)** — typecheck, lint, smoke, agent tests, Playwright e2e. Failure → no deploy.
- **Pre-demo (day-of)** — re-run pipeline; read sensitivity reports; walk manual checklist twice; verify methodology page; verify Marketplace listing.

### 11.6 Out of scope for testing

External LLM correctness (we test bounds, not "good answers"); geography-correctness against ground truth (we accept known PIN-based imprecision, documented); WorldPop per-cell accuracy (sanity-checked at national/state aggregates only); Marketplace listing accuracy (same Delta data the app reads).

---

## 12. Risks and open questions

- **Action threshold tuning.** New 7-component composite shifts the distribution; the `evidence_trust_score < 50` Verify cutoff is a guess. Mitigation: at the first run, dump the national histogram and tune so Aspirational Districts land in the expected class AND the national Verify rate stays in the 25–65% band.
- **District-polygon naming drift across states.** Bihar's known mismatch is `purbi/purba champaran`. Other states will have analogous one-off issues. Mitigation: log unmatched `district_geo_key`s on first render of any state, surface counts in the UI as "N districts unmatched in {state}," fix in the alias map as discovered.
- **Website coverage urban bias.** Government PHCs rarely have working websites; private hospitals in cities often do. Mitigation: asymmetric NULL handling means absence does not penalize; UI label notes "Independent corroboration where websites exist." The bias is itself part of the demo's evidence.
- **Sample-size tail.** Districts with <5 sampled facilities get `confidence_band = 'insufficient'`. Demo line and side-panel badge surface this honestly. Robust top-3 list intersects across equity sensitivity bands to avoid amplifying low-confidence districts into top-K.
- **Service-tag coverage.** FDR's `specialties` fill rate is unknown at design time; if <60% nationally, the per-service desert layer becomes patchy and trust-adjusted variants matter even more. Mitigation: probe fill rate during DQ gate sub-step before relying on per-service signals.
- **NHM cost norms are indicative.** Real procurement costs vary 2–3× by state and terrain. The methodology page makes this explicit; ROI is an "estimate," never a "projection."
- **NFHS-5 age (2019–21 in 2026).** Source period rides every signal and prompt. NFHS-6 merge is out of scope for this design; flagged for next iteration.
- **Pipeline-stage 11 (`district_planning_signals_pass_b`) is the one cyclic edge.** Resolution is a separate Workflow task. Test coverage explicitly verifies pass A's `is_covered_*` columns are stable under pass B's recompute.

---

## 13. References

- Wang & Strong (1996), *Beyond Accuracy: What Data Quality Means to Data Consumers*, JMIS — the dimensions framework underlying the reliability composite.
- OECD/JRC (2008), *Handbook on Constructing Composite Indicators: Methodology and User Guide* — the recipe for normalization, weighting, and sensitivity analysis.
- NITI Aayog Aspirational Districts Programme (ADP) methodology — local analogue and corroboration source.
- WHO and Indian Public Health Standards (IPHS) — the "30-minute travel time" framing for the buffer radius.
- WorldPop India 2020 1km dataset (https://hub.worldpop.org/geodata/listing?id=70).
- DataMeet India Maps (https://datameet.org), geoBoundaries (https://www.geoboundaries.org) — boundary polygon sources.
- Repo: `IMPLEMENTATION_PLAN.md` (commit `1a8b397`), `AGENTS.md`, `HACKATHON_CONCEPT.md`.
