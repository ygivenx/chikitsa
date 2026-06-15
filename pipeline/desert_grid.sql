CREATE OR REFRESH MATERIALIZED VIEW desert_grid
COMMENT 'First-pass district desert proxy derived from district planning signals until population H3 grid is available'
CLUSTER BY (state_key, district_key)
AS
SELECT
  CONCAT(state_key, ':', district_key) AS h3_index,
  state_key,
  district_key,
  facility_scarcity_score < 50 AS is_covered,
  trust_adjusted_score < desert_score AS is_covered_trust_adjusted,
  CAST(NULL AS DOUBLE) AS population,
  CAST(NULL AS STRING) AS nearest_facility_id,
  CAST(NULL AS DOUBLE) AS nearest_facility_distance_km,
  desert_area_pct,
  desert_area_pct_trust_adjusted
FROM public.district_planning_signals;
