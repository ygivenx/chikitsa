CREATE OR REFRESH MATERIALIZED VIEW facilities_curated
COMMENT 'Deduplicated healthcare facilities with normalized geography and evidence quality flags'
CLUSTER BY (state_key, pincode)
AS
WITH scored AS (
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
)
SELECT
  REPLACE(unique_id, CAST(CHAR(0) AS STRING), '') AS facility_id,
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
  REPLACE(address_stateOrRegion, CAST(CHAR(0) AS STRING), '') AS state_or_region,
  LOWER(TRIM(REPLACE(address_stateOrRegion, CAST(CHAR(0) AS STRING), ''))) AS state_key,
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
FROM scored
WHERE duplicate_rank = 1;
