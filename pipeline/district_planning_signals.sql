CREATE OR REFRESH MATERIALIZED VIEW district_planning_signals
COMMENT 'District-grain health need, facility scarcity, evidence confidence, and rule-based planning action'
CLUSTER BY (state_key, district_key)
AS
WITH facility_by_district AS (
  SELECT
    p.state_name,
    p.state_key,
    p.district_name,
    p.district_key,
    CAST(COUNT(DISTINCT CASE WHEN p.is_unambiguous THEN f.facility_id END) AS INT) AS facility_count,
    CAST(COUNT(DISTINCT f.facility_id) AS INT) AS pin_matched_facility_count,
    CAST(COUNT(DISTINCT CASE
      WHEN p.is_unambiguous AND LOWER(COALESCE(f.operator_type, '')) LIKE '%public%' THEN f.facility_id
    END) AS INT)
      AS public_facility_count,
    CAST(COUNT(DISTINCT CASE
      WHEN p.is_unambiguous AND LOWER(COALESCE(f.operator_type, '')) LIKE '%private%' THEN f.facility_id
    END) AS INT)
      AS private_facility_count,
    CAST(COUNT(DISTINCT
      CASE
        WHEN p.is_unambiguous
          AND LOWER(COALESCE(f.operator_type, '')) NOT LIKE '%public%'
          AND LOWER(COALESCE(f.operator_type, '')) NOT LIKE '%private%'
        THEN f.facility_id
      END
    ) AS INT) AS unknown_operator_count,
    CAST(COUNT(DISTINCT CASE
      WHEN p.is_unambiguous AND f.coordinate_quality = 'plausible_india' THEN f.facility_id
    END) AS INT) AS geocoded_facility_count,
    CAST(COUNT(DISTINCT CASE WHEN p.is_unambiguous THEN f.facility_id END) AS INT)
      AS unambiguous_pin_facility_count,
    CAST(COUNT(DISTINCT
      CASE
        WHEN p.is_unambiguous
          AND (
            f.coordinate_quality <> 'plausible_india'
            OR f.capacity_outlier_flag
            OR f.pincode_quality <> 'valid_format'
            OR f.state_key_quality NOT IN ('clean', 'recovered_from_address')
          )
        THEN f.facility_id
      END
    ) AS INT) AS flagged_facility_count
  FROM public.facilities_curated f
  JOIN public.pincode_geography p
    ON f.pincode = CAST(p.pincode AS STRING)
  WHERE COALESCE(f.facility_row_quality, 'valid') = 'valid'
  GROUP BY p.state_name, p.state_key, p.district_name, p.district_key
),
base AS (
  SELECT
    d.state_name,
    d.state_key,
    d.district_name,
    d.district_key,
    d.district_key AS district_geo_key,
    COALESCE(f.facility_count, 0) AS facility_count,
    COALESCE(f.public_facility_count, 0) AS public_facility_count,
    COALESCE(f.private_facility_count, 0) AS private_facility_count,
    COALESCE(f.unknown_operator_count, 0) AS unknown_operator_count,
    COALESCE(f.geocoded_facility_count, 0) AS geocoded_facility_count,
    COALESCE(f.flagged_facility_count, 0) AS flagged_facility_count,
    COALESCE(f.unambiguous_pin_facility_count, 0) AS unambiguous_pin_facility_count,
    COALESCE(f.pin_matched_facility_count, 0) AS pin_matched_facility_count,
    d.child_anaemia_pct,
    d.child_underweight_pct,
    d.four_anc_visits_pct,
    d.health_insurance_pct,
    d.contains_caution_estimate,
    d.contains_suppressed_value,
    d.source_period,
    ROUND((
      d.child_anaemia_pct +
      d.child_underweight_pct +
      (100 - d.four_anc_visits_pct) +
      (100 - d.health_insurance_pct)
    ) / 4, 1) AS health_need_score
  FROM public.district_health_profiles d
  LEFT JOIN facility_by_district f
    ON d.state_key = f.state_key AND d.district_key = f.district_key
),
components AS (
  SELECT
    *,
    ROUND(GREATEST(0, 100 - LEAST(facility_count * 8, 100)), 1)
      AS facility_scarcity_score,
    ROUND(LEAST(facility_count * 8, 100), 1) AS t_facility_presence,
    CASE
      WHEN facility_count = 0 THEN NULL
      ELSE ROUND((geocoded_facility_count / facility_count * 100), 1)
    END AS t_geocoding,
    CASE
      WHEN pin_matched_facility_count = 0 THEN NULL
      ELSE ROUND((unambiguous_pin_facility_count / pin_matched_facility_count * 100), 1)
    END AS t_pin_unambiguous,
    CASE
      WHEN facility_count = 0 THEN NULL
      ELSE ROUND(GREATEST(0, 100 - flagged_facility_count / facility_count * 100), 1)
    END AS t_flagged_inverse,
    ROUND(GREATEST(0, 100
      - CASE WHEN contains_caution_estimate THEN 20 ELSE 0 END
      - CASE WHEN contains_suppressed_value THEN 35 ELSE 0 END
    ), 1) AS t_indicator_quality
  FROM base
),
scored AS (
  SELECT
    *,
    ROUND((
      t_facility_presence * 0.35 +
      COALESCE(t_geocoding, 50) * 0.20 +
      COALESCE(t_pin_unambiguous, 50) * 0.20 +
      COALESCE(t_flagged_inverse, 50) * 0.15 +
      t_indicator_quality * 0.10
    ), 1) AS evidence_trust_score,
    ROUND((health_need_score * facility_scarcity_score / 100), 1) AS desert_score
  FROM components
  WHERE health_need_score IS NOT NULL
)
SELECT
  state_name,
  state_key,
  district_name,
  district_key,
  district_geo_key,
  facility_count,
  public_facility_count,
  private_facility_count,
  unknown_operator_count,
  geocoded_facility_count,
  flagged_facility_count,
  child_anaemia_pct,
  child_underweight_pct,
  four_anc_visits_pct,
  health_insurance_pct,
  contains_caution_estimate,
  contains_suppressed_value,
  source_period,
  health_need_score,
  facility_scarcity_score,
  desert_score,
  evidence_trust_score,
  ROUND((desert_score * (0.65 + evidence_trust_score / 100 * 0.35)), 1)
    AS trust_adjusted_score,
  ROUND(GREATEST(0, LEAST(100, facility_scarcity_score)), 1)
    AS desert_area_pct,
  ROUND(GREATEST(0, LEAST(100, facility_scarcity_score * (0.65 + evidence_trust_score / 100 * 0.35))), 1)
    AS desert_area_pct_trust_adjusted,
  CAST(NULL AS DOUBLE) AS desert_population,
  CAST(NULL AS DOUBLE) AS desert_population_pct,
  CAST(NULL AS DOUBLE) AS desert_population_trust_adjusted,
  CAST(NULL AS DOUBLE) AS desert_population_pct_trust_adjusted,
  t_facility_presence,
  t_geocoding,
  t_pin_unambiguous,
  t_flagged_inverse,
  t_indicator_quality,
  CAST(NULL AS DOUBLE) AS t_external_verification,
  CASE
    WHEN evidence_trust_score < 50 OR t_facility_presence < 30 THEN 'verify'
    WHEN health_need_score >= 60 AND facility_scarcity_score >= 70 THEN 'build'
    WHEN health_need_score >= 60 AND facility_scarcity_score < 45 THEN 'upgrade'
    WHEN health_need_score >= 50 AND facility_scarcity_score < 70 THEN 'improve_access'
    ELSE 'investigate'
  END AS recommended_action,
  'district_planning_signals_v1' AS signals_version
FROM scored;
