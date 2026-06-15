import type { Application, Request } from 'express';
import { z } from 'zod';

interface QueryResult {
  rows: Record<string, unknown>[];
}

interface ServingHandle {
  asUser(req: Request): {
    invoke(input: {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      max_tokens?: number;
      reasoning_effort?: 'low' | 'medium' | 'high';
      temperature?: number;
    }): Promise<unknown>;
  };
}

interface ChikitsaAppKit {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<QueryResult>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
  serving(): ServingHandle;
}

const CreateInterventionBody = z.object({
  title: z.string().trim().min(3).max(160),
  state: z.string().trim().min(1).max(100),
  district: z.string().trim().min(1).max(100),
  action_type: z.enum(['build', 'verify', 'upgrade', 'improve_access', 'investigate']).default('investigate'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  status: z.enum(['draft', 'review', 'approved', 'active', 'complete']).default('draft'),
  owner: z.string().trim().max(120).optional().default(''),
  notes: z.string().trim().max(4000).optional().default(''),
});

const UpdateInterventionBody = CreateInterventionBody.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one field is required'
);

const CopilotBody = z.object({
  question: z.string().trim().min(8).max(1200),
  state: z.string().trim().max(100).optional(),
  district: z.string().trim().max(100).optional(),
});

const SETUP_SCHEMA_SQL = `CREATE SCHEMA IF NOT EXISTS chikitsa_app`;

const CREATE_INTERVENTIONS_SQL = `
  CREATE TABLE IF NOT EXISTS chikitsa_app.interventions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    state TEXT NOT NULL,
    district TEXT NOT NULL,
    action_type TEXT NOT NULL DEFAULT 'investigate'
      CHECK (action_type IN ('build', 'verify', 'upgrade', 'improve_access', 'investigate')),
    priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status TEXT NOT NULL CHECK (status IN ('draft', 'review', 'approved', 'active', 'complete')),
    owner TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const ALTER_INTERVENTIONS_ACTION_SQL = `
  ALTER TABLE chikitsa_app.interventions
  ADD COLUMN IF NOT EXISTS action_type TEXT NOT NULL DEFAULT 'investigate'
    CHECK (action_type IN ('build', 'verify', 'upgrade', 'improve_access', 'investigate'))
`;

const CREATE_EXTERNAL_MATCH_SQL = `
  CREATE TABLE IF NOT EXISTS chikitsa_app.facility_external_match (
    facility_id TEXT PRIMARY KEY,
    place_id TEXT,
    place_display_name TEXT,
    formatted_address TEXT,
    rating DOUBLE PRECISION,
    user_rating_count INT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    match_confidence TEXT NOT NULL DEFAULT 'none'
      CHECK (match_confidence IN ('high', 'medium', 'low', 'none')),
    matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error TEXT
  )
`;

const DISTRICT_RANKING_SQL = `
  WITH facility_by_district AS (
    SELECT
      p.state_key,
      p.district_key,
      COUNT(DISTINCT f.facility_id)::INT AS facility_count,
      ROUND(AVG(f.completeness_score)::NUMERIC, 2) AS avg_completeness_score,
      SUM(
        CASE
          WHEN f.coordinate_quality <> 'plausible_india'
            OR f.capacity_outlier_flag
            OR f.pincode_quality <> 'valid_format'
          THEN 1
          ELSE 0
        END
      )::INT AS flagged_facility_count
    FROM public.facilities_curated f
    JOIN public.pincode_geography p
      ON f.pincode = p.pincode::TEXT
      AND p.is_unambiguous = true
    GROUP BY p.state_key, p.district_key
  ),
  scored AS (
    SELECT
      d.state_name,
      d.state_key,
      d.district_name,
      d.district_key,
      COALESCE(f.facility_count, 0) AS facility_count,
      COALESCE(f.flagged_facility_count, 0) AS flagged_facility_count,
      d.child_anaemia_pct,
      d.child_underweight_pct,
      d.four_anc_visits_pct,
      d.health_insurance_pct,
      d.contains_caution_estimate,
      d.contains_suppressed_value,
      ROUND((
        d.child_anaemia_pct +
        d.child_underweight_pct +
        (100 - d.four_anc_visits_pct) +
        (100 - d.health_insurance_pct)
      )::NUMERIC / 4, 1)::DOUBLE PRECISION AS health_need_score,
      ROUND(GREATEST(0, 100 - LEAST(COALESCE(f.facility_count, 0) * 8, 100))::NUMERIC, 1)
        ::DOUBLE PRECISION AS facility_scarcity_score,
      ROUND(GREATEST(0, LEAST(100,
        (COALESCE(f.avg_completeness_score, 0) / 7.0 * 100)
        - (COALESCE(f.flagged_facility_count, 0)::NUMERIC / GREATEST(COALESCE(f.facility_count, 0), 1) * 30)
        - CASE WHEN d.contains_caution_estimate THEN 8 ELSE 0 END
        - CASE WHEN d.contains_suppressed_value THEN 15 ELSE 0 END
      ))::NUMERIC, 1)::DOUBLE PRECISION AS evidence_trust_score
    FROM public.district_health_profiles d
    LEFT JOIN facility_by_district f
      ON d.state_key = f.state_key AND d.district_key = f.district_key
    WHERE d.child_anaemia_pct IS NOT NULL
      AND d.child_underweight_pct IS NOT NULL
      AND d.four_anc_visits_pct IS NOT NULL
      AND d.health_insurance_pct IS NOT NULL
  )
  SELECT
    *,
    ROUND((health_need_score * facility_scarcity_score / 100)::NUMERIC, 1)::DOUBLE PRECISION AS desert_score,
    ROUND((health_need_score * facility_scarcity_score / 100 * (0.65 + evidence_trust_score / 100 * 0.35))::NUMERIC, 1)
      ::DOUBLE PRECISION AS trust_adjusted_score,
    CASE
      WHEN evidence_trust_score < 45 THEN 'verify'
      WHEN health_need_score >= 60 AND facility_scarcity_score >= 70 THEN 'build'
      WHEN health_need_score >= 60 AND facility_scarcity_score < 45 THEN 'upgrade'
      WHEN health_need_score >= 50 AND facility_scarcity_score < 70 THEN 'improve_access'
      ELSE 'investigate'
    END AS recommended_action
  FROM scored
`;

const PLANNING_SIGNALS_SELECT_SQL = `
  SELECT
    state_name,
    state_key,
    district_name,
    district_key,
    COALESCE(district_geo_key, district_key) AS district_geo_key,
    facility_count,
    COALESCE(public_facility_count, 0) AS public_facility_count,
    COALESCE(private_facility_count, 0) AS private_facility_count,
    COALESCE(unknown_operator_count, 0) AS unknown_operator_count,
    COALESCE(geocoded_facility_count, 0) AS geocoded_facility_count,
    COALESCE(flagged_facility_count, 0) AS flagged_facility_count,
    child_anaemia_pct,
    child_underweight_pct,
    four_anc_visits_pct,
    health_insurance_pct,
    contains_caution_estimate,
    contains_suppressed_value,
    health_need_score,
    facility_scarcity_score,
    desert_score,
    evidence_trust_score,
    trust_adjusted_score,
    COALESCE(desert_area_pct, facility_scarcity_score) AS desert_area_pct,
    COALESCE(desert_area_pct_trust_adjusted, facility_scarcity_score) AS desert_area_pct_trust_adjusted,
    desert_population,
    desert_population_pct,
    desert_population_trust_adjusted,
    desert_population_pct_trust_adjusted,
    COALESCE(t_facility_presence, GREATEST(0, 100 - facility_scarcity_score)) AS t_facility_presence,
    t_geocoding,
    t_pin_unambiguous,
    t_flagged_inverse,
    t_indicator_quality,
    t_external_verification,
    recommended_action,
    COALESCE(signals_version, 'district_planning_signals') AS signals_version
  FROM public.district_planning_signals
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractModelContent(response: unknown): string {
  const payload = findPayloadWithChoices(response);
  if (!payload) return isRecord(response) ? JSON.stringify(response) : 'No model response was returned.';
  const choices = payload.choices;
  if (choices.length === 0) return JSON.stringify(response);
  const firstChoice: unknown = choices[0];
  if (!isRecord(firstChoice)) return JSON.stringify(response);
  const message = firstChoice.message;
  if (!isRecord(message)) return JSON.stringify(response);
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .filter((block): block is Record<string, unknown> => isRecord(block))
      .flatMap((block) => [block.text, block.content, block.output_text])
      .filter((value): value is string => typeof value === 'string')
      .join('\n\n');
    if (text) return text;
  }
  return JSON.stringify(response);
}

function parseLimit(value: unknown, fallback: number, maximum: number) {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), maximum) : fallback;
}

function parseStateKey(value: unknown) {
  if (typeof value !== 'string') return null;
  const stateKey = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9 _-]{0,120}$/.test(stateKey) ? stateKey : null;
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function queryWithFallback(
  appkit: ChikitsaAppKit,
  primarySql: string,
  fallbackSql: string,
  params: unknown[] = [],
) {
  try {
    return await appkit.lakebase.query(primarySql, params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[chikitsa] Falling back to inline planning SQL:', message);
    return appkit.lakebase.query(fallbackSql, params);
  }
}

function findPayloadWithChoices(value: unknown, depth = 0): (Record<string, unknown> & { choices: unknown[] }) | null {
  if (!isRecord(value) || depth > 6) return null;
  if (Array.isArray(value.choices)) return { ...value, choices: value.choices };

  for (const child of Object.values(value)) {
    const match = findPayloadWithChoices(child, depth + 1);
    if (match) return match;
  }

  return null;
}

export async function setupChikitsaRoutes(appkit: ChikitsaAppKit) {
  for (const [label, sql] of [
    ['schema', SETUP_SCHEMA_SQL],
    ['interventions', CREATE_INTERVENTIONS_SQL],
    ['intervention action migration', ALTER_INTERVENTIONS_ACTION_SQL],
    ['external match', CREATE_EXTERNAL_MATCH_SQL],
  ] as const) {
    try {
      await appkit.lakebase.query(sql);
      console.log(`[chikitsa] ${label} is ready`);
    } catch (error) {
      console.warn(`[chikitsa] ${label} setup deferred:`, (error as Error).message);
    }
  }

  appkit.server.extend((app) => {
    app.get('/api/whoami', (req, res) => {
      const email = req.header('x-forwarded-email') ?? req.header('x-forwarded-user') ?? 'Local developer';
      res.json({
        email,
        modelExecution: 'Authenticated user (OBO)',
        dataExecution: 'App service principal',
      });
    });

    app.get('/api/overview', async (_req, res) => {
      try {
        const [counts, districts, quality] = await Promise.all([
          appkit.lakebase.query(`
            SELECT
              (SELECT COUNT(*)::INT FROM public.facilities_curated) AS facilities,
              (SELECT COUNT(*)::INT FROM public.district_health_profiles) AS districts,
              (SELECT COUNT(*)::INT FROM public.pincode_geography) AS pincodes,
              (SELECT COUNT(*)::INT FROM public.pincode_geography WHERE NOT is_unambiguous) AS ambiguous_pincodes,
              (SELECT COUNT(*)::INT FROM public.facilities_curated
                WHERE coordinate_quality <> 'plausible_india' OR capacity_outlier_flag) AS flagged_facilities
          `),
          queryWithFallback(
            appkit,
            `${PLANNING_SIGNALS_SELECT_SQL}
             ORDER BY trust_adjusted_score DESC, desert_score DESC
             LIMIT 10`,
            `${DISTRICT_RANKING_SQL}
             ORDER BY trust_adjusted_score DESC, desert_score DESC
             LIMIT 10`,
          ),
          appkit.lakebase.query(`
            SELECT facility_id, name, city, state_or_region, pincode, coordinate_quality,
              reported_capacity, capacity_outlier_flag, completeness_score
            FROM public.facilities_curated
            WHERE coordinate_quality <> 'plausible_india' OR capacity_outlier_flag
            ORDER BY capacity_outlier_flag DESC, completeness_score ASC, name
            LIMIT 8
          `),
        ]);

        res.json({
          metrics: counts.rows[0],
          priorityDistricts: districts.rows,
          qualityIssues: quality.rows,
          freshness: 'NFHS-5 2019-2021; facility marketplace snapshot',
        });
      } catch (error) {
        console.error('[chikitsa] Failed to load overview:', error);
        res.status(500).json({ error: 'The synced healthcare data is not ready yet.' });
      }
    });

    app.get('/api/districts', async (req, res) => {
      const limit = parseLimit(req.query.limit, 50, 200);
      const state = typeof req.query.state === 'string' ? req.query.state.trim().toLowerCase() : '';
      const district = typeof req.query.district === 'string' ? req.query.district.trim().toLowerCase() : '';
      try {
        const result = await queryWithFallback(
          appkit,
          `${PLANNING_SIGNALS_SELECT_SQL}
           WHERE ($1 = '' OR state_key = $1)
             AND ($2 = '' OR district_key = $2)
           ORDER BY trust_adjusted_score DESC, desert_score DESC
           LIMIT $3`,
          `${DISTRICT_RANKING_SQL}
           WHERE ($1 = '' OR state_key = $1)
             AND ($2 = '' OR district_key = $2)
           ORDER BY trust_adjusted_score DESC, desert_score DESC
           LIMIT $3`,
          [state, district, limit]
        );
        res.json(result.rows);
      } catch (error) {
        console.error('[chikitsa] Failed to list districts:', error);
        res.status(500).json({ error: 'Failed to load district priorities.' });
      }
    });

    app.get('/api/location-options', async (req, res) => {
      const state = typeof req.query.state === 'string' ? req.query.state.trim().toLowerCase() : '';
      try {
        const [states, districts] = await Promise.all([
          appkit.lakebase.query(`
            SELECT state_name, state_key, COUNT(*)::INT AS district_count
            FROM public.district_health_profiles
            GROUP BY state_name, state_key
            ORDER BY state_name
          `),
          appkit.lakebase.query(
            `
              SELECT state_name, state_key, district_name, district_key
              FROM public.district_health_profiles
              WHERE ($1 = '' OR state_key = $1)
              ORDER BY state_name, district_name
            `,
            [state]
          ),
        ]);

        res.json({
          states: states.rows,
          districts: districts.rows,
        });
      } catch (error) {
        console.error('[chikitsa] Failed to load location options:', error);
        res.status(500).json({ error: 'Failed to load location filters.' });
      }
    });

    app.get('/api/map/india', async (_req, res) => {
      try {
        const result = await queryWithFallback(
          appkit,
          `
          WITH ranked AS (
            ${PLANNING_SIGNALS_SELECT_SQL}
          ),
          top_district AS (
            SELECT *
            FROM (
              SELECT
                ranked.*,
                ROW_NUMBER() OVER (
                  PARTITION BY state_key
                  ORDER BY trust_adjusted_score DESC, desert_score DESC
                ) AS state_rank
              FROM ranked
            ) ordered
            WHERE state_rank = 1
          )
          SELECT
            r.state_name,
            r.state_key,
            COUNT(*)::INT AS district_count,
            SUM(r.facility_count)::INT AS facility_count,
            ROUND(AVG(r.desert_score)::NUMERIC, 1)::DOUBLE PRECISION AS avg_desert_score,
            ROUND(AVG(r.evidence_trust_score)::NUMERIC, 1)::DOUBLE PRECISION AS avg_evidence_confidence,
            ROUND(MAX(r.trust_adjusted_score)::NUMERIC, 1)::DOUBLE PRECISION AS max_trust_adjusted_score,
            SUM(CASE WHEN r.recommended_action = 'build' THEN 1 ELSE 0 END)::INT AS build_count,
            SUM(CASE WHEN r.recommended_action = 'verify' THEN 1 ELSE 0 END)::INT AS verify_count,
            MAX(t.district_name) AS top_district_name,
            MAX(t.recommended_action) AS top_district_action,
            ROUND(MAX(t.trust_adjusted_score)::NUMERIC, 1)::DOUBLE PRECISION AS top_district_score
          FROM ranked r
          JOIN top_district t
            ON r.state_key = t.state_key
          GROUP BY r.state_name, r.state_key
          ORDER BY max_trust_adjusted_score DESC, avg_desert_score DESC
        `,
          `
          WITH ranked AS (
            ${DISTRICT_RANKING_SQL}
          ),
          top_district AS (
            SELECT *
            FROM (
              SELECT
                ranked.*,
                ROW_NUMBER() OVER (
                  PARTITION BY state_key
                  ORDER BY trust_adjusted_score DESC, desert_score DESC
                ) AS state_rank
              FROM ranked
            ) ordered
            WHERE state_rank = 1
          )
          SELECT
            r.state_name,
            r.state_key,
            COUNT(*)::INT AS district_count,
            SUM(r.facility_count)::INT AS facility_count,
            ROUND(AVG(r.desert_score)::NUMERIC, 1)::DOUBLE PRECISION AS avg_desert_score,
            ROUND(AVG(r.evidence_trust_score)::NUMERIC, 1)::DOUBLE PRECISION AS avg_evidence_confidence,
            ROUND(MAX(r.trust_adjusted_score)::NUMERIC, 1)::DOUBLE PRECISION AS max_trust_adjusted_score,
            SUM(CASE WHEN r.recommended_action = 'build' THEN 1 ELSE 0 END)::INT AS build_count,
            SUM(CASE WHEN r.recommended_action = 'verify' THEN 1 ELSE 0 END)::INT AS verify_count,
            MAX(t.district_name) AS top_district_name,
            MAX(t.recommended_action) AS top_district_action,
            ROUND(MAX(t.trust_adjusted_score)::NUMERIC, 1)::DOUBLE PRECISION AS top_district_score
          FROM ranked r
          JOIN top_district t
            ON r.state_key = t.state_key
          GROUP BY r.state_name, r.state_key
          ORDER BY max_trust_adjusted_score DESC, avg_desert_score DESC
        `
        );

        res.json({
          states: result.rows,
          freshness: 'NFHS-5 2019-2021; facility marketplace snapshot',
          assignmentMethod:
            'Current state/UT choropleth aggregates district scores from available facility records mapped through unambiguous PIN geography. Reliable district assignment should use facility coordinates with point-in-polygon joins against district boundary polygons when available.',
        });
      } catch (error) {
        console.error('[chikitsa] Failed to load India map:', error);
        res.status(500).json({ error: 'Failed to load India healthcare desert map.' });
      }
    });

    app.get('/api/map/state/:stateKey/districts', async (req, res) => {
      const stateKey = parseStateKey(req.params.stateKey);
      if (!stateKey) {
        res.status(400).json({ error: 'Invalid state key.' });
        return;
      }

      try {
        const result = await queryWithFallback(
          appkit,
          `${PLANNING_SIGNALS_SELECT_SQL}
           WHERE state_key = $1
           ORDER BY trust_adjusted_score DESC, desert_score DESC`,
          `${DISTRICT_RANKING_SQL}
           WHERE state_key = $1
           ORDER BY trust_adjusted_score DESC, desert_score DESC`,
          [stateKey],
        );

        res.json({
          state_key: stateKey,
          districts: result.rows,
          freshness: 'NFHS-5 2019-2021; facility marketplace snapshot',
          geometry_url: `/geo/states/${encodeURIComponent(stateKey)}.json`,
        });
      } catch (error) {
        console.error('[chikitsa] Failed to load state districts:', error);
        res.status(500).json({ error: 'Failed to load state districts.' });
      }
    });

    app.get('/api/map/state/:stateKey/coverage', async (req, res) => {
      const stateKey = parseStateKey(req.params.stateKey);
      if (!stateKey) {
        res.status(400).json({ error: 'Invalid state key.' });
        return;
      }

      try {
        const result = await queryWithFallback(
          appkit,
          `
            SELECT
              h3_index,
              is_covered,
              is_covered_trust_adjusted,
              population,
              nearest_facility_distance_km,
              district_key
            FROM public.desert_grid
            WHERE state_key = $1
            ORDER BY district_key, h3_index
          `,
          `
            SELECT
              district_key AS h3_index,
              facility_scarcity_score < 50 AS is_covered,
              trust_adjusted_score < desert_score AS is_covered_trust_adjusted,
              NULL::DOUBLE PRECISION AS population,
              NULL::DOUBLE PRECISION AS nearest_facility_distance_km,
              district_key
            FROM (${DISTRICT_RANKING_SQL}) ranked
            WHERE state_key = $1
            ORDER BY district_key
          `,
          [stateKey],
        );

        const totalAreaHexes = result.rows.length;
        const desertAreaHexesBase = result.rows.filter((row) => row.is_covered !== true).length;
        const desertAreaHexesTrustAdjusted = result.rows.filter((row) => row.is_covered_trust_adjusted !== true).length;
        const totalPopulation = result.rows.reduce((sum, row) => sum + toNumber(row.population), 0);
        const desertPopulationBase = result.rows.reduce(
          (sum, row) => sum + (row.is_covered === true ? 0 : toNumber(row.population)),
          0,
        );
        const desertPopulationTrustAdjusted = result.rows.reduce(
          (sum, row) => sum + (row.is_covered_trust_adjusted === true ? 0 : toNumber(row.population)),
          0,
        );

        res.json({
          state_key: stateKey,
          resolution: 6,
          base_radius_km: 10,
          hexes: result.rows,
          totals: {
            total_population: totalPopulation,
            desert_population_base: desertPopulationBase,
            desert_population_trust_adjusted: desertPopulationTrustAdjusted,
            total_area_hexes: totalAreaHexes,
            desert_area_hexes_base: desertAreaHexesBase,
            desert_area_hexes_trust_adjusted: desertAreaHexesTrustAdjusted,
          },
        });
      } catch (error) {
        console.error('[chikitsa] Failed to load state coverage:', error);
        res.status(500).json({ error: 'Failed to load state coverage.' });
      }
    });

    app.get('/api/map/state/:stateKey/facilities', async (req, res) => {
      const stateKey = parseStateKey(req.params.stateKey);
      if (!stateKey) {
        res.status(400).json({ error: 'Invalid state key.' });
        return;
      }

      try {
        const result = await appkit.lakebase.query(
          `
            SELECT
              facility_id,
              name,
              latitude,
              longitude,
              CASE
                WHEN LOWER(COALESCE(operator_type, '')) LIKE '%public%' THEN 'public'
                WHEN LOWER(COALESCE(operator_type, '')) LIKE '%private%' THEN 'private'
                ELSE 'unknown'
              END AS operator_type,
              false AS places_matched
            FROM public.facilities_curated
            WHERE state_key = $1
              AND latitude IS NOT NULL
              AND longitude IS NOT NULL
              AND coordinate_quality = 'plausible_india'
            ORDER BY name
            LIMIT 5000
          `,
          [stateKey],
        );
        res.json(result.rows);
      } catch (error) {
        console.error('[chikitsa] Failed to load state facilities:', error);
        res.status(500).json({ error: 'Failed to load state facilities.' });
      }
    });

    app.get('/api/quality/contamination', async (_req, res) => {
      try {
        const result = await queryWithFallback(
          appkit,
          `
            SELECT
              (SELECT COUNT(*)::INT FROM public.facilities_curated WHERE facility_row_quality = 'contaminated_shift')
                AS contaminated_shift,
              (SELECT COUNT(*)::INT FROM public.facilities_curated WHERE state_key_quality = 'recovered_from_address')
                AS recovered_from_address,
              (SELECT COUNT(*)::INT FROM public.facilities_curated WHERE state_key_quality = 'missing')
                AS missing_state,
              (SELECT COUNT(*)::INT FROM public.pincode_geography WHERE NOT is_unambiguous)
                AS ambiguous_pincodes,
              (SELECT COUNT(*)::INT FROM public.district_health_profiles WHERE contains_suppressed_value)
                AS suppressed_nfhs_districts,
              (SELECT COUNT(*)::INT FROM public.district_health_profiles WHERE contains_caution_estimate)
                AS caution_nfhs_districts
          `,
          `
            SELECT
              0::INT AS contaminated_shift,
              0::INT AS recovered_from_address,
              (SELECT COUNT(*)::INT FROM public.facilities_curated WHERE state_key IS NULL) AS missing_state,
              (SELECT COUNT(*)::INT FROM public.pincode_geography WHERE NOT is_unambiguous)
                AS ambiguous_pincodes,
              (SELECT COUNT(*)::INT FROM public.district_health_profiles WHERE contains_suppressed_value)
                AS suppressed_nfhs_districts,
              (SELECT COUNT(*)::INT FROM public.district_health_profiles WHERE contains_caution_estimate)
                AS caution_nfhs_districts
          `,
        );
        res.json(result.rows[0]);
      } catch (error) {
        console.error('[chikitsa] Failed to load contamination summary:', error);
        res.status(500).json({ error: 'Failed to load quality summary.' });
      }
    });

    app.get('/api/facilities', async (req, res) => {
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const state = typeof req.query.state === 'string' ? req.query.state.trim().toLowerCase() : '';
      const district = typeof req.query.district === 'string' ? req.query.district.trim().toLowerCase() : '';
      const limit = parseLimit(req.query.limit, 25, 100);
      try {
        const result = await appkit.lakebase.query(
          `
            SELECT
              f.facility_id, f.name, f.facility_type, f.operator_type, f.city,
              f.state_or_region, f.pincode, f.specialties, f.capabilities,
              f.coordinate_quality, f.capacity_outlier_flag, f.completeness_score,
              p.district_name, p.district_key, p.is_unambiguous
            FROM public.facilities_curated f
            LEFT JOIN public.pincode_geography p
              ON f.pincode = p.pincode::TEXT
            WHERE ($1 = '' OR f.name ILIKE '%' || $1 || '%' OR f.specialties ILIKE '%' || $1 || '%')
              AND ($2 = '' OR f.state_key = $2)
              AND ($3 = '' OR p.district_key = $3)
            ORDER BY f.completeness_score DESC, f.name
            LIMIT $4
          `,
          [query, state, district, limit]
        );
        res.json(result.rows);
      } catch (error) {
        console.error('[chikitsa] Failed to search facilities:', error);
        res.status(500).json({ error: 'Failed to search facilities.' });
      }
    });

    app.get('/api/interventions', async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(`
          SELECT id, title, state, district, action_type, priority, status, owner, notes, created_at, updated_at
          FROM chikitsa_app.interventions
          ORDER BY
            CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
            updated_at DESC
        `);
        res.json(result.rows);
      } catch (error) {
        console.error('[chikitsa] Failed to list interventions:', error);
        res.status(500).json({ error: 'Failed to load intervention plans.' });
      }
    });

    app.post('/api/interventions', async (req, res) => {
      const parsed = CreateInterventionBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid intervention', details: parsed.error.flatten() });
        return;
      }
      const value = parsed.data;
      try {
        const result = await appkit.lakebase.query(
          `INSERT INTO chikitsa_app.interventions
            (title, state, district, action_type, priority, status, owner, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            value.title,
            value.state,
            value.district,
            value.action_type,
            value.priority,
            value.status,
            value.owner,
            value.notes,
          ]
        );
        res.status(201).json(result.rows[0]);
      } catch (error) {
        console.error('[chikitsa] Failed to create intervention:', error);
        res.status(500).json({ error: 'Failed to create intervention.' });
      }
    });

    app.patch('/api/interventions/:id', async (req, res) => {
      const id = z.string().uuid().safeParse(req.params.id);
      const parsed = UpdateInterventionBody.safeParse(req.body);
      if (!id.success || !parsed.success) {
        res.status(400).json({ error: 'Invalid intervention update.' });
        return;
      }

      const fields = Object.entries(parsed.data);
      const assignments = fields.map(([key], index) => `${key} = $${index + 1}`);
      const values = fields.map(([, value]) => value);
      values.push(id.data);

      try {
        const result = await appkit.lakebase.query(
          `UPDATE chikitsa_app.interventions
           SET ${assignments.join(', ')}, updated_at = NOW()
           WHERE id = $${values.length}
           RETURNING *`,
          values
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: 'Intervention not found.' });
          return;
        }
        res.json(result.rows[0]);
      } catch (error) {
        console.error('[chikitsa] Failed to update intervention:', error);
        res.status(500).json({ error: 'Failed to update intervention.' });
      }
    });

    app.delete('/api/interventions/:id', async (req, res) => {
      const id = z.string().uuid().safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ error: 'Invalid intervention id.' });
        return;
      }
      try {
        const result = await appkit.lakebase.query(
          'DELETE FROM chikitsa_app.interventions WHERE id = $1 RETURNING id',
          [id.data]
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: 'Intervention not found.' });
          return;
        }
        res.status(204).send();
      } catch (error) {
        console.error('[chikitsa] Failed to delete intervention:', error);
        res.status(500).json({ error: 'Failed to delete intervention.' });
      }
    });

    app.post('/api/copilot/analyze', async (req, res) => {
      const parsed = CopilotBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'A specific planning question is required.' });
        return;
      }

      const { question, state = '', district = '' } = parsed.data;
      const stateKey = state.trim().toLowerCase();
      const districtKey = district.trim().toLowerCase();
      const districtLimit = districtKey ? 1 : stateKey ? 100 : 200;
      const facilitySampleLimit = districtKey ? 25 : 20;

      try {
        const [districtEvidence, facilitySummary, facilitySamples, qualityEvidence] = await Promise.all([
          queryWithFallback(
            appkit,
            `${PLANNING_SIGNALS_SELECT_SQL}
             WHERE ($1 = '' OR state_key = $1)
               AND ($2 = '' OR district_key = $2)
             ORDER BY trust_adjusted_score DESC, desert_score DESC
             LIMIT $3`,
            `${DISTRICT_RANKING_SQL}
             WHERE ($1 = '' OR state_key = $1)
               AND ($2 = '' OR district_key = $2)
             ORDER BY trust_adjusted_score DESC, desert_score DESC
             LIMIT $3`,
            [stateKey, districtKey, districtLimit]
          ),
          appkit.lakebase.query(
            `
              SELECT
                COALESCE(p.state_name, f.state_or_region, 'Unknown') AS state_name,
                COALESCE(p.state_key, f.state_key, LOWER(TRIM(f.state_or_region)), 'unknown') AS state_key,
                COALESCE(p.district_name, 'Unassigned or ambiguous PIN') AS district_name,
                COALESCE(p.district_key, 'unassigned_or_ambiguous') AS district_key,
                COUNT(DISTINCT f.facility_id)::INT AS facility_count,
                SUM(CASE WHEN f.coordinate_quality <> 'plausible_india' THEN 1 ELSE 0 END)::INT
                  AS coordinate_flag_count,
                SUM(CASE WHEN f.capacity_outlier_flag THEN 1 ELSE 0 END)::INT AS capacity_outlier_count,
                ROUND(AVG(f.completeness_score)::NUMERIC, 2)::DOUBLE PRECISION AS avg_completeness_score,
                SUM(CASE WHEN p.is_unambiguous IS TRUE THEN 0 ELSE 1 END)::INT
                  AS ambiguous_or_unassigned_pincode_count
              FROM public.facilities_curated f
              LEFT JOIN public.pincode_geography p
                ON CASE WHEN f.pincode ~ '^[0-9]{6}$' THEN f.pincode::BIGINT END = p.pincode
              WHERE ($1 = '' OR f.state_key = $1 OR p.state_key = $1)
                AND ($2 = '' OR p.district_key = $2)
              GROUP BY
                COALESCE(p.state_name, f.state_or_region, 'Unknown'),
                COALESCE(p.state_key, f.state_key, LOWER(TRIM(f.state_or_region)), 'unknown'),
                COALESCE(p.district_name, 'Unassigned or ambiguous PIN'),
                COALESCE(p.district_key, 'unassigned_or_ambiguous')
              ORDER BY facility_count DESC, district_name
            `,
            [stateKey, districtKey]
          ),
          appkit.lakebase.query(
            `
              SELECT
                f.name,
                f.facility_type,
                f.city,
                f.state_or_region,
                f.pincode,
                f.coordinate_quality,
                f.capacity_outlier_flag,
                f.completeness_score,
                p.district_name,
                p.is_unambiguous
              FROM public.facilities_curated f
              LEFT JOIN public.pincode_geography p
                ON CASE WHEN f.pincode ~ '^[0-9]{6}$' THEN f.pincode::BIGINT END = p.pincode
              WHERE ($1 = '' OR f.state_key = $1)
                AND ($2 = '' OR p.district_key = $2)
              ORDER BY f.completeness_score DESC
              LIMIT $3
            `,
            [stateKey, districtKey, facilitySampleLimit]
          ),
          appkit.lakebase.query(
            `
            SELECT
              (SELECT COUNT(*)::INT FROM public.pincode_geography WHERE NOT is_unambiguous)
                AS ambiguous_pincodes,
              (SELECT COUNT(*)::INT
               FROM public.facilities_curated
               WHERE ($1 = '' OR state_key = $1)
                 AND coordinate_quality <> 'plausible_india')
                AS coordinate_flags,
              (SELECT COUNT(*)::INT
               FROM public.facilities_curated
               WHERE ($1 = '' OR state_key = $1)
                 AND capacity_outlier_flag)
                AS capacity_flags
          `,
            [stateKey]
          ),
        ]);

        const evidence = {
          districts: districtEvidence.rows,
          facilitySummaryByDistrict: facilitySummary.rows,
          facilitySamples: facilitySamples.rows,
          quality: qualityEvidence.rows[0],
          sourcePeriod: 'NFHS-5 (2019-2021) and a marketplace facility snapshot',
          retrievalScope: {
            state: stateKey || 'all states',
            district: districtKey || 'all districts in scope',
            districtRowsReturned: districtEvidence.rows.length,
            districtRowLimit: districtLimit,
            districtCoverage:
              districtKey || stateKey
                ? 'complete for requested state or district, up to the configured safety limit'
                : 'national ranking capped for prompt size',
            facilitySummaryRowsReturned: facilitySummary.rows.length,
            facilityExampleRowsReturned: facilitySamples.rows.length,
            facilityExampleLimit: facilitySampleLimit,
          },
        };

        const prompt = [
          'You are an evidence-aware public-health planning copilot for India.',
          'Answer the planning question using only the supplied evidence.',
          'Return only the final answer. Do not include a thinking process, scratchpad, or self-review.',
          'Separate observed facts from inferences. Describe facility counts as discovered facility snapshot evidence, not as a full registry.',
          'Do not use the phrase "complete coverage" in the final answer.',
          'The districts array is the authoritative ranked district evidence for the requested scope.',
          'Use facilitySummaryByDistrict for facility count, coordinate quality, capacity flag, completeness, and ambiguous PIN evidence.',
          'The facilitySamples array contains example facility records for QA only; do not summarize it as coverage.',
          'Do not mention sample limits in the final answer unless a specific example record creates a data-quality caveat.',
          'Use retrievalScope when describing district coverage or evidence reviewed.',
          'Call out ambiguous geography, suppressed values, caution estimates, coordinate flags, and implausible claims.',
          'When present, cite desert_area_pct, desert_area_pct_trust_adjusted, and the named trust components driving the action class.',
          'Classify the recommended action as exactly one of: Build, Verify, Upgrade, Improve access, Investigate.',
          'Do not provide medical diagnosis or individual treatment advice.',
          'Return concise sections: Finding, Recommended action, Evidence, Data quality caveats, Next verification steps.',
          `Question: ${question}`,
          `Evidence JSON: ${JSON.stringify(evidence)}`,
        ].join('\n\n');

        const modelResponse = await appkit
          .serving()
          .asUser(req)
          .invoke({
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 3000,
            reasoning_effort: 'low',
            temperature: 0.2,
          });

        res.json({
          answer: extractModelContent(modelResponse),
          evidence,
          trust: {
            model: 'chatgpt',
            modelExecution: 'Authenticated user (OBO)',
            dataExecution: 'App service principal',
            retrieval: 'Deterministic server-side SQL; the model does not generate or execute SQL',
          },
        });
      } catch (error) {
        console.error('[chikitsa] Copilot analysis failed:', error);
        res.status(500).json({ error: 'The copilot could not complete this analysis.' });
      }
    });

    app.get('/api/copilot/reviews', async (req, res) => {
      const facilityId = typeof req.query.facility_id === 'string' ? req.query.facility_id.trim() : '';
      if (!facilityId) {
        res.status(400).json({ error: 'facility_id is required.' });
        return;
      }

      try {
        const match = await appkit.lakebase.query(
          `
            SELECT facility_id, place_id
            FROM chikitsa_app.facility_external_match
            WHERE facility_id = $1
              AND place_id IS NOT NULL
              AND match_confidence IN ('high', 'medium', 'low')
          `,
          [facilityId],
        );

        const placeId = typeof match.rows[0]?.place_id === 'string' ? match.rows[0].place_id : null;
        if (!placeId) {
          res.json({
            facility_id: facilityId,
            place_id: null,
            google_maps_uri: null,
            attribution: 'Reviews from Google Maps',
            reviews: [],
            reason: 'no_match',
          });
          return;
        }

        if (!process.env.GOOGLE_PLACES_API_KEY) {
          res.json({
            facility_id: facilityId,
            place_id: placeId,
            google_maps_uri: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`,
            attribution: 'Reviews from Google Maps',
            reviews: [],
            reason: 'api_error',
          });
          return;
        }

        res.json({
          facility_id: facilityId,
          place_id: placeId,
          google_maps_uri: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`,
          attribution: 'Reviews from Google Maps',
          reviews: [],
        });
      } catch (error) {
        console.error('[chikitsa] Failed to load copilot reviews:', error);
        res.status(500).json({ error: 'Failed to load facility reviews.' });
      }
    });
  });
}
