CREATE OR REFRESH MATERIALIZED VIEW facility_coverage_h3
COMMENT 'Facility-centered H3 r7 coverage cells using a 10km Euclidean proxy buffer'
CLUSTER BY (state_key, h3_index)
AS
WITH base AS (
  SELECT
    facility_id,
    state_key,
    latitude,
    longitude,
    h3_longlatash3(longitude, latitude, 7) AS home_h3
  FROM public.facilities_curated
  WHERE coordinate_quality = 'plausible_india'
    AND COALESCE(facility_row_quality, 'valid') = 'valid'
    AND latitude IS NOT NULL
    AND longitude IS NOT NULL
)
SELECT
  facility_id,
  state_key,
  EXPLODE(h3_kring(home_h3, 8)) AS h3_index,
  CAST(NULL AS INT) AS ring_distance,
  CAST(10.0 AS DOUBLE) AS distance_km
FROM base;
