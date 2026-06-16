CREATE OR REPLACE VIEW public.facility_cleaned_services AS
WITH cleaned AS (
  SELECT
    facility_id,
    facility_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AS is_valid_facility_id,
    NULLIF(TRIM(name), '') AS name,
    CASE
      WHEN LOWER(NULLIF(TRIM(facility_type), '')) = 'farmacy' THEN 'pharmacy'
      WHEN LOWER(NULLIF(TRIM(facility_type), '')) IN ('hospital', 'clinic', 'dentist', 'doctor', 'pharmacy', 'nursing_home')
        THEN LOWER(TRIM(facility_type))
      ELSE NULL
    END AS facility_type_clean,
    CASE
      WHEN LOWER(COALESCE(operator_type, '')) IN ('public', 'government') THEN 'public_government'
      WHEN LOWER(COALESCE(operator_type, '')) = 'private' THEN 'private'
      WHEN NULLIF(TRIM(operator_type), '') IS NULL OR LOWER(TRIM(operator_type)) = 'null' THEN 'unknown'
      ELSE 'other_or_dirty'
    END AS operator_group,
    NULLIF(TRIM(city), '') AS city,
    NULLIF(TRIM(state_or_region), '') AS state_or_region,
    state_key,
    pincode,
    latitude,
    longitude,
    coordinate_quality,
    pincode_quality,
    capacity_outlier_flag,
    duplicate_count,
    completeness_score,
    doctor_count,
    reported_capacity,
    NULLIF(TRIM(official_website), '') AS website_raw,
    NULLIF(TRIM(source_urls), '') AS source_urls_raw,
    LOWER(CONCAT_WS(
      ' ',
      COALESCE(specialties, ''),
      COALESCE(procedures, ''),
      COALESCE(equipment, ''),
      COALESCE(capabilities, ''),
      COALESCE(description, '')
    )) AS service_text
  FROM public.facilities_curated
),
website AS (
  SELECT
    *,
    CASE
      WHEN website_raw IS NULL OR LOWER(website_raw) IN ('null', 'none', 'nan', '[]', '[""]') THEN NULL
      WHEN LOWER(website_raw) ~ '^https?://' THEN website_raw
      WHEN LOWER(website_raw) ~ '^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(/.*)?$' THEN CONCAT('https://', website_raw)
      ELSE NULL
    END AS website_url_clean
  FROM cleaned
),
service_flags AS (
  SELECT
    *,
    CASE
      WHEN website_url_clean IS NULL THEN NULL
      ELSE LOWER(SUBSTRING(website_url_clean FROM '^https?://([^/?#]+)'))
    END AS website_domain,
    CASE
      WHEN website_raw IS NULL OR LOWER(website_raw) IN ('null', 'none', 'nan', '[]', '[""]') THEN 'missing_or_placeholder'
      WHEN website_url_clean IS NULL THEN 'dirty_or_non_url'
      WHEN LOWER(website_url_clean) ~ 'business\.site|facebook\.com|justdial\.com|practo\.com|1mg\.com|eka\.care'
        THEN 'third_party_or_generic'
      WHEN LOWER(website_raw) ~ '^https?://' THEN 'url_like'
      ELSE 'domain_only'
    END AS website_quality,
    service_text ~ 'obstetric|gyne|gynae|maternal|delivery|maternity|antenatal|pregnancy|neonat|paediatric|pediatric|child|vaccin|immunization|immunisation'
      AS service_maternal_child,
    service_text ~ 'emergency|24/7|24x7|icu|intensive care|ambulance|trauma'
      AS service_emergency_critical,
    service_text ~ 'x-ray|xray|radiology|ultrasound|ct scanner|mri|imaging|diagnostic|pathology|laboratory|blood test'
      AS service_diagnostics,
    service_text ~ 'cardio|heart|hypertension|cabg|angioplasty'
      AS service_cardiac,
    service_text ~ 'diabetes|diabetolog|endocrin|blood sugar'
      AS service_diabetes_endocrine,
    service_text ~ 'dialysis|nephro|kidney|renal'
      AS service_renal,
    service_text ~ 'cancer|oncolog|chemotherapy|radiation oncology'
      AS service_oncology,
    service_text ~ 'ophthalm|eye|cataract|glaucoma|retina|lasik'
      AS service_eye_care,
    service_text ~ 'dental|dentist|root canal|tooth|teeth|orthodont'
      AS service_dental,
    service_text ~ 'surgery|surgical|laparoscopic|operation|orthopaedic|orthopedic'
      AS service_surgery_orthopedic
  FROM website
)
SELECT
  facility_id,
  is_valid_facility_id,
  name,
  facility_type_clean,
  operator_group,
  city,
  state_or_region,
  state_key,
  pincode,
  latitude,
  longitude,
  coordinate_quality,
  pincode_quality,
  capacity_outlier_flag,
  duplicate_count,
  completeness_score,
  doctor_count,
  reported_capacity,
  website_raw,
  website_url_clean,
  website_domain,
  website_quality,
  CASE
    WHEN website_quality = 'url_like' THEN 80
    WHEN website_quality = 'domain_only' THEN 65
    WHEN website_quality = 'third_party_or_generic' THEN 40
    ELSE 0
  END AS website_signal_score,
  source_urls_raw,
  source_urls_raw IS NOT NULL AND LOWER(source_urls_raw) NOT IN ('null', 'none', 'nan', '[]', '[""]')
    AS has_source_urls,
  service_maternal_child,
  service_emergency_critical,
  service_diagnostics,
  service_cardiac,
  service_diabetes_endocrine,
  service_renal,
  service_oncology,
  service_eye_care,
  service_dental,
  service_surgery_orthopedic,
  (
    CASE WHEN service_maternal_child THEN 1 ELSE 0 END +
    CASE WHEN service_emergency_critical THEN 1 ELSE 0 END +
    CASE WHEN service_diagnostics THEN 1 ELSE 0 END +
    CASE WHEN service_cardiac THEN 1 ELSE 0 END +
    CASE WHEN service_diabetes_endocrine THEN 1 ELSE 0 END +
    CASE WHEN service_renal THEN 1 ELSE 0 END +
    CASE WHEN service_oncology THEN 1 ELSE 0 END +
    CASE WHEN service_eye_care THEN 1 ELSE 0 END +
    CASE WHEN service_dental THEN 1 ELSE 0 END +
    CASE WHEN service_surgery_orthopedic THEN 1 ELSE 0 END
  ) AS service_category_count,
  CONCAT_WS(
    ', ',
    CASE WHEN service_maternal_child THEN 'maternal_child' END,
    CASE WHEN service_emergency_critical THEN 'emergency_critical' END,
    CASE WHEN service_diagnostics THEN 'diagnostics' END,
    CASE WHEN service_cardiac THEN 'cardiac' END,
    CASE WHEN service_diabetes_endocrine THEN 'diabetes_endocrine' END,
    CASE WHEN service_renal THEN 'renal' END,
    CASE WHEN service_oncology THEN 'oncology' END,
    CASE WHEN service_eye_care THEN 'eye_care' END,
    CASE WHEN service_dental THEN 'dental' END,
    CASE WHEN service_surgery_orthopedic THEN 'surgery_orthopedic' END
  ) AS service_categories,
  CASE
    WHEN service_text IS NULL OR TRIM(service_text) IN ('', '[]', '[""]') THEN 'no_service_evidence'
    WHEN (
      CASE WHEN service_maternal_child THEN 1 ELSE 0 END +
      CASE WHEN service_emergency_critical THEN 1 ELSE 0 END +
      CASE WHEN service_diagnostics THEN 1 ELSE 0 END +
      CASE WHEN service_cardiac THEN 1 ELSE 0 END +
      CASE WHEN service_diabetes_endocrine THEN 1 ELSE 0 END +
      CASE WHEN service_renal THEN 1 ELSE 0 END +
      CASE WHEN service_oncology THEN 1 ELSE 0 END +
      CASE WHEN service_eye_care THEN 1 ELSE 0 END +
      CASE WHEN service_dental THEN 1 ELSE 0 END +
      CASE WHEN service_surgery_orthopedic THEN 1 ELSE 0 END
    ) = 0 THEN 'unclassified_service_text'
    ELSE 'classified_service_mentions'
  END AS service_signal_quality,
  'facility_cleaned_services_v1' AS layer_version
FROM service_flags;

CREATE OR REPLACE VIEW public.district_facility_service_summary AS
SELECT
  p.state_name,
  p.state_key,
  p.district_name,
  p.district_key,
  COUNT(DISTINCT f.facility_id)::INT AS facility_record_count,
  COUNT(DISTINCT CASE WHEN f.operator_group = 'public_government' THEN f.facility_id END)::INT
    AS public_government_facility_count,
  COUNT(DISTINCT CASE WHEN f.operator_group = 'private' THEN f.facility_id END)::INT AS private_facility_count,
  COUNT(DISTINCT CASE WHEN f.operator_group = 'unknown' THEN f.facility_id END)::INT AS unknown_operator_facility_count,
  COUNT(DISTINCT CASE WHEN f.website_url_clean IS NOT NULL THEN f.facility_id END)::INT AS website_clean_count,
  COUNT(DISTINCT CASE WHEN f.website_quality = 'url_like' THEN f.facility_id END)::INT AS website_url_like_count,
  COUNT(DISTINCT CASE WHEN f.website_quality = 'domain_only' THEN f.facility_id END)::INT AS website_domain_only_count,
  COUNT(DISTINCT CASE WHEN f.website_quality = 'third_party_or_generic' THEN f.facility_id END)::INT
    AS website_third_party_or_generic_count,
  COUNT(DISTINCT CASE WHEN f.has_source_urls THEN f.facility_id END)::INT AS source_url_count,
  COUNT(DISTINCT CASE WHEN f.service_maternal_child THEN f.facility_id END)::INT AS service_maternal_child_count,
  COUNT(DISTINCT CASE WHEN f.service_emergency_critical THEN f.facility_id END)::INT
    AS service_emergency_critical_count,
  COUNT(DISTINCT CASE WHEN f.service_diagnostics THEN f.facility_id END)::INT AS service_diagnostics_count,
  COUNT(DISTINCT CASE WHEN f.service_cardiac THEN f.facility_id END)::INT AS service_cardiac_count,
  COUNT(DISTINCT CASE WHEN f.service_diabetes_endocrine THEN f.facility_id END)::INT
    AS service_diabetes_endocrine_count,
  COUNT(DISTINCT CASE WHEN f.service_renal THEN f.facility_id END)::INT AS service_renal_count,
  COUNT(DISTINCT CASE WHEN f.service_oncology THEN f.facility_id END)::INT AS service_oncology_count,
  COUNT(DISTINCT CASE WHEN f.service_eye_care THEN f.facility_id END)::INT AS service_eye_care_count,
  COUNT(DISTINCT CASE WHEN f.service_dental THEN f.facility_id END)::INT AS service_dental_count,
  COUNT(DISTINCT CASE WHEN f.service_surgery_orthopedic THEN f.facility_id END)::INT
    AS service_surgery_orthopedic_count,
  ROUND(AVG(f.website_signal_score)::NUMERIC, 1)::DOUBLE PRECISION AS avg_website_signal_score,
  ROUND(AVG(f.service_category_count)::NUMERIC, 1)::DOUBLE PRECISION AS avg_service_category_count,
  'district_facility_service_summary_v1' AS layer_version
FROM public.facility_cleaned_services f
JOIN public.pincode_geography p
  ON f.pincode = p.pincode::TEXT
  AND p.is_unambiguous
WHERE f.is_valid_facility_id
GROUP BY p.state_name, p.state_key, p.district_name, p.district_key;
