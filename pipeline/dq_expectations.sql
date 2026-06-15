-- Demo sanity expectations. Rows returned here should be reviewed before demo.
SELECT
  'bihar_focus_district_not_verify_or_build' AS expectation,
  district_name,
  recommended_action,
  evidence_trust_score,
  facility_scarcity_score
FROM public.district_planning_signals
WHERE state_key = 'bihar'
  AND district_key IN ('araria', 'begusarai', 'sheikhpura', 'sitamarhi', 'banka', 'nawada', 'katihar',
                       'khagaria', 'purnia', 'muzaffarpur', 'jamui', 'gaya', 'aurangabad')
  AND recommended_action NOT IN ('verify', 'build')

UNION ALL
SELECT
  'patna_landed_in_verify',
  district_name,
  recommended_action,
  evidence_trust_score,
  facility_scarcity_score
FROM public.district_planning_signals
WHERE state_key = 'bihar'
  AND district_key = 'patna'
  AND recommended_action = 'verify';
