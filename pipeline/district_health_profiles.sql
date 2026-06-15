CREATE OR REFRESH MATERIALIZED VIEW district_health_profiles
COMMENT 'NFHS-5 district indicators cleaned for planning while retaining uncertainty metadata'
CLUSTER BY (state_key, district_key)
AS
SELECT
  TRIM(state_ut) AS state_name,
  LOWER(TRIM(state_ut)) AS state_key,
  TRIM(district_name) AS district_name,
  LOWER(TRIM(district_name)) AS district_key,
  TRY_CAST(households_surveyed AS DOUBLE) AS households_surveyed,
  TRY_CAST(women_15_49_interviewed AS DOUBLE) AS women_interviewed,
  TRY_CAST(men_15_54_interviewed AS DOUBLE) AS men_interviewed,
  TRY_CAST(REGEXP_REPLACE(CAST(hh_member_covered_health_insurance_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS health_insurance_pct,
  TRY_CAST(REGEXP_REPLACE(CAST(hh_use_improved_sanitation_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS improved_sanitation_pct,
  TRY_CAST(REGEXP_REPLACE(CAST(mothers_who_had_at_least_4_anc_visits_lb5y_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS four_anc_visits_pct,
  TRY_CAST(REGEXP_REPLACE(CAST(institutional_birth_5y_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS institutional_birth_pct,
  TRY_CAST(REGEXP_REPLACE(CAST(child_12_23m_fully_vaccinated_based_on_information_from_eit_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS child_fully_vaccinated_pct,
  TRY_CAST(REGEXP_REPLACE(CAST(child_u5_who_are_stunted_height_for_age_18_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS child_stunted_pct,
  TRY_CAST(REGEXP_REPLACE(CAST(child_u5_who_are_wasted_weight_for_height_18_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS child_wasted_pct,
  TRY_CAST(REGEXP_REPLACE(CAST(child_u5_who_are_underweight_weight_for_age_18_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS child_underweight_pct,
  TRY_CAST(REGEXP_REPLACE(CAST(child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS child_anaemia_pct,
  TRY_CAST(REGEXP_REPLACE(CAST(all_w15_49_who_are_anaemic_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS women_anaemia_pct,
  TRY_CAST(REGEXP_REPLACE(CAST(w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS women_high_blood_pressure_pct,
  TRY_CAST(REGEXP_REPLACE(CAST(m15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS men_high_blood_pressure_pct,
  TRY_CAST(REGEXP_REPLACE(CAST(w15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS women_high_blood_sugar_pct,
  TRY_CAST(REGEXP_REPLACE(CAST(m15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS men_high_blood_sugar_pct,
  TRY_CAST(REGEXP_REPLACE(CAST(women_age_30_49_years_ever_undergone_a_cervical_screen_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS cervical_screening_pct,
  TRY_CAST(REGEXP_REPLACE(CAST(women_age_30_49_years_ever_undergone_a_breast_exam_pct AS STRING), '[^0-9.-]', '') AS DOUBLE)
    AS breast_exam_pct,
  (
    TRIM(CAST(child_12_23m_fully_vaccinated_based_on_information_from_eit_pct AS STRING)) LIKE '(%)' OR
    TRIM(CAST(child_u5_who_are_stunted_height_for_age_18_pct AS STRING)) LIKE '(%)' OR
    TRIM(CAST(child_u5_who_are_underweight_weight_for_age_18_pct AS STRING)) LIKE '(%)'
  ) AS contains_caution_estimate,
  (
    TRIM(CAST(child_12_23m_fully_vaccinated_based_on_information_from_eit_pct AS STRING)) = '*' OR
    TRIM(CAST(child_u5_who_are_stunted_height_for_age_18_pct AS STRING)) = '*' OR
    TRIM(CAST(child_u5_who_are_underweight_weight_for_age_18_pct AS STRING)) = '*' OR
    TRIM(CAST(child_6_59m_who_are_anaemic_lt_11_0_g_dl_22_pct AS STRING)) = '*'
  ) AS contains_suppressed_value,
  'NFHS-5 (2019-2021)' AS source_period
FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators;
