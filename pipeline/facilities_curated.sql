CREATE OR REFRESH MATERIALIZED VIEW facilities_curated
COMMENT 'Deduplicated healthcare facilities with normalized geography and evidence quality flags'
CLUSTER BY (state_key, pincode)
AS
WITH state_vocab AS (
  SELECT DISTINCT
    TRIM(statename) AS state_name,
    LOWER(TRIM(statename)) AS state_key
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
  WHERE statename IS NOT NULL
),
scored AS (
  SELECT
    *,
    (
      CASE WHEN name IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN address_city IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN address_stateOrRegion IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN address_zipOrPostcode IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN specialties IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN capability IS NOT NULL THEN 1 ELSE 0 END
    ) AS completeness_score,
    ROW_NUMBER() OVER (
      PARTITION BY unique_id
      ORDER BY
        (
          CASE WHEN name IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN address_city IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN address_stateOrRegion IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN address_zipOrPostcode IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN specialties IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN capability IS NOT NULL THEN 1 ELSE 0 END
        ) DESC,
        source_content_id
    ) AS duplicate_rank,
    COUNT(*) OVER (PARTITION BY unique_id) AS duplicate_count
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities
  WHERE unique_id IS NOT NULL
),
deduped AS (
  SELECT *
  FROM scored
  WHERE duplicate_rank = 1
),
cleaned AS (
  SELECT
    *,
    REPLACE(unique_id, CAST(CHAR(0) AS STRING), '') AS cleaned_unique_id,
    REPLACE(address_stateOrRegion, CAST(CHAR(0) AS STRING), '') AS cleaned_state_or_region
  FROM deduped
),
state_matches AS (
  SELECT
    cleaned_unique_id,
    state_key AS recovered_state_key,
    state_name AS recovered_state_name,
    ROW_NUMBER() OVER (PARTITION BY cleaned_unique_id ORDER BY LENGTH(state_name) DESC) AS match_rank
  FROM cleaned c
  JOIN state_vocab v
    ON LOWER(CONCAT(' ', COALESCE(c.cleaned_state_or_region, ''), ' '))
      LIKE CONCAT('% ', v.state_key, ' %')
),
state_recovered AS (
  SELECT
    c.*,
    CASE
      WHEN LOWER(TRIM(c.cleaned_state_or_region)) IN (SELECT state_key FROM state_vocab)
        THEN LOWER(TRIM(c.cleaned_state_or_region))
      ELSE sm.recovered_state_key
    END AS recovered_state_key,
    CASE
      WHEN LOWER(TRIM(c.cleaned_state_or_region)) IN (SELECT state_key FROM state_vocab)
        THEN 'clean'
      WHEN sm.recovered_state_key IS NOT NULL
        THEN 'recovered_from_address'
      WHEN c.cleaned_state_or_region IS NULL OR TRIM(c.cleaned_state_or_region) = ''
        THEN 'missing'
      ELSE 'contaminated'
    END AS state_key_quality,
    CASE
      WHEN c.cleaned_unique_id RLIKE '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN 'valid'
      ELSE 'contaminated_shift'
    END AS facility_row_quality
  FROM cleaned c
  LEFT JOIN state_matches sm
    ON c.cleaned_unique_id = sm.cleaned_unique_id
    AND sm.match_rank = 1
)
SELECT
  cleaned_unique_id AS facility_id,
  REPLACE(name, CAST(CHAR(0) AS STRING), '') AS name,
  REPLACE(organization_type, CAST(CHAR(0) AS STRING), '') AS organization_type,
  REPLACE(facilityTypeId, CAST(CHAR(0) AS STRING), '') AS facility_type,
  REPLACE(operatorTypeId, CAST(CHAR(0) AS STRING), '') AS operator_type,
  REPLACE(officialPhone, CAST(CHAR(0) AS STRING), '') AS official_phone,
  REPLACE(email, CAST(CHAR(0) AS STRING), '') AS email,
  REPLACE(officialWebsite, CAST(CHAR(0) AS STRING), '') AS official_website,
  TRY_CAST(yearEstablished AS INT) AS year_established,
  REPLACE(address_line1, CAST(CHAR(0) AS STRING), '') AS address_line1,
  REPLACE(address_line2, CAST(CHAR(0) AS STRING), '') AS address_line2,
  REPLACE(address_line3, CAST(CHAR(0) AS STRING), '') AS address_line3,
  REPLACE(address_city, CAST(CHAR(0) AS STRING), '') AS city,
  cleaned_state_or_region AS state_or_region,
  recovered_state_key AS state_key,
  state_key_quality,
  facility_row_quality,
  REGEXP_REPLACE(address_zipOrPostcode, '[^0-9]', '') AS pincode,
  REPLACE(address_country, CAST(CHAR(0) AS STRING), '') AS country,
  latitude,
  longitude,
  REPLACE(specialties, CAST(CHAR(0) AS STRING), '') AS specialties,
  REPLACE(procedure, CAST(CHAR(0) AS STRING), '') AS procedures,
  REPLACE(equipment, CAST(CHAR(0) AS STRING), '') AS equipment,
  REPLACE(capability, CAST(CHAR(0) AS STRING), '') AS capabilities,
  REPLACE(description, CAST(CHAR(0) AS STRING), '') AS description,
  TRY_CAST(numberDoctors AS INT) AS doctor_count,
  TRY_CAST(capacity AS INT) AS reported_capacity,
  CASE
    WHEN latitude IS NULL OR longitude IS NULL THEN 'missing'
    WHEN latitude BETWEEN 6 AND 38 AND longitude BETWEEN 68 AND 98 THEN 'plausible_india'
    ELSE 'outside_india_bounds'
  END AS coordinate_quality,
  CASE
    WHEN address_zipOrPostcode IS NULL THEN 'missing'
    WHEN REGEXP_REPLACE(address_zipOrPostcode, '[^0-9]', '') RLIKE '^[1-9][0-9]{5}$' THEN 'valid_format'
    ELSE 'invalid_format'
  END AS pincode_quality,
  CASE
    WHEN TRY_CAST(capacity AS INT) > 10000 THEN true
    ELSE false
  END AS capacity_outlier_flag,
  duplicate_count,
  completeness_score,
  REPLACE(source, CAST(CHAR(0) AS STRING), '') AS source,
  REPLACE(source_urls, CAST(CHAR(0) AS STRING), '') AS source_urls
FROM state_recovered;
