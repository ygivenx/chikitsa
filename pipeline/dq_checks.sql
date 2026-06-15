-- Returns rows only when a data-quality assertion fails.
SELECT 'district_planning_signals_row_count' AS check_name, CAST(COUNT(*) AS STRING) AS observed
FROM public.district_planning_signals
HAVING COUNT(*) <> 706

UNION ALL
SELECT 'missing_evidence_trust_score', CAST(COUNT(*) AS STRING)
FROM public.district_planning_signals
WHERE evidence_trust_score IS NULL
HAVING COUNT(*) > 0

UNION ALL
SELECT 'missing_recommended_action', CAST(COUNT(*) AS STRING)
FROM public.district_planning_signals
WHERE recommended_action IS NULL
HAVING COUNT(*) > 0

UNION ALL
SELECT 'bihar_nfhs_district_count', CAST(COUNT(*) AS STRING)
FROM public.district_planning_signals
WHERE state_key = 'bihar'
HAVING COUNT(*) <> 38

UNION ALL
SELECT 'trust_component_stddev_too_low', COALESCE(CAST(ROUND(STDDEV(evidence_trust_score), 2) AS STRING), 'null')
FROM public.district_planning_signals
HAVING STDDEV(evidence_trust_score) < 5 OR STDDEV(evidence_trust_score) IS NULL;
