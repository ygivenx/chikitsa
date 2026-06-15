# Chikitsa — District drill, Evidence-Confidence rebuild, Google Places enrichment

## Context

The hackathon repo evolved while this plan was being drafted. Two upstream commits (`9782ab9` "Focus Chikitsa MVP on evidence confidence" and `49c908a` "Add India healthcare desert map") materially change what needs to be built:

- **Map already exists.** `client/src/pages/IndiaMapPage.tsx` renders a state-level (ADM1) choropleth using **ECharts via `echarts-for-react`** (already in `package.json`), with `client/public/india-adm1.json` (geoBoundaries ADM1, 36 features, 4.9 MB) registered as the basemap. Library decision is made — Leaflet is out, ECharts is in. Click-a-state shows a side card with top-district scores; the API is `/api/map/india`.
- **Trust composite + action class are already implemented in SQL** — but inline in `server/routes/chikitsa-routes.ts` (`DISTRICT_RANKING_SQL`, lines 76–147). Outputs: `health_need_score`, `facility_scarcity_score`, `desert_score`, `evidence_trust_score`, `trust_adjusted_score`, `recommended_action ∈ {build, verify, upgrade, improve_access, investigate}`.
- **Brand is now Bihar-first, planner-facing.** Nav is "Brief / Map / Evidence / Actions / Copilot." `AGENTS.md` forbids treating public/private ownership as Evidence Confidence (it's context, not trust). `HACKATHON_CONCEPT.md` standardizes the action class names and the demo flow.
- **`InterventionAction` enum and `actionLabels`/`actionVariant`/`biharFocusDistricts` are canonical** in `client/src/lib/chikitsa-copy.ts` and `chikitsa-types.ts`. Don't redefine these.
- **Plans page is action-typed.** The `interventions` table has an `action_type` column with an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migration.

What still needs to happen for the demo to land:

1. **District drill.** The current map can't show Bihar's *district* variation, which is the demo's punchline ("Saharsa, Kishanganj, Jehanabad nearly empty in the registry"). State-level choropleth aggregates that away.
2. **Evidence Confidence is built on a noise component.** The probe showed `completeness_score` is 7/7 for 98.8% of facilities, so `evidence_trust_score = avg_completeness/7 × 100` is essentially 100 for every district minus penalties. The trust toggle on the map will appear to do little visible work today. We need to drop completeness and rebuild from signals that actually vary.
3. **Lift trust SQL into the pipeline.** Per `AGENTS.md`'s framing of medallion lineage, the trust composite belongs as a versioned `pipeline/district_planning_signals.sql` synced to Lakebase, with the API route doing a thin `SELECT *`.
4. **Independent corroboration is missing.** Every component of today's Evidence Confidence is internal data quality. Adding a *third-party* verification axis — Google Places match — turns Evidence Confidence from "is this dataset clean?" into "does this place exist outside our registry?", which is the planner question that actually matters.
5. **Google Places must be added carefully.** Match counts and `place_id` may persist; review *content* may not. Coverage is biased toward urban areas, so it must be **asymmetric** — a match raises confidence, absence does not lower it (else we re-introduce the urban bias the project is meant to expose).

The intended outcome: when a planner opens `/map`, clicks Bihar, and toggles "Trust adjustment," districts visibly re-rank. Saharsa/Kishanganj/Jehanabad land in **Verify** with an explicit reason cited from the trust components. Clicking a district drills to a side panel that shows the trust component bar, the Google match rate, and a "Live patient reviews" panel that pulls Google Place Details with attribution at request time. The Copilot answers "why this action class" using the same numbers shown on the map.

## Scope

**In:**

1. New `pipeline/district_planning_signals.sql` materialized view (SQL home of need + trust + action).
2. Trust formula rebuilt with components that vary; `completeness_score` removed; ownership remains a context column not a trust input.
3. District drill on `IndiaMapPage`: click Bihar → load Bihar ADM2 GeoJSON → district choropleth in same ECharts container; "Trust adjustment" toggle re-colors by `recommended_action` vs. `desert_score`.
4. District drill-down side panel: trust component stacked bar, action class with rule narration, Google match rate, link into Copilot.
5. Google Places enrichment for Bihar's 258 facilities: one-shot `scripts/enrich_places.ts` populates `chikitsa_app.facility_external_match`. New `t_external_verification` trust component, asymmetric.
6. Live reviews path: `GET /api/copilot/reviews?facility_id=…` calls Place Details per request, returns reviews + attribution, never persists content.
7. Server routes: `/api/map/india` extended to expose `district_action_breakdown`; new `/api/map/bihar` returns the district list keyed for ECharts; `/api/copilot/analyze` evidence extended with the planning-signals row.
8. Move `DISTRICT_RANKING_SQL` from inline TS into a thin `SELECT * FROM public.district_planning_signals` once the view is synced.

**Out:**

- National enrichment (cost + bias risk).
- Persisting Google review content.
- Slider-tunable trust weights.
- Point-in-polygon recompute (PIN-based assignment is acceptable per `AGENTS.md`; one-line spelling alias for `purbi/purba champaran` is the only fix).
- GDP/political/constituency overlays.
- Full all-India ADM2 choropleth (Bihar-only district drill is sufficient for the demo).

## Data Quality Strategy

The pipeline already does substantial silver-layer work in `pipeline/facilities_curated.sql` — dedup by `unique_id`, null-byte stripping (`REPLACE(col, CHAR(0), '')`), snake_case rename, type coercion via `TRY_CAST`, PIN regex normalization, and computed quality flags (`coordinate_quality`, `pincode_quality`, `capacity_outlier_flag`, `completeness_score`). These are *labels* on the data, not corrections to it.

What the Lakebase probe revealed that this strategy must address:

**Column-shift contamination (88 rows, 0.87%).** A class of rows where the FDR GenAI extraction emitted fields off by N positions. Symptoms: `facility_id` contains text fragments instead of UUIDs (e.g. `"  *  __Oncology"`, `"Currently"`, an email address); the row's `name` column then contains the *specialties JSON array*; `state_or_region` contains a *GeoJSON Point* string; `country` contains a *latitude as text*; `pincode` contains the *longitude with the decimal stripped* (e.g. `"11009271621704102"`); the real `latitude`/`longitude` numeric columns are NULL because the values landed in country/pincode. These rows aren't partially bad — they're entirely scrambled. They survive the silver layer because dedup runs on `unique_id` and the cleaning ops are per-column.

**Address-as-state contamination (2,349 rows, 23%).** Rows with valid UUIDs but where `state_or_region` carries a full address (`"Pallikulam, Post Chirakkal, Kannur District, Kerala"`) instead of the bare state name. The current silver step lowercases and trims this verbatim into `state_key`, so the join key is dirty. Today's API filters by `state_key = $1` silently drop these rows — they don't fail, they vanish. Bihar's 258 rows are clean; the contamination concentrates in Kerala, Tamil Nadu, and a long tail of states with verbose source addresses.

**`completeness_score` is uninformative.** 9,959 of 10,077 facilities (98.8%) score 7/7. The score does not vary, so it cannot rank or distinguish. It must come out of the trust composite. Keep the column for per-row UI display, do not aggregate it.

### Four-layer strategy

**1. Detection — flag, don't drop.** Every silver/gold row carries persistent quality flags. Replace `WHERE x IS NOT NULL` filters with explicit quality-aware logic that retains uncertain rows and labels them.

| Layer | Issue | Flag |
|---|---|---|
| `facilities_curated` | column-shift contamination | new `facility_row_quality ∈ {valid, contaminated_shift}` from `facility_id !~ UUID-shape` test |
| `facilities_curated` | address copied into state_key | new `state_key_quality ∈ {clean, recovered_from_address, missing, contaminated}` |
| `facilities_curated` | bad coords / capacity / pin | existing `coordinate_quality`, `pincode_quality`, `capacity_outlier_flag` ✓ |
| `pincode_geography` | 1,478 ambiguous PINs | existing `is_unambiguous` ✓ |
| `district_health_profiles` | suppressed (13) / caution (233) | existing `contains_suppressed_value`, `contains_caution_estimate` ✓ |
| `district_planning_signals` | NULL `health_need_score` | `Investigate (insufficient data)` action class |
| `facility_external_match` | rural Google-coverage bias | asymmetric NULL handling on `t_external_verification` |

**2. Handling — quarantine and recover, don't quietly clean.**

Modify `pipeline/facilities_curated.sql` to do two things at the silver layer:

- **Recover** the state from `address_stateOrRegion` for the 2,349 dirty rows by longest-suffix match against the canonical state vocabulary from the PIN directory (which carries the authoritative 37-state list as `statename`):

  ```sql
  WITH state_vocab AS (
    SELECT DISTINCT TRIM(statename) AS state_name,
                    LOWER(TRIM(statename)) AS state_key
    FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
    WHERE statename IS NOT NULL
  ),
  state_recovered AS (
    SELECT
      f.*,
      COALESCE(
        -- already canonical
        CASE WHEN LOWER(TRIM(f.address_stateOrRegion)) IN (SELECT state_key FROM state_vocab)
             THEN LOWER(TRIM(f.address_stateOrRegion)) END,
        -- longest-match recovery from address string
        (SELECT v.state_key FROM state_vocab v
         WHERE LOWER(' ' || COALESCE(f.address_stateOrRegion, '') || ' ')
               LIKE '%' || LOWER(' ' || v.state_name || ' ') || '%'
         ORDER BY length(v.state_name) DESC
         LIMIT 1)
      ) AS recovered_state_key,
      CASE
        WHEN f.unique_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'contaminated_shift'
        ELSE 'valid'
      END AS facility_row_quality
    FROM ... f
  )
  ```

  Then the projection emits `state_key = recovered_state_key` and `state_key_quality` with values `clean` / `recovered_from_address` / `missing` / `contaminated`. Longest-match-first prevents "Bengal" matching inside "West Bengal."

- **Quarantine**, do not delete. Column-shift rows stay in `facilities_curated` with `facility_row_quality = 'contaminated_shift'` and are excluded from `district_planning_signals` via `WHERE facility_row_quality = 'valid'`. The Brief page surfaces the count so the lineage story is visible.

NFHS suppressed and caution values stay NULL through the pipeline and feed `t_indicator_quality` as a penalty, never as a zero. This is already correct upstream — the new view must preserve it.

NFHS-5 age (2019–21 data, used in 2026): never silently treated as current. `source_period` rides every signal row into the API and into copilot prompts.

**3. Display — uncertainty per district, not at the bottom.**

Every row carries provenance into the UI:

- Action class color encodes uncertainty (Verify means "low trust; investigate before acting").
- Trust component bar in the drill-down panel names the weak component, not just a single opaque number.
- Per-district badges: "NFHS caution," "NFHS suppressed," "Ambiguous-PIN coverage X%," "Y/Z facilities Google-verified" inline next to the action class.
- Brief page header strip: "**88 facilities held back from analysis** — column-shift contamination flagged for FDR review. **2,349 facilities state-recovered** from address strings." Honest, defensible, on-message.
- Copilot prompts include `contains_caution_estimate`, `contains_suppressed_value`, ambiguous-PIN counts, and coordinate flags. Extend the prompt to require the model cite the specific weak component name when it explains the action class.

**4. Validation — make DQ regress-able.**

A new file `pipeline/dq_checks.sql` returning rows ONLY when an assertion fails. CI / pre-demo gate runs this and fails if anything returns rows. Includes:

- `district_planning_signals` row count = 706
- `evidence_trust_score IS NOT NULL` for all rows
- `recommended_action IS NOT NULL`
- Bihar's 38 NFHS districts all materialize
- `purbi/purba champaran` alias resolves (regression for our one known mismatch)
- Trust component stddev ≥ 5 across districts (would have caught `completeness_score` on day one)
- After Google enrichment runs: Bihar match rate ∈ [30%, 90%] (extremes both indicate bugs)

A second file `pipeline/dq_expectations.sql` codifies sanity expectations as queries that should return exactly the predicted rows: NITI Aspirational Districts in Bihar mostly land in `Verify` or `Build`; Patna does not land in `Verify`; Saharsa/Kishanganj/Jehanabad land in `Verify` with `t_facility_presence < 30`. Expectations are written *before* implementation, not derived from results.

A new endpoint `GET /api/quality/contamination` surfaces the counts so the Brief page can render them deterministically: `{ contaminated_shift, recovered_from_address, missing_state, ambiguous_pincodes, suppressed_nfhs_districts, caution_nfhs_districts }`.

### Out of scope

- Correcting upstream FDR contamination at the bronze layer (out of scope; flag and surface).
- String-matching reconciliation of district names beyond the one known `purbi/purba champaran` alias.
- NFHS-6 merge (separate effort; indicator definitions need per-indicator review).
- Machine-learning column-position recovery on the 88 shifted rows (deterministic patterns are clear, but a regex-based recovery would invent data; quarantine is more honest).

## Architecture

```
pipeline/district_planning_signals.sql
   ├── reads public.facilities_curated, public.pincode_geography, public.district_health_profiles
   ├── reads public.facility_external_match (LEFT JOIN; absent before enrichment runs)
   └── synced to Lakebase as public.district_planning_signals

scripts/enrich_places.ts (Node, one-shot, idempotent)
   ├── reads facilities (Bihar) from Lakebase via app SDK
   ├── Google Text Search → Place Details (basic SKU only, no reviews)
   ├── matches name fuzz + pincode equality + lat/long ≤500 m
   └── upserts chikitsa_app.facility_external_match (place_id, rating, user_rating_count, matched_at, match_confidence)

server/routes/chikitsa-routes.ts
   ├── /api/map/india (existing, refactored: SELECT from view)
   ├── /api/map/bihar (new: per-district planning signals + geo key)
   ├── /api/copilot/analyze (existing, evidence extended with planning-signals row)
   └── /api/copilot/reviews?facility_id=... (new: live Place Details fetch, no persistence)

client/src/pages/IndiaMapPage.tsx
   ├── existing India ADM1 ECharts choropleth
   ├── new: lazy-load india_districts_bihar.json on Bihar click
   ├── new: trust-adjustment toggle (color by action vs. desert_score)
   └── new: district drill-down side panel with trust component bar
```

## Data layer

### `pipeline/district_planning_signals.sql` (new)

A materialized view, one row per (state_key, district_key), keyed to NFHS-5 districts. Replaces the inline `DISTRICT_RANKING_SQL`. Columns:

- **Identifiers:** `state_name`, `state_key`, `district_name`, `district_key`, plus `district_geo_key = lower(state_key || '|' || district_key)` for client-side polygon match.
- **Need (0–100):** `health_need_score` — keep current formula (`(anaemia + underweight + (100 − ANC4) + (100 − insurance)) / 4`). Retain underlying NFHS percentages as columns. Districts with all-NULL key indicators get `need_score = NULL` and force `Investigate (insufficient data)`.
- **Facility evidence:** `facility_count`, `public_facility_count`, `private_facility_count`, `unknown_operator_count`, `geocoded_facility_count`, `flagged_facility_count` (current definition: bad coords OR capacity outlier OR invalid pin format), `places_matched_count` (from `facility_external_match` LEFT JOIN; 0 if enrichment hasn't run).
- **Trust components (each 0–100, higher = more trustworthy):**
  - `t_facility_presence` — saturating function `100 × (1 − exp(−facility_count / 3))`. 0 facilities → 0, 5+ → ~80, 10+ → ~96. The "absence of evidence" signal.
  - `t_geocoding` — 100 × geocoded_facility_count / NULLIF(facility_count, 0); NULL when facility_count = 0 (asymmetric: missing data does not penalize, a present-but-bad geocode does).
  - `t_pin_unambiguous` — 100 × share of joined facility rows whose PIN is `is_unambiguous`.
  - `t_flagged_inverse` — 100 × (1 − flagged_facility_count / NULLIF(facility_count, 0)); NULL when facility_count = 0.
  - `t_indicator_quality` — 100 minus 40 if `contains_suppressed_value`, minus 20 if `contains_caution_estimate`.
  - `t_external_verification` — 100 × places_matched_count / NULLIF(facility_count, 0). **NULL when facility_count = 0** (no facilities → no opinion). Even when enrichment hasn't run, this column exists as NULL for all districts and the weight redistribution rule below handles it cleanly.
- **Trust composite (0–100):** `evidence_trust_score` = weighted mean of NON-NULL components, weights renormalized over the present components. Default weights:
  - `t_facility_presence` 0.30
  - `t_geocoding` 0.15
  - `t_pin_unambiguous` 0.10
  - `t_flagged_inverse` 0.15
  - `t_indicator_quality` 0.15
  - `t_external_verification` 0.15
  Weights and the renormalization rule are documented in a SQL comment block.
- **Composites:**
  - `facility_scarcity_score` = `100 − LEAST(facility_count × 8, 100)` (carry forward existing semantics for visual continuity)
  - `desert_score` = `health_need_score × facility_scarcity_score / 100`
  - `trust_adjusted_score` = `desert_score × (0.65 + evidence_trust_score / 100 × 0.35)` (preserve existing formula shape; the *components* changed, the post-composition didn't)
- **Action class (text, priority order):**
  1. `Investigate` — `need_score IS NULL OR contains_suppressed_value AND key_indicators_null > 1`
  2. `Verify` — `evidence_trust_score < 50` (was 45; new components shift the distribution; tune at validation step)
  3. `Build` — `health_need_score >= 60 AND facility_scarcity_score >= 70 AND evidence_trust_score >= 60`
  4. `Upgrade` — `health_need_score >= 60 AND facility_scarcity_score < 45`
  5. `Improve access` — `health_need_score >= 50 AND facility_scarcity_score < 70`
  6. `Investigate` — fallback
- **Provenance:** `signals_version = 'v2-2026-06'`, `source_period = 'NFHS-5 (2019-2021)'`.

Bihar district-name fix: inside the join, `WHEN p.district_key = 'purbi champaran' THEN 'purba champaran'`. The single Bihar mismatch found in the probe.

### `chikitsa_app.facility_external_match` (new app-owned table)

```sql
CREATE TABLE IF NOT EXISTS chikitsa_app.facility_external_match (
  facility_id TEXT PRIMARY KEY,
  place_id TEXT,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_confidence TEXT NOT NULL CHECK (match_confidence IN ('high','medium','low','none')),
  rating DOUBLE PRECISION,
  user_rating_count INTEGER,
  google_maps_uri TEXT,
  match_method TEXT NOT NULL DEFAULT 'text_search_v1'
);
```

`place_id` may persist indefinitely per Google policy. `rating` and `user_rating_count` are aggregate stats (defensible; not review *content*). No review text persisted here.

### Sync

The new view must be picked up by Lakebase sync. The other three views are already there; check `databricks.yml` and either declare a `synced-table` resource or trigger a manual sync after deploy.

## Server layer

### Refactor `chikitsa-routes.ts`

- Remove the inline `DISTRICT_RANKING_SQL` block (lines 76–147). Replace usages in `/api/overview`, `/api/districts`, `/api/map/india`, `/api/copilot/analyze` with `SELECT * FROM public.district_planning_signals`. Filter by `state_key`/`district_key` and apply ORDER + LIMIT in the wrapping SQL.
- `/api/map/india` — keep state aggregation; add `district_action_breakdown` per state (counts per action class) so the side panel shows "5 Verify, 3 Build" etc.
- `/api/map/bihar` (new) — `SELECT *` from view filtered to `state_key='bihar'`, plus `places_matched_count`, returned with `district_geo_key`. Returns 38 rows.
- `/api/copilot/analyze` — extend the `evidence` payload with the planning-signals row(s) for the targeted district. Update the system prompt: "When citing the recommended action, name the trust component(s) with the lowest contribution. Do not invent components."
- `/api/copilot/reviews?facility_id=…` (new) — looks up `place_id` from `chikitsa_app.facility_external_match`. If present, calls Place Details with field mask `id,displayName,formattedAddress,rating,userRatingCount,reviews,googleMapsUri`, returns the response **with attribution metadata** (`{author_name, author_url, time, language, rating, text}` per review, plus `googleMapsUri` and a "© Google" attribution string). Caching: none. The endpoint always hits Google so policy compliance is unambiguous. Fail open (`{ reviews: [], reason: 'no_match' }`) if no match.
- Place Details from this endpoint **does** request the `reviews` field (Atmosphere SKU) — that's fine because it's per-user-click, not bulk.

### `scripts/enrich_places.ts` (new, one-shot)

Idempotent batch script. Run locally or as a one-time Databricks Job:

1. Read Bihar facilities (`SELECT facility_id, name, pincode, latitude, longitude FROM facilities_curated WHERE state_key = 'bihar'`).
2. For each, skip if already in `facility_external_match` with `match_confidence != 'none'`.
3. Call Google Places Text Search v1: `query = "{name} {pincode} India"`, `locationBias = circle(lat,long,5km)` if present.
4. From top result (`top_k = 1`), call Place Details with field mask **`id,displayName,formattedAddress,rating,userRatingCount,location`** (Pro SKU, no reviews → cheap).
5. Match scoring:
   - `high`: pincode in `formattedAddress` AND name fuzzy ≥ 0.7 AND lat/long Δ ≤ 500 m (when both have coords)
   - `medium`: pincode match OR (name fuzz ≥ 0.85 AND lat/long Δ ≤ 1 km)
   - `low`: name fuzz ≥ 0.85 only
   - `none`: otherwise — write a row with `place_id = NULL`, `match_confidence = 'none'` so we don't retry.
6. Upsert into `facility_external_match`.
7. Log a per-batch summary: `{matched_high, matched_medium, matched_low, none, errors}`.

API-key plumbing: `GOOGLE_PLACES_API_KEY` in `.env` and `databricks.yml` env. Free tier 1,000/month covers 258 × 2 = 516 calls comfortably.

Spot-check after first run: pull 20 random Bihar matches, verify by hand. The plan's success depends on the match table being correct.

## Client layer

### Extend `client/src/pages/IndiaMapPage.tsx`

Don't replace it. The state-level page is the demo opener. Add a Bihar drill mode:

- Add `mode: 'india' | 'bihar'` state.
- On India ADM1 click, if state is Bihar, set `mode = 'bihar'`; lazy `fetch('/geo/india_districts_bihar.json')`; `echarts.registerMap('bihar-adm2', biharGeoJson)`; switch chart series to `map: 'bihar-adm2'`.
- Add a top-bar toggle: "Trust adjustment" (off = color by `desert_score` / red ramp; on = color by `recommended_action` / categorical: Build=red, Verify=orange, Upgrade=yellow, Improve access=blue, Investigate=gray, Monitor not used). Both modes color the *same* map.
- Add a "Back to India" affordance. Keep the side card; in Bihar mode it shows the selected *district* drill-down: trust component bar (recharts horizontal stacked bar — recharts ships transitively via appkit-ui), `recommended_action` rule narration ("evidence_trust_score 31 < 50 → Verify"), Google match rate, and an "Open in Copilot" button that deep-links to `/copilot?state=bihar&district={key}`.
- Below the chart, add a one-line caption: "NFHS-5 (2019-21). Facility records discovered, not a complete provider inventory. Google Places matches surface independent corroboration."

### `client/public/geo/india_districts_bihar.json` (new)

DataMeet ADM2 → Bihar subset, simplified to ~0.001° tolerance. ~50 KB. Add `district_geo_key` to each feature's properties matching the SQL key, including the `purba champaran` alias. Document the source commit in a header comment in `scripts/build-bihar-geo.ts` (one-off).

### `CopilotPage.tsx` extensions

- Read `state` and `district` from URL query params on mount; pre-fill form.
- If `district` is set, fetch `/api/copilot/reviews?facility_id=…` for the top 3 facilities in the district and render a "Patient reviews from Google Maps" panel below the deterministic answer. Each review shows `author_name` (with `author_url` link), star rating, and review text, with a "© Google" footer and link to the Place's `googleMapsUri`. Reviews are not stored or cached — refetched every load. Label: "Unverified patient reports — directional only."

### New types in `chikitsa-types.ts`

```ts
export interface PlanningSignal {
  state_key: string; state_name: string;
  district_key: string; district_name: string;
  district_geo_key: string;
  health_need_score: number | null;
  facility_scarcity_score: number;
  desert_score: number | null;
  evidence_trust_score: number;
  trust_adjusted_score: number | null;
  recommended_action: InterventionAction;
  facility_count: number;
  public_facility_count: number;
  private_facility_count: number;
  unknown_operator_count: number;
  geocoded_facility_count: number;
  flagged_facility_count: number;
  places_matched_count: number;
  trust_components: {
    facility_presence: number;
    geocoding: number | null;
    pin_unambiguous: number | null;
    flagged_inverse: number | null;
    indicator_quality: number;
    external_verification: number | null;
  };
  contains_caution_estimate: boolean;
  contains_suppressed_value: boolean;
  signals_version: string;
}

export interface BiharMapResponse {
  districts: PlanningSignal[];
  freshness: string;
  geometry_url: string;
}

export interface CopilotReview {
  author_name: string;
  author_url: string | null;
  rating: number;
  language: string | null;
  publish_time: string;
  text: string;
}

export interface CopilotReviewsResponse {
  facility_id: string;
  place_id: string | null;
  google_maps_uri: string | null;
  attribution: string;            // "Reviews from Google Maps"
  reviews: CopilotReview[];
  reason?: 'no_match' | 'api_error';
}
```

## Files created

- `pipeline/district_planning_signals.sql`
- `pipeline/dq_checks.sql` — assertion queries that return rows only on failure
- `pipeline/dq_expectations.sql` — sanity expectations encoded as queries
- `chikitsa-copilot/scripts/enrich_places.ts`
- `chikitsa-copilot/scripts/build-bihar-geo.ts` (or a documented manual step)
- `chikitsa-copilot/client/public/geo/india_districts_bihar.json`

## Files modified

- `pipeline/facilities_curated.sql` — bronze→silver patch: add `state_vocab` CTE from PIN directory, longest-match state recovery from `address_stateOrRegion`, `state_key_quality` flag, `facility_row_quality` flag for column-shift rows. Preserves all existing transformations.
- `chikitsa-copilot/server/routes/chikitsa-routes.ts` — remove inline `DISTRICT_RANKING_SQL`; refactor `/api/map/india`, `/api/districts`, `/api/overview`, `/api/copilot/analyze` to `SELECT * FROM public.district_planning_signals`; add `/api/map/bihar`, `/api/copilot/reviews`, `/api/quality/contamination`; add `chikitsa_app.facility_external_match` create/migrate.
- `chikitsa-copilot/client/src/pages/IndiaMapPage.tsx` — add Bihar drill mode, trust toggle, district drill-down panel.
- `chikitsa-copilot/client/src/pages/CopilotPage.tsx` — read URL params; live reviews panel under the answer.
- `chikitsa-copilot/client/src/lib/chikitsa-types.ts` — add `PlanningSignal`, `BiharMapResponse`, `CopilotReview*`.
- `chikitsa-copilot/.env.example` — add `GOOGLE_PLACES_API_KEY`.
- `chikitsa-copilot/databricks.yml` — declare the new view as synced if necessary; add `GOOGLE_PLACES_API_KEY` to app env.
- `chikitsa-copilot/package.json` — add `node-fetch` (or rely on Node 22 native `fetch`); no map library needed (ECharts already in).

## Reuse notes

- **Don't redefine** `InterventionAction`, `actionLabels`, `actionVariant`, `biharFocusDistricts` — they live in `chikitsa-copy.ts` (`b8d1deb`) and are canonical.
- **Reuse `extractModelContent`** for the copilot review path's text framing.
- **Reuse `parseLimit`** for any new endpoints.
- **Reuse the existing ECharts container** in `IndiaMapPage.tsx`. The lookup helpers `normalizeMapName`, `buildBoundaryNameLookup`, `getBoundaryName` already handle name normalization — extend them for Bihar district names rather than rolling your own.
- **The current SQL's `flagged_facility_count`** semantics already include coordinate, capacity, and PIN-format flags — reuse for `t_flagged_inverse`.
- **`pincode_geography.is_unambiguous`** already powers all PIN joins; the new `t_pin_unambiguous` component just measures the per-district share.
- **AppKit-ui `Card`, `Badge`, `Button`** for the side panel; recharts `BarChart` for the trust component stacked bar (already a transitive dep).

## Verification

End-to-end checks before declaring the demo ready:

0. **Data quality gate.** Run `pipeline/dq_checks.sql` and `pipeline/dq_expectations.sql`. Both must return zero rows. If they don't, fix and re-run before any UI work. After the bronze→silver patch lands, also confirm: contaminated_shift count = 88, state-recovered count ~ 2,349, Bihar facility count unchanged at 258.

1. **SQL view.** Run the new SQL in Databricks SQL against the same UC catalog. 706 rows. Bihar slice shows non-null `evidence_trust_score` for all 38 districts. `recommended_action` distribution: Verify > Build > Upgrade > others. Spot-check Saharsa, Kishanganj, Jehanabad land in **Verify** with `t_facility_presence` < 30 (they have 0–3 facilities).
2. **Sensitivity.** Drop `t_external_verification` from the weight blend (set weight 0) in a one-off run; confirm results stay broadly stable (Bihar's zero-Google districts shouldn't cliff). If they cliff, the asymmetric NULL handling isn't working.
3. **Sanity.** NITI Aspirational Districts in Bihar (Araria, Begusarai, Sheikhpura, Sitamarhi, Banka, Nawada, Katihar, Khagaria, Purnia, Muzaffarpur, Jamui, Gaya, Aurangabad) — most should land in Verify or Build, almost none in Upgrade (Patna may, due to high facility count). Write expectations down before running.
4. **Lakebase sync.** Probe via the existing Databricks postgres OAuth flow; confirm `public.district_planning_signals` exists and matches warehouse row count.
5. **API.** `curl :8000/api/map/india` returns aggregated states. `curl :8000/api/map/bihar` returns 38 districts. `curl :8000/api/copilot/reviews?facility_id={a-known-bihar-place_id}` returns up to 5 reviews with attribution; `curl …?facility_id={no-match}` returns `{ reviews: [], reason: 'no_match' }`.
6. **Enrichment.** Run `npx tsx scripts/enrich_places.ts`. Logs report match counts. Spot-check 20 random Bihar matches by hand. Match rate ≥ 50% on private hospitals in Patna (most likely to be in Google Maps). Match rate < 30% on Saharsa/Kishanganj — that gap is the demo's evidence, not a bug.
7. **UI.** `npm run dev`. On `/map`:
   - National view loads.
   - Click Bihar — drill-in animates; district choropleth renders.
   - Trust toggle visibly recolors Saharsa/Kishanganj/Jehanabad.
   - Click Saharsa — side panel shows trust component bar dominated by low `t_facility_presence`, action class **Verify**, "1 of 3 facilities verified by Google."
   - "Open in Copilot" deep-links and prefills.
8. **Copilot deep-link.** With `?state=bihar&district=saharsa` set, the page pre-fills "What action should the government investigate first for Saharsa?", retrieves planning signals, and the model answer cites the specific trust component(s) driving the Verify class. The Reviews panel shows up to 5 reviews with author + Google link, or a polite empty state.
9. **Compliance.** Review responses include `attribution: "Reviews from Google Maps"`, link `googleMapsUri`, and are not written to any database. Verify by inspecting the route handler and the cleared response cache.
10. **Type-check + lint + smoke test.** `npm run typecheck && npm run lint && npm run test:smoke` clean.
11. **Demo dry run.** Walk the seven-step `HACKATHON_CONCEPT.md` flow end-to-end in under 4 minutes.

## Risks and mitigations

- **Sync lag.** New view may not show in Lakebase immediately. Mitigation: trigger sync explicitly; add a fallback that runs the same SQL server-side against the UC warehouse if Lakebase view is missing at demo time.
- **Bihar district-polygon naming drift.** Single known mismatch is `purbi/purba champaran`. Mitigation: log unmatched `district_geo_key`s on first render and add to the alias map. Total Bihar mismatches expected to be ≤ 2.
- **Action threshold tuning.** New components shift the distribution; the `< 50` Verify cutoff is a guess. Mitigation: at step 1 of validation, dump the Bihar histogram of `evidence_trust_score` and tune the cutoff to match the Aspirational-district expectation. Tune in SQL, not in TS.
- **Google match urban bias.** Patna will look fine, Saharsa/Kishanganj will look thin in matches. Mitigation: asymmetric NULL handling (zero facilities → NULL component → renormalized weights). UI label: "Independent corroboration where Google has coverage." Make the bias the *story*, not a bug.
- **Google API cost overrun.** 258 × 2 = 516 calls fits free tier with margin. Place Details with reviews on copilot drilldown is per-click. Mitigation: rate-limit the reviews endpoint (1 call/s/IP) and cache the deterministic copilot answer in the Copilot page so repeated questions don't re-fetch reviews.
- **Time.** Build order: (1) bronze→silver DQ patch in `facilities_curated.sql` + dq_checks/expectations + `/api/quality/contamination`, (2) `district_planning_signals.sql` + sync + thin SELECT in routes, (3) Bihar drill UI + trust toggle, (4) drill-down panel, (5) enrichment script + match table, (6) `t_external_verification` wired in, (7) live reviews endpoint + Copilot panel, (8) deep-link. Steps 1–5 are the demo's minimum viable arc. Stop adding scope past step 5 if any earlier step blew through its budget.
