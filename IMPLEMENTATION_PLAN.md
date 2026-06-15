# Chikitsa — Geographic-desert map, Evidence-Confidence rebuild, Google Places enrichment

> **Scope note.** Everything in this plan is national. Bihar is the demo's opening anecdote because the FDR registry there is clean (258/258 valid rows) and the Aspirational Districts narrative is sharp, but no SQL view, endpoint, or UI is hard-bound to Bihar. The map drill accepts whichever state the user clicks. Data flows through the same pipeline regardless of state.

## Context

The hackathon repo evolved while this plan was being drafted. Two upstream commits (`9782ab9` "Focus Chikitsa MVP on evidence confidence" and `49c908a` "Add India healthcare desert map") materially change what needs to be built:

- **Map already exists.** `client/src/pages/IndiaMapPage.tsx` renders a state-level (ADM1) choropleth using **ECharts via `echarts-for-react`** (already in `package.json`), with `client/public/india-adm1.json` (geoBoundaries ADM1, 36 features, 4.9 MB) registered as the basemap. Library decision is made — Leaflet is out, ECharts is in. Click-a-state shows a side card with top-district scores; the API is `/api/map/india`.
- **Trust composite + action class are already implemented in SQL** — but inline in `server/routes/chikitsa-routes.ts` (`DISTRICT_RANKING_SQL`, lines 76–147). Outputs: `health_need_score`, `facility_scarcity_score`, `desert_score`, `evidence_trust_score`, `trust_adjusted_score`, `recommended_action ∈ {build, verify, upgrade, improve_access, investigate}`.
- **Brand is planner-facing, Bihar-default.** Nav is "Brief / Map / Evidence / Actions / Copilot." `AGENTS.md` forbids treating public/private ownership as Evidence Confidence (it's context, not trust). `HACKATHON_CONCEPT.md` standardizes the action class names and the demo flow. Bihar is the *opening example*, not a hardcoded scope; the system accepts any state.
- **`InterventionAction` enum and `actionLabels`/`actionVariant`/`biharFocusDistricts` are canonical** in `client/src/lib/chikitsa-copy.ts` and `chikitsa-types.ts`. Don't redefine these.
- **Plans page is action-typed.** The `interventions` table has an `action_type` column with an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migration.

What still needs to happen for the demo to land:

1. **A desert is a place, not a district.** The current map encodes "desert" as district color — that smuggles in two false assumptions: (a) deserts align with administrative boundaries, and (b) `facility_count` per district is a uniform measure of access. Both are wrong: people don't stop needing care at a district line, and 5 facilities in one Patna ward is not the same as 5 facilities spread across Saharsa. Healthcare access in the literature is a **catchment** problem (isochrones / WHO "30-minute travel time"). The Map needs to encode coverage as **physical-space circles around each facility**, with the *complement* being the actual desert. NFHS demand-side data stays district-grain (it's surveyed at district), but supply-side coverage moves to facility-buffer geometry.
2. **District drill** is still part of the plan but as the *demand* substrate (NFHS need shading), not the desert encoding. The desert is the geometric gap.
3. **Evidence Confidence is built on a noise component.** The probe showed `completeness_score` is 7/7 for 98.8% of facilities, so `evidence_trust_score = avg_completeness/7 × 100` is essentially 100 for every district minus penalties. The trust toggle will appear to do little visible work today. We need to drop completeness and rebuild from signals that actually vary, and we need the trust toggle to do *geometric* work — distrusted facilities cover less ground.
4. **Lift trust SQL into the pipeline.** Per `AGENTS.md`'s framing of medallion lineage, the trust composite belongs as a versioned `pipeline/district_planning_signals.sql` synced to Lakebase, with the API route doing a thin `SELECT *`.
5. **Independent corroboration is missing.** Every component of today's Evidence Confidence is internal data quality. Adding a *third-party* verification axis — Google Places match — turns Evidence Confidence from "is this dataset clean?" into "does this place exist outside our registry?", which is the planner question that actually matters.
6. **Google Places must be added carefully.** Match counts and `place_id` may persist; review *content* may not. Coverage is biased toward urban areas, so it must be **asymmetric** — a match raises confidence, absence does not lower it (else we re-introduce the urban bias the project is meant to expose).

The intended outcome: a planner opens `/map`, sees an India choropleth shaded by state-level desert signal, clicks any state, and drills into a three-layer stack on the same canvas — (1) district choropleth shaded by NFHS *need*, (2) facility-buffer coverage as a green wash whose union defines "covered" land, (3) facility points colored by operator type. The desert is whatever red district shows through the green wash. **Toggling "Trust adjustment" shrinks each circle by `evidence_trust_score / 100`** — distrusted facilities cover less ground, so the visible desert *grows*. Population-weighted statistics in the corner answer "how many people live in the desert?" In the Bihar demo, Saharsa, Kishanganj, Jehanabad become visibly empty regions; in any other state the same logic applies — the system has no Bihar-specific code. The side panel cites the spatial fraction (`37% of this district lies >10 km from any facility, of which 78% has trust < 50 → Verify`). The Copilot answers "why this action class" using the same numbers shown on the map, including a "Live patient reviews" panel that pulls Google Place Details with attribution at request time.

## Scope

**In:**

1. New `pipeline/facility_coverage_h3.sql` materialized view: per-facility H3 cells covering a 10 km buffer (using Databricks built-in `h3_pointash3` + `h3_kring`), one row per (facility_id, state_key, h3_index, ring_distance, distance_km). National scope: ~9,989 valid facilities × ~217 r7 hexes per ring = ~2.2 M rows. Cheap in Databricks SQL.
2. New `scripts/build_population_grid.py` + `pipeline/population_grid_h3.sql`: WorldPop India 2020 1 km raster pre-binned to H3 r6, one row per (h3_index, state_key, population). National Delta table; ~600 k hexes covering all of India. ~80 MB raster input downloaded once; build job runs in 10–15 min.
3. New `pipeline/desert_grid.sql`: joins coverage hexes ⊕ population, returns one row per H3 r6 cell with `is_covered`, `is_covered_trust_adjusted`, `population`, `nearest_facility_id`, `nearest_facility_distance_km`, `district_key`, `state_key`. This is the desert geometry. National in storage; endpoints filter on `state_key`.
4. New `pipeline/district_planning_signals.sql`: 706 district rows (national), need + trust + action class, plus spatial columns — `desert_area_pct`, `desert_population`, `desert_population_pct` and trust-adjusted variants — derived from `desert_grid`.
5. Trust formula rebuilt with components that vary; `completeness_score` removed; ownership remains a context column not a trust input.
6. Map UI rewrite: when the user clicks any state on the India choropleth, drill into a layered view of that state — facility-buffer coverage layer (H3 hex polygons), district need-choropleth underneath, facility points on top, "Trust adjustment" toggle that re-renders using the trust-adjusted desert flag in the same payload. Population-weighted desert stat in the corner.
7. District drill-down side panel: trust component stacked bar, action class with rule narration, **spatial fraction citation** ("X% of district area / Y% of district population is >10 km from any facility"), Google match rate, link into Copilot.
8. Google Places enrichment for **all 9,989 valid facilities nationally**: one-shot `scripts/enrich_places.ts` populates `chikitsa_app.facility_external_match`. New `t_external_verification` trust component, asymmetric (NULL when no facilities; never penalizes rural absence).
9. Live reviews path: `GET /api/copilot/reviews?facility_id=…` calls Place Details per request, returns reviews + attribution, never persists content.
10. Server routes: `/api/map/india` (existing, refactored to thin SELECT); new `/api/map/state/:state_key/coverage` returns the H3 desert grid for that state; new `/api/map/state/:state_key/districts` returns district planning signals for that state; `/api/map/state/:state_key/facilities` returns the facility scatter rows; `/api/copilot/analyze` evidence extended with the planning-signals row plus the spatial fraction.
11. Move `DISTRICT_RANKING_SQL` from inline TS into a thin `SELECT * FROM public.district_planning_signals` once the view is synced.

**Out:**

- Travel-time isochrones via routing (no road graph; we use **Euclidean buffers** and label them as such).
- Persisting Google review content.
- Slider-tunable trust weights.
- Point-in-polygon recompute (PIN-based assignment is acceptable per `AGENTS.md`; one-line spelling alias for `purbi/purba champaran` is the only fix; other states' analogous mismatches are caught by the unmatched-key log on first render).
- GDP/political/constituency overlays.
- Per-facility-type variable buffer radius (10 km flat; sub-center vs. district hospital tiers are a stretch goal).

## Data Quality Strategy

The pipeline already does substantial silver-layer work in `pipeline/facilities_curated.sql` — dedup by `unique_id`, null-byte stripping (`REPLACE(col, CHAR(0), '')`), snake_case rename, type coercion via `TRY_CAST`, PIN regex normalization, and computed quality flags (`coordinate_quality`, `pincode_quality`, `capacity_outlier_flag`, `completeness_score`). These are *labels* on the data, not corrections to it.

What the Lakebase probe revealed that this strategy must address:

**Column-shift contamination (88 rows, 0.87%).** A class of rows where the FDR GenAI extraction emitted fields off by N positions. Symptoms: `facility_id` contains text fragments instead of UUIDs (e.g. `"  *  __Oncology"`, `"Currently"`, an email address); the row's `name` column then contains the *specialties JSON array*; `state_or_region` contains a *GeoJSON Point* string; `country` contains a *latitude as text*; `pincode` contains the *longitude with the decimal stripped* (e.g. `"11009271621704102"`); the real `latitude`/`longitude` numeric columns are NULL because the values landed in country/pincode. These rows aren't partially bad — they're entirely scrambled. They survive the silver layer because dedup runs on `unique_id` and the cleaning ops are per-column.

**Address-as-state contamination (2,349 rows, 23%).** Rows with valid UUIDs but where `state_or_region` carries a full address (`"Pallikulam, Post Chirakkal, Kannur District, Kerala"`) instead of the bare state name. The current silver step lowercases and trims this verbatim into `state_key`, so the join key is dirty. Today's API filters by `state_key = $1` silently drop these rows — they don't fail, they vanish. The contamination concentrates in Kerala, Tamil Nadu, and a long tail of states with verbose source addresses; Bihar happens to be clean, which is why it's a good demo opener but is not the project's scope.

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
scripts/build_population_grid.py (one-shot, Databricks notebook)
   ├── reads WorldPop India 2020 1km GeoTIFF (offline download, ~80MB)
   ├── reprojects to EPSG:4326, samples each pixel centroid to H3 r6
   ├── aggregates SUM(population) per hex
   └── writes Delta table public.population_grid_h3 (h3_index, state_key, population)

pipeline/facility_coverage_h3.sql (new, national)
   ├── reads public.facilities_curated WHERE coordinate_quality='plausible_india'
   │   AND facility_row_quality='valid'  (no state filter)
   ├── h3_longlatash3(longitude, latitude, 7) → home hex
   ├── h3_kring(home_hex, k=8) → ~10km buffer (r7 hex edge ~1.2km × 8 ≈ 9.6km)
   └── synced to Lakebase as public.facility_coverage_h3
       columns: facility_id, state_key, h3_index, distance_km

pipeline/desert_grid.sql (new, national)
   ├── reads public.facility_coverage_h3, public.population_grid_h3
   │   plus public.facility_external_match (for trust-aware variant)
   ├── computes per H3 r6 cell (state-keyed):
   │     is_covered (any facility hex within k=8 at base trust)
   │     is_covered_trust_adjusted (using trust_scaled_radius)
   │     population, nearest_facility_id, nearest_facility_distance_km
   │     district_key (point-in-hex centroid via PIN-resolved nearest facility)
   │     state_key
   └── synced to Lakebase as public.desert_grid

pipeline/district_planning_signals.sql (new, national 706 rows)
   ├── reads district_health_profiles, pincode_geography, facilities_curated
   ├── reads facility_external_match (LEFT JOIN)
   ├── reads desert_grid GROUP BY district_key for spatial fractions
   └── synced to Lakebase as public.district_planning_signals
       (now includes desert_area_pct, desert_population, desert_population_pct,
        and trust-adjusted variants)

scripts/enrich_places.ts (Node, one-shot, idempotent, --state flag)
   ├── reads facilities from Lakebase (default: all valid; --state filter optional)
   ├── Google Text Search → Place Details (basic SKU only, no reviews)
   └── upserts chikitsa_app.facility_external_match

server/routes/chikitsa-routes.ts
   ├── /api/map/india (existing, refactored: SELECT from district_planning_signals)
   ├── /api/map/state/:state_key/districts (new: districts for that state)
   ├── /api/map/state/:state_key/coverage (new: H3 desert hexes for that state,
   │     both base + trust-adjusted flags in same payload)
   ├── /api/map/state/:state_key/facilities (new: facility scatter rows)
   ├── /api/copilot/analyze (existing, evidence extended with planning-signals + spatial fraction)
   └── /api/copilot/reviews?facility_id=... (new: live Place Details fetch, no persistence)

client/src/pages/IndiaMapPage.tsx
   ├── existing India ADM1 ECharts choropleth (mode='india')
   ├── on any state click, mode='state' with selected state_key; parallel fetch:
   │     /api/map/state/{state_key}/districts (need shading)
   │     /api/map/state/{state_key}/coverage  (both flags in one response)
   │     /api/map/state/{state_key}/facilities
   │     /geo/states/{state_key}.json  (district boundaries; lazy per-state)
   ├── ECharts compound: geo basemap + 3 series (district choropleth, hex coverage,
   │     facility scatter); trust toggle flips render flag, no refetch
   ├── corner stat panel: 'X% of land / Y million people in desert at base trust;
   │     X'% / Y' million when trust-adjusted'
   └── side panel for selected district: trust component bar, spatial fraction,
       facility breakdown, Google match rate, Open in Copilot
```

## Data layer

### `scripts/build_population_grid.py` (one-shot Databricks notebook)

WorldPop India 2020 100m raster is the canonical population dataset for India (publicly available, peer-reviewed). For the demo we downsample to 1km and bin to H3 r6 (~36 km² hex), nationally.

Steps:
1. Download `IND_pop_2020_v3_1km.tif` (~80 MB) from `https://hub.worldpop.org/geodata/listing?id=70`. Pin URL in a header comment.
2. Use `rasterio` + `h3` Python libs to iterate every non-zero raster pixel across India, compute `h3.geo_to_h3(lat, lon, 6)` for each pixel centroid, sum populations per hex.
3. Resolve `state_key` per hex via point-in-polygon against the existing `india-adm1.json` (geoBoundaries ADM1, already in the repo). Hexes whose centroid falls outside any state polygon get `state_key = NULL` and are dropped.
4. Write Delta table `public.population_grid_h3 (h3_index STRING, state_key STRING, population DOUBLE, source STRING DEFAULT 'WorldPop2020')` clustered by `state_key, h3_index`.
5. Sanity check: `SUM(population)` should land within 5% of India's 2020 estimate (~1.38 billion). Per-state totals should match the 2011 census × known growth multipliers within 10%. Bihar specifically should be in [115M, 135M].

National output: ~600 k r6 hexes covering India. Build runs once on a Databricks notebook in 10–15 minutes; the resulting Delta table is small (~30 MB) and queries fast.

### `pipeline/facility_coverage_h3.sql` (new, national)

Per-facility geographic coverage at base trust (10 km flat radius). Uses Databricks SQL's built-in H3 functions. National scope; the only filter is on data quality.

```sql
CREATE OR REFRESH MATERIALIZED VIEW facility_coverage_h3
COMMENT 'H3 hex coverage for each facility at 10km Euclidean buffer (k-ring approximation). National.'
CLUSTER BY (state_key, facility_id)
AS
WITH facilities_geo AS (
  SELECT facility_id, latitude, longitude, state_key
  FROM facilities_curated
  WHERE coordinate_quality = 'plausible_india'
    AND facility_row_quality = 'valid'
    AND latitude IS NOT NULL AND longitude IS NOT NULL
),
home_hex AS (
  SELECT
    facility_id, state_key, latitude, longitude,
    h3_longlatash3(longitude, latitude, 7) AS home_h3
  FROM facilities_geo
),
ring_hexes AS (
  SELECT
    h.facility_id, h.state_key, h.home_h3,
    explode(h3_kring(h.home_h3, 8)) AS h3_index
  FROM home_hex h
)
SELECT
  facility_id,
  state_key,
  h3_index,
  -- approximate distance: hex r7 edge ~1.22 km; ring distance × edge ≈ km
  h3_distance(home_h3, h3_index) * 1.22 AS distance_km
FROM ring_hexes;
```

National sizing: ~9,989 valid facilities × 217 r7 hexes per k=8 ring = ~2.2 M rows. Materializes in seconds in Databricks SQL. Endpoints filter by `state_key`.

About the radius choice: r7 hexes have ~1.22 km edge length; k=8 covers ~9.8 km. We label this "10 km Euclidean" in the UI and cite WHO's "30-minute travel time" guidance with the disclaimer that we don't have road graph. Reviewer-defensible.

### `pipeline/desert_grid.sql` (new, national)

This is the desert geometry. One row per H3 r6 cell across India, with `is_covered` flags at base trust and trust-adjusted, plus the population. National in storage; endpoints filter by `state_key`.

```sql
CREATE OR REFRESH MATERIALIZED VIEW desert_grid
COMMENT 'Per-hex covered/desert flags for India at base and trust-adjusted radii.'
CLUSTER BY (state_key, district_key)
AS
WITH r6_universe AS (
  -- All r6 hexes that overlap Bihar; derived from population grid presence
  SELECT DISTINCT h3_index AS h3_r6
  FROM population_grid_h3
),
coverage_at_base AS (
  -- a r6 hex is "covered" if any r7 facility hex is its child or shares a parent ring
  SELECT
    h3_index_to_parent(c.h3_index, 6) AS h3_r6,
    MIN(c.distance_km) AS min_distance_km,
    ARRAY_AGG(DISTINCT c.facility_id) AS reaching_facilities
  FROM facility_coverage_h3 c
  GROUP BY h3_index_to_parent(c.h3_index, 6)
),
trust_per_facility AS (
  SELECT
    f.facility_id,
    f.latitude, f.longitude,
    h3_longlatash3(f.longitude, f.latitude, 7) AS home_h3,
    -- trust-scaled radius: 10km × evidence_trust/100, floor at 3km
    GREATEST(3.0, 10.0 * COALESCE(d.evidence_trust_score, 50) / 100.0) AS trust_radius_km
  FROM facilities_curated f
  LEFT JOIN district_planning_signals d
    ON LOWER(f.state_key) = d.state_key
   AND -- district resolved via PIN; see joinish CTE in district_planning_signals.sql
       1=1
  WHERE f.coordinate_quality = 'plausible_india' AND f.facility_row_quality = 'valid'
),
coverage_trust_adjusted AS (
  -- trust-radius rings: ceil(trust_radius / 1.22 km) k-ring
  SELECT
    h3_index_to_parent(explode(h3_kring(t.home_h3, CAST(CEIL(t.trust_radius_km / 1.22) AS INT))), 6) AS h3_r6,
    t.facility_id
  FROM trust_per_facility t
)
SELECT
  u.h3_r6 AS h3_index,
  COALESCE(p.population, 0) AS population,
  EXISTS (SELECT 1 FROM coverage_at_base b WHERE b.h3_r6 = u.h3_r6) AS is_covered,
  EXISTS (SELECT 1 FROM coverage_trust_adjusted t WHERE t.h3_r6 = u.h3_r6) AS is_covered_trust_adjusted,
  (SELECT min_distance_km FROM coverage_at_base b WHERE b.h3_r6 = u.h3_r6) AS nearest_facility_distance_km,
  -- district_key: lookup via h3 cell centroid
  -- (point-in-polygon with district boundaries is the canonical way; for the demo we
  --  resolve via PIN→district lookup of the home pincode using the closest-facility hex,
  --  with state-level fallback)
  ...  -- elaborated in implementation
FROM r6_universe u
LEFT JOIN population_grid_h3 p ON u.h3_r6 = p.h3_index;
```

Open implementation question (resolve at step 1 of build): the cleanest district assignment per hex is point-in-polygon against DataMeet ADM2. If the polygon GeoJSON is loaded into Lakebase as a Delta table with PostGIS-equivalent functions, we can do `ST_Contains`. If not, fallback: district = MAX-vote of nearest-facility's PIN-resolved district. Either way, document the choice.

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
  - `desert_score` = `health_need_score × facility_scarcity_score / 100` (legacy / district-level; retained for ranking sortability)
  - `trust_adjusted_score` = `desert_score × (0.65 + evidence_trust_score / 100 × 0.35)`
- **Spatial fractions (new, district-grain aggregates of `desert_grid`):**
  - `desert_area_pct` = 100 × COUNT(hex WHERE NOT is_covered) / COUNT(hex), at base trust
  - `desert_area_pct_trust_adjusted` = same with `is_covered_trust_adjusted`
  - `desert_population` = SUM(population) where NOT is_covered
  - `desert_population_pct` = 100 × desert_population / SUM(population)
  - `desert_population_trust_adjusted` and `desert_population_pct_trust_adjusted` = trust-adjusted variants
  - These are *the* numbers cited in the side panel and copilot prompts; the legacy `desert_score` is for list sorting only.
- **Action class (text, priority order). Now uses spatial fractions instead of district facility_count:**
  1. `Investigate` — `need_score IS NULL OR (contains_suppressed_value AND key_indicators_null > 1)`
  2. `Verify` — `evidence_trust_score < 50` (tune at validation; new components shift distribution)
  3. `Build` — `health_need_score >= 60 AND desert_population_pct >= 40 AND evidence_trust_score >= 60`
  4. `Improve access` — `health_need_score >= 50 AND desert_population_pct >= 25 AND desert_population_pct < 40`
  5. `Upgrade` — `health_need_score >= 60 AND desert_population_pct < 25`
  6. `Investigate` — fallback
  
  Build now means "high need AND a large fraction of district *population* (not just area) is in a desert AND we trust the evidence." Improve access is the marginal-coverage case. Upgrade is the high-need-but-already-served case.
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
- `/api/map/state/:state_key/districts` (new) — `SELECT *` from `district_planning_signals` filtered to the requested state, plus `places_matched_count` and the spatial fractions, returned with `district_geo_key`. Row count varies (Bihar 38, Uttar Pradesh 75, Goa 2). Used for the need-shading choropleth and the district side panel. The `:state_key` is validated against the canonical NFHS state list before query (rejects junk inputs).
- `/api/map/state/:state_key/coverage` (new) — returns the H3 desert grid for the requested state. Response shape: `{ resolution: 6, base_radius_km: 10, state_key, hexes: [{ h3_index, is_covered, is_covered_trust_adjusted, population, nearest_facility_distance_km, district_key }], totals: {...} }`. Hex counts per state range from ~50 (small UTs) to ~30k (Rajasthan); payload from a few KB to ~1 MB uncompressed (~200 KB gzipped). Both flags ship in every response so the trust toggle is instant on the client. Cache headers `Cache-Control: max-age=300` since the underlying view changes only on pipeline refresh.
- `/api/map/state/:state_key/facilities` (new, lightweight) — `SELECT facility_id, name, latitude, longitude, operator_type, places_matched ...` filtered to the requested state. Used for the scatter overlay.
- `/api/copilot/analyze` — extend the `evidence` payload with the planning-signals row(s) for the targeted district AND the spatial-fraction summary. Update the system prompt: "When citing the recommended action, name the trust component(s) with the lowest contribution AND the spatial fraction (X% of district area / Y% of population in desert at >10 km from any facility). Do not invent components or make up percentages."
- `/api/copilot/reviews?facility_id=…` (new) — looks up `place_id` from `chikitsa_app.facility_external_match`. If present, calls Place Details with field mask `id,displayName,formattedAddress,rating,userRatingCount,reviews,googleMapsUri`, returns the response **with attribution metadata** (`{author_name, author_url, time, language, rating, text}` per review, plus `googleMapsUri` and a "© Google" attribution string). Caching: none. The endpoint always hits Google so policy compliance is unambiguous. Fail open (`{ reviews: [], reason: 'no_match' }`) if no match.
- Place Details from this endpoint **does** request the `reviews` field (Atmosphere SKU) — that's fine because it's per-user-click, not bulk.

### `scripts/enrich_places.ts` (new, one-shot, national)

Idempotent batch script. Run locally or as a one-time Databricks Job. Enriches every valid facility nationally.

1. Read facilities (`SELECT facility_id, name, pincode, latitude, longitude, state_key FROM facilities_curated WHERE coordinate_quality = 'plausible_india' AND facility_row_quality = 'valid'`). Optional `--state <key>` flag scopes to one state for re-runs; default is all valid facilities (~9,989).
2. For each, skip if already in `facility_external_match` with `match_confidence != 'none'`.
3. Call Google Places Text Search v1: `query = "{name} {pincode} India"`, `locationBias = circle(lat,long,5km)` if present.
4. From top result (`top_k = 1`), call Place Details with field mask **`id,displayName,formattedAddress,rating,userRatingCount,location`** (Pro SKU, no reviews → cheap).
5. Match scoring:
   - `high`: pincode in `formattedAddress` AND name fuzzy ≥ 0.7 AND lat/long Δ ≤ 500 m (when both have coords)
   - `medium`: pincode match OR (name fuzz ≥ 0.85 AND lat/long Δ ≤ 1 km)
   - `low`: name fuzz ≥ 0.85 only
   - `none`: otherwise — write a row with `place_id = NULL`, `match_confidence = 'none'` so we don't retry.
6. Upsert into `facility_external_match`.
7. Log a per-batch and per-state summary: `{state_key, matched_high, matched_medium, matched_low, none, errors}`.

API-key plumbing: `GOOGLE_PLACES_API_KEY` in `.env` and `databricks.yml` env. National volume: ~9,989 × 2 ≈ 20 k calls. Cost is not a constraint per user direction; expect rate-limit retries (script has built-in exponential backoff).

Spot-check after first run: pull 20 random matches across at least 5 states, verify by hand. Per-state match-rate distribution is itself a finding — high-match states are well-indexed in Google, low-match states are independent corroboration of the data desert thesis.

## Client layer

### Extend `client/src/pages/IndiaMapPage.tsx`

Don't replace it. The state-level page is the demo opener. Add a generic state-drill mode that renders the desert as geometry, not as district color, and works for any state the user clicks:

- Add `mode: 'india' | 'state'` and `selectedState: string | null`.
- On any India ADM1 click, set `mode = 'state'`, `selectedState = stateKey`, and fan out four parallel fetches:
  - `/api/map/state/{state_key}/districts` (district need shading + side panel)
  - `/api/map/state/{state_key}/coverage` (H3 hexes; both flags in one payload)
  - `/api/map/state/{state_key}/facilities` (scatter points)
  - `/geo/states/{state_key}.json` (district boundaries for that state, lazy-loaded)
- Build a single ECharts compound chart with stacked series:
  1. **Selected-state district choropleth (bottom layer)** — `type: 'map'`, registered map `state-adm2-{state_key}`, `data` = districts, `visualMap` = sequential muted-red ramp on `health_need_score`. This is the demand-side substrate.
  2. **H3 desert hex overlay (middle layer)** — `type: 'custom'` series rendering H3 hexes as polygons. Each hex's polygon vertices come from `h3-js`'s `cellToBoundary(h3_index)` (add `h3-js` dependency, ~30 KB). Hexes with `is_covered = true` (or `is_covered_trust_adjusted` when toggle on) → not rendered. Hexes with `is_covered = false` → semi-transparent red, opacity scaled by `population` (more populated desert = more visible). The desert is the union of these red hexes.
  3. **Facility scatter (top layer)** — `type: 'scatter'`, coordinates from `facilities`, `symbolSize` 6, color by operator_type (public=teal, private=plum, unknown=gray).
- Top-bar toggle: **"Trust adjustment"**. Switches the desert layer between `is_covered` and `is_covered_trust_adjusted`. The hexes visibly grow/shrink — a transition animation (`animationDurationUpdate: 800`) carries the eye through the change. Corner stat panel updates in lockstep, parameterized by selected state: "{State} at base trust: **X% of land area (Y million people) >10 km from any facility.** With trust adjustment: **X'% / Y' million.**" The numbers are pre-computed in the `totals` field of the coverage response so the toggle is instant.
- Add a "Back to India" affordance.
- Side card (in state mode, when a district is selected by clicking either the choropleth or a facility point):
  - Action class badge.
  - **Spatial fraction citation** as a single visible line: "37% of district area / 51% of district population is >10 km from any facility (base trust). With trust-adjustment: 58% / 71%."
  - Trust component bar (recharts horizontal stacked bar; recharts ships transitively via appkit-ui).
  - Need composition (NFHS percentages with caution/suppressed badges).
  - Facility breakdown by operator_type. Flag "0 public facilities" in red if applicable.
  - Google match rate.
  - "Open in Copilot" button → `/copilot?state={state_key}&district={district_key}`.
- Below the chart, a single-line caption: "Coverage shown as 10 km Euclidean buffer (WHO 30-min guidance, no road graph used). NFHS-5 (2019-21). Facility records discovered, not a complete provider inventory. Population from WorldPop India 2020."

Performance notes:
- Mid-size states (Bihar 3.2k, Gujarat 5k hexes): renders in ~50 ms desktop.
- Largest states (Rajasthan ~30k, Madhya Pradesh ~22k hexes): pre-filter on the server to hexes where `population > 0 OR NOT is_covered_trust_adjusted` (drops empty desert+covered cells in unpopulated regions). This roughly halves payload and render cost.
- On mobile, additionally apply a viewport-based cull when zoomed in; show full state at low zoom only.

State-level GeoJSON: rather than ship a single 4.9 MB India-ADM2 file, we split per-state under `client/public/geo/states/{state_key}.json` (each ~50–500 KB) and lazy-load the one needed by the current drill. `scripts/build-state-geo.ts` slices the DataMeet ADM2 source into 36 state files in one pass.

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
  // spatial fractions (new):
  desert_area_pct: number;
  desert_area_pct_trust_adjusted: number;
  desert_population: number;
  desert_population_pct: number;
  desert_population_trust_adjusted: number;
  desert_population_pct_trust_adjusted: number;
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

export interface DesertHex {
  h3_index: string;
  is_covered: boolean;
  is_covered_trust_adjusted: boolean;
  population: number;
  nearest_facility_distance_km: number | null;
  district_key: string | null;
}

export interface StateCoverageResponse {
  state_key: string;
  resolution: 6;
  base_radius_km: 10;
  hexes: DesertHex[];
  totals: {
    total_population: number;
    desert_population_base: number;
    desert_population_trust_adjusted: number;
    total_area_hexes: number;
    desert_area_hexes_base: number;
    desert_area_hexes_trust_adjusted: number;
  };
}

export interface StateFacility {
  facility_id: string;
  name: string;
  latitude: number;
  longitude: number;
  operator_type: 'public' | 'private' | 'unknown' | null;
  places_matched: boolean;
}

export interface StateDistrictsResponse {
  state_key: string;
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

- `pipeline/facility_coverage_h3.sql` — H3 r7 k=8 buffer per facility, national
- `pipeline/desert_grid.sql` — H3 r6 cells with covered / desert flags + population, national
- `pipeline/district_planning_signals.sql` — district-grain need + trust + spatial fractions, national 706 rows
- `pipeline/dq_checks.sql` — assertion queries that return rows only on failure
- `pipeline/dq_expectations.sql` — sanity expectations encoded as queries
- `chikitsa-copilot/scripts/build_population_grid.py` — one-shot WorldPop → Delta loader, national
- `chikitsa-copilot/scripts/enrich_places.ts` — Google Places enrichment, national (~9,989 facilities)
- `chikitsa-copilot/scripts/build-state-geo.ts` — DataMeet ADM2 → 36 per-state GeoJSON files normalizer
- `chikitsa-copilot/client/public/geo/states/{state_key}.json` — per-state district boundaries, lazy-loaded (one file per state, 50–500 KB each)

## Files modified

- `pipeline/facilities_curated.sql` — bronze→silver patch: add `state_vocab` CTE from PIN directory, longest-match state recovery from `address_stateOrRegion`, `state_key_quality` flag, `facility_row_quality` flag for column-shift rows. Preserves all existing transformations.
- `chikitsa-copilot/server/routes/chikitsa-routes.ts` — remove inline `DISTRICT_RANKING_SQL`; refactor `/api/map/india`, `/api/districts`, `/api/overview`, `/api/copilot/analyze` to `SELECT * FROM public.district_planning_signals`; add `/api/map/state/:state_key/{districts,coverage,facilities}`, `/api/copilot/reviews`, `/api/quality/contamination`; add `chikitsa_app.facility_external_match` create/migrate.
- `chikitsa-copilot/client/src/pages/IndiaMapPage.tsx` — add generic state drill mode (any state), trust toggle, district drill-down panel.
- `chikitsa-copilot/client/src/pages/CopilotPage.tsx` — read URL params; live reviews panel under the answer.
- `chikitsa-copilot/client/src/lib/chikitsa-types.ts` — add `PlanningSignal`, `StateCoverageResponse`, `StateFacility`, `StateDistrictsResponse`, `DesertHex`, `CopilotReview*`.
- `chikitsa-copilot/.env.example` — add `GOOGLE_PLACES_API_KEY`.
- `chikitsa-copilot/databricks.yml` — declare the new view as synced if necessary; add `GOOGLE_PLACES_API_KEY` to app env.
- `chikitsa-copilot/package.json` — add `h3-js` (~30 KB, for client hex polygon rendering); add `node-fetch` only if Node 22 native `fetch` isn't available; no other map library needed (ECharts already in).

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

0.5. **Population grid sanity.** `SELECT SUM(population) FROM population_grid_h3` should land within 5% of India 2020 (~1.38 B). Per-state spot checks: Bihar [115M, 135M], Uttar Pradesh [220M, 250M], Goa [1.4M, 1.7M]. If any state is >20% off, the H3 binning is broken.

0.7. **Coverage geometry sanity.** `SELECT COUNT(*) FROM facility_coverage_h3` should be ~9,989 × 217 = ~2.2 M rows nationally; tolerate ±10%. Per-state, `SELECT COUNT(DISTINCT h3_index_to_parent(h3_index, 6)) FROM facility_coverage_h3 WHERE state_key=$1` is the *unique covered area* in r6 hexes — should be a sensible fraction of the state's total r6 hex count from `population_grid_h3`. If any state shows >95% or <5%, the radius math is wrong for that state (often points-outside-polygon).

1. **District planning signals.** Run the new SQL. 706 rows national. Bihar slice (38 districts) shows non-null `evidence_trust_score` for all 38; this is the demo's spot-check anchor. `recommended_action` national distribution: Verify > Build > Upgrade > others, with Verify concentrated in low-FDR-coverage states. Confirm Saharsa, Kishanganj, Jehanabad land in **Verify** with `t_facility_presence < 30` and `desert_population_pct >= 50`. As a separate sanity, pick one other state at random and walk through its top-Verify district by hand to confirm the rule reads naturally there too.
2. **Sensitivity.** Drop `t_external_verification` from the weight blend (set weight 0) in a one-off run; confirm results stay broadly stable nationwide (zero-Google districts shouldn't cliff). If they cliff, the asymmetric NULL handling isn't working.
3. **Sanity.** Demo-anchor: NITI Aspirational Districts in Bihar (Araria, Begusarai, Sheikhpura, Sitamarhi, Banka, Nawada, Katihar, Khagaria, Purnia, Muzaffarpur, Jamui, Gaya, Aurangabad) — most should land in Verify or Build, almost none in Upgrade (Patna may, due to high facility count). Cross-check: pick a state at random and confirm its top-Verify district reads naturally too. Write expectations down before running.
4. **Lakebase sync.** Probe via the existing Databricks postgres OAuth flow; confirm `public.district_planning_signals`, `public.facility_coverage_h3`, `public.desert_grid`, and `public.population_grid_h3` all exist and match warehouse row counts.
5. **API.** `curl :8000/api/map/india` returns aggregated states. `curl :8000/api/map/state/bihar/districts` returns 38 districts; `:8000/api/map/state/uttar%20pradesh/districts` returns 75. `curl :8000/api/map/state/bihar/coverage` returns hex grid with `totals` populated. `curl :8000/api/copilot/reviews?facility_id={a-known-place_id}` returns up to 5 reviews with attribution; `?facility_id={no-match}` returns `{ reviews: [], reason: 'no_match' }`. Junk state keys return 400.
6. **Enrichment.** Run `npx tsx scripts/enrich_places.ts`. Logs report match counts per state. Spot-check 20 random matches across at least 5 states by hand. Match-rate distribution is itself a finding (urban states score high, rural states score low — that gap is part of the demo's evidence, not a bug).
7. **UI.** `npm run dev`. On `/map`:
   - National view loads.
   - Click any state — drill-in animates; that state's district choropleth + hex coverage + facility points render.
   - Trust toggle visibly grows/shrinks the desert hexes.
   - Demo flow: Bihar → Saharsa → side panel shows trust component bar dominated by low `t_facility_presence`, action class **Verify**, spatial-fraction citation, Google match rate.
   - Click any other state for a sanity verification.
   - "Open in Copilot" deep-links and prefills.
8. **Copilot deep-link.** With `?state=bihar&district=saharsa` set, the page pre-fills "What action should the government investigate first for Saharsa?", retrieves planning signals, and the model answer cites the specific trust component(s) driving the Verify class plus the spatial fraction. The Reviews panel shows up to 5 reviews with author + Google link, or a polite empty state. Repeat with a non-Bihar district as a sanity check.
9. **Compliance.** Review responses include `attribution: "Reviews from Google Maps"`, link `googleMapsUri`, and are not written to any database. Verify by inspecting the route handler and the cleared response cache.
10. **Type-check + lint + smoke test.** `npm run typecheck && npm run lint && npm run test:smoke` clean.
11. **Demo dry run.** Walk the seven-step `HACKATHON_CONCEPT.md` flow end-to-end in under 4 minutes. Use Bihar as the anchor; mention that other states behave identically.

## Risks and mitigations

- **Sync lag.** New views may not show in Lakebase immediately. Mitigation: trigger sync explicitly; add a fallback that runs the same SQL server-side against the UC warehouse if Lakebase view is missing at demo time.
- **District-polygon naming drift across states.** Bihar's known mismatch is `purbi/purba champaran`. Other states will have analogous one-off issues (`pashchim`/`paschim`, transliteration variants). Mitigation: log unmatched `district_geo_key`s on first render of any state, surface counts in the UI as "N districts unmatched in {state}," fix in the alias map as discovered. Most states will have ≤ 3 mismatches.
- **Action threshold tuning.** New components shift the distribution; the `< 50` Verify cutoff is a guess. Mitigation: at step 1 of validation, dump the *national* histogram of `evidence_trust_score` and tune the cutoff so the Aspirational-district expectation lands AND the national distribution is reasonable (not 90% Verify). Tune in SQL, not in TS.
- **Google match urban bias.** Urban states will score high on `t_external_verification`, rural states will score low. Mitigation: asymmetric NULL handling (zero facilities → NULL component → renormalized weights) so absence never penalizes. UI label: "Independent corroboration where Google has coverage." This bias is also the *story*, not a bug — the per-state match rate is itself evidence of the data desert.
- **Payload size for large states.** Rajasthan ~30k r6 hexes ≈ 1 MB uncompressed. Mitigation: gzip on the wire (cuts ~80%); server-side prefilter on `population > 0 OR NOT is_covered_trust_adjusted`; viewport-cull on the client when zoomed in.
- **Time.** Build order: (1) bronze→silver DQ patch in `facilities_curated.sql` + dq_checks/expectations + `/api/quality/contamination`, (2) `build_population_grid.py` (one-shot, runs in background while you build downstream), (3) `facility_coverage_h3.sql` + `desert_grid.sql` + `district_planning_signals.sql` + sync + thin SELECT in routes, (4) `/api/map/state/:state_key/*` endpoints, (5) `IndiaMapPage` state-drill UI + trust toggle + corner stat panel, (6) drill-down panel, (7) enrichment script (national) + match table, (8) `t_external_verification` wired in, (9) live reviews endpoint + Copilot panel, (10) deep-link. Steps 1–6 are the demo's minimum viable arc. Stop adding scope past step 6 if any earlier step blew through its budget.
