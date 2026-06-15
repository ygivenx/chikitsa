CREATE OR REFRESH MATERIALIZED VIEW pincode_geography
COMMENT 'One row per India PIN code with ambiguity and coordinate coverage metadata'
CLUSTER BY (state_key, district_key)
AS
WITH normalized AS (
  SELECT
    pincode,
    TRIM(statename) AS state_name,
    LOWER(TRIM(statename)) AS state_key,
    TRIM(district) AS district_name,
    LOWER(TRIM(district)) AS district_key,
    TRIM(officename) AS office_name,
    officetype AS office_type,
    delivery,
    TRY_CAST(latitude AS DOUBLE) AS latitude,
    TRY_CAST(longitude AS DOUBLE) AS longitude
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
  WHERE pincode IS NOT NULL
),
aggregated AS (
  SELECT
    pincode,
    COUNT(*) AS office_count,
    COUNT(DISTINCT CONCAT_WS('|', state_key, district_key)) AS administrative_mapping_count,
    COUNT(DISTINCT state_key) AS state_count,
    COUNT(DISTINCT district_key) AS district_count,
    COLLECT_SET(state_name) AS candidate_states,
    COLLECT_SET(district_name) AS candidate_districts,
    COLLECT_SET(office_name) AS office_names,
    AVG(latitude) AS centroid_latitude,
    AVG(longitude) AS centroid_longitude,
    SUM(CASE WHEN latitude IS NULL OR longitude IS NULL THEN 1 ELSE 0 END) AS offices_missing_coordinates,
    MAX(state_name) AS representative_state,
    MAX(state_key) AS representative_state_key,
    MAX(district_name) AS representative_district,
    MAX(district_key) AS representative_district_key
  FROM normalized
  GROUP BY pincode
)
SELECT
  pincode,
  office_count,
  administrative_mapping_count,
  state_count,
  district_count,
  CASE WHEN administrative_mapping_count = 1 THEN representative_state END AS state_name,
  CASE WHEN administrative_mapping_count = 1 THEN representative_state_key END AS state_key,
  CASE WHEN administrative_mapping_count = 1 THEN representative_district END AS district_name,
  CASE WHEN administrative_mapping_count = 1 THEN representative_district_key END AS district_key,
  candidate_states,
  candidate_districts,
  office_names,
  centroid_latitude,
  centroid_longitude,
  offices_missing_coordinates,
  administrative_mapping_count = 1 AS is_unambiguous
FROM aggregated;
