import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@databricks/appkit-ui/react';
import { ArrowLeft, MapPinned } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { fetchJson } from '../lib/api';
import { actionLabels, actionVariant } from '../lib/chikitsa-copy';
import type {
  IndiaMapOverview,
  IndiaMapState,
  PlanningSignal,
  StateCoverageResponse,
  StateDistrictsResponse,
  StateFacility,
} from '../lib/chikitsa-types';

interface IndiaAdm1GeoJson {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: {
      shapeName?: unknown;
    };
    geometry: unknown;
  }>;
}

type MapClickEvent = {
  name?: unknown;
};

const stateBoundaryAliases = new Map([
  ['maharastra', 'maharashtra'],
  ['nct of delhi', 'delhi'],
]);

function normalizeMapName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function buildBoundaryNameLookup(boundaryGeoJson: IndiaAdm1GeoJson) {
  return new Map(
    boundaryGeoJson.features.map((feature) => {
      const rawShapeName = feature.properties.shapeName;
      const shapeName = typeof rawShapeName === 'string' ? rawShapeName : '';
      return [normalizeMapName(shapeName), shapeName];
    })
  );
}

function getBoundaryName(state: IndiaMapState, boundaryNameByKey: Map<string, string>) {
  const normalizedStateName = normalizeMapName(state.state_name);
  const boundaryKey = stateBoundaryAliases.get(normalizedStateName) ?? normalizedStateName;
  return boundaryNameByKey.get(boundaryKey) ?? state.state_name;
}

export function IndiaMapPage() {
  const [data, setData] = useState<IndiaMapOverview | null>(null);
  const [boundaryGeoJson, setBoundaryGeoJson] = useState<IndiaAdm1GeoJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mode, setMode] = useState<'india' | 'state'>('india');
  const [trustAdjusted, setTrustAdjusted] = useState(false);
  const [stateDistricts, setStateDistricts] = useState<PlanningSignal[]>([]);
  const [stateCoverage, setStateCoverage] = useState<StateCoverageResponse | null>(null);
  const [stateFacilities, setStateFacilities] = useState<StateFacility[]>([]);
  const [stateDrillError, setStateDrillError] = useState<string | null>(null);
  const [stateDrillLoading, setStateDrillLoading] = useState(false);

  useEffect(() => {
    void Promise.all([fetchJson<IndiaMapOverview>('/api/map/india'), fetchJson<IndiaAdm1GeoJson>('/india-adm1.json')])
      .then(([payload, boundary]) => {
        echarts.registerMap('india-adm1', boundary as unknown as Parameters<typeof echarts.registerMap>[1]);
        setData(payload);
        setBoundaryGeoJson(boundary);
        setSelectedKey(payload.states[0]?.state_key ?? null);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Failed to load India map.');
      });
  }, []);

  const selected = useMemo(() => {
    if (!data) return null;
    return data.states.find((state) => state.state_key === selectedKey) ?? data.states[0] ?? null;
  }, [data, selectedKey]);

  useEffect(() => {
    if (!selectedKey || mode !== 'state') return;
    void Promise.all([
      fetchJson<StateDistrictsResponse>(`/api/map/state/${encodeURIComponent(selectedKey)}/districts`),
      fetchJson<StateCoverageResponse>(`/api/map/state/${encodeURIComponent(selectedKey)}/coverage`),
      fetchJson<StateFacility[]>(`/api/map/state/${encodeURIComponent(selectedKey)}/facilities`),
    ])
      .then(([districtPayload, coveragePayload, facilitiesPayload]) => {
        setStateDistricts(districtPayload.districts);
        setStateCoverage(coveragePayload);
        setStateFacilities(facilitiesPayload);
      })
      .catch((reason: unknown) => {
        setStateDrillError(reason instanceof Error ? reason.message : 'Failed to load state drill-down.');
        setStateDistricts([]);
        setStateCoverage(null);
        setStateFacilities([]);
      })
      .finally(() => setStateDrillLoading(false));
  }, [mode, selectedKey]);

  const stateByBoundaryName = useMemo(() => {
    if (!boundaryGeoJson) return new Map<string, IndiaMapState>();
    const boundaryNameByKey = buildBoundaryNameLookup(boundaryGeoJson);
    const lookup = new Map<string, IndiaMapState>();
    data?.states.forEach((state) => lookup.set(getBoundaryName(state, boundaryNameByKey), state));
    return lookup;
  }, [boundaryGeoJson, data]);

  const chartOption = useMemo(() => {
    if (!data || !boundaryGeoJson) return {};
    const boundaryNameByKey = buildBoundaryNameLookup(boundaryGeoJson);

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: { name: string; value?: number }) => {
          const state = stateByBoundaryName.get(params.name);
          if (!state) return `${params.name}<br/>No scored district data`;
          return [
            `<strong>${state.state_name}</strong>`,
            `Max desert signal: ${state.max_trust_adjusted_score}`,
            `Top district: ${state.top_district_name}`,
            `Action: ${actionLabels[state.top_district_action]}`,
            `Evidence confidence: ${state.avg_evidence_confidence}`,
          ].join('<br/>');
        },
      },
      visualMap: {
        min: 0,
        max: 70,
        left: 16,
        bottom: 20,
        text: ['Higher', 'Lower'],
        calculable: false,
        inRange: {
          color: ['#f5e9c8', '#f0b35a', '#d95a38', '#9f1239'],
        },
        textStyle: {
          color: '#6b6256',
        },
      },
      series: [
        {
          name: 'Healthcare desert signal',
          type: 'map',
          map: 'india-adm1',
          nameProperty: 'shapeName',
          roam: true,
          selectedMode: false,
          emphasis: {
            label: {
              show: true,
              color: '#1f2937',
              fontWeight: 600,
            },
            itemStyle: {
              areaColor: '#f97316',
              borderColor: '#7c2d12',
              borderWidth: 1,
            },
          },
          itemStyle: {
            borderColor: '#ffffff',
            borderWidth: 0.8,
            areaColor: '#f4efe4',
          },
          data: data.states.map((state) => ({
            name: getBoundaryName(state, boundaryNameByKey),
            value: state.max_trust_adjusted_score,
          })),
        },
      ],
    };
  }, [boundaryGeoJson, data, stateByBoundaryName]);

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
        <p className="font-semibold">India map is not ready</p>
        <p className="mt-1">{error}</p>
      </div>
    );
  }

  if (!data || !boundaryGeoJson) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-[620px] rounded-2xl" />
      </div>
    );
  }

  const topStates = data.states.slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <Badge variant="outline">
          <MapPinned className="mr-1 h-3.5 w-3.5" /> India healthcare desert map
        </Badge>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          Start with apparent healthcare deserts
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          This first map uses available NFHS need indicators and discovered facility evidence. Darker state and union
          territory boundaries mean at least one district has a stronger apparent desert signal.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>National desert signal</CardTitle>
            <p className="text-sm text-muted-foreground">
              Boundary choropleth using geoBoundaries ADM1 polygons, colored by the strongest district signal in each
              state or union territory.
            </p>
          </CardHeader>
          <CardContent>
            <ReactECharts
              option={chartOption}
              className="min-h-[620px] rounded-2xl border bg-card"
              style={{ height: 620 }}
              onEvents={{
                click: (params: MapClickEvent) => {
                  if (typeof params.name !== 'string') return;
                  const state = stateByBoundaryName.get(params.name);
                  if (state) {
                    setSelectedKey(state.state_key);
                    setMode('state');
                    setStateDrillLoading(true);
                    setStateDrillError(null);
                  }
                },
              }}
            />
          </CardContent>
        </Card>

        <div className="space-y-5">
          {selected && (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{selected.state_name}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Top district: {selected.top_district_name} ({selected.top_district_score})
                    </p>
                  </div>
                  {mode === 'state' && (
                    <Button variant="outline" size="sm" onClick={() => setMode('india')}>
                      <ArrowLeft className="mr-2 h-4 w-4" /> India
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {mode === 'state' && stateCoverage ? (
                  <>
                    <div className="rounded-xl border bg-muted/25 p-3">
                      <p className="text-xs text-muted-foreground">Base desert proxy</p>
                      <p className="mt-1 text-2xl font-semibold">
                        {stateCoverage.totals.total_area_hexes
                          ? Math.round(
                              (stateCoverage.totals.desert_area_hexes_base /
                                stateCoverage.totals.total_area_hexes) *
                                100
                            )
                          : 0}
                        %
                      </p>
                    </div>
                    <div className="rounded-xl border bg-muted/25 p-3">
                      <p className="text-xs text-muted-foreground">Trust-adjusted proxy</p>
                      <p className="mt-1 text-2xl font-semibold">
                        {stateCoverage.totals.total_area_hexes
                          ? Math.round(
                              (stateCoverage.totals.desert_area_hexes_trust_adjusted /
                                stateCoverage.totals.total_area_hexes) *
                                100
                            )
                          : 0}
                        %
                      </p>
                    </div>
                    <div className="sm:col-span-2 rounded-xl border bg-muted/25 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">Trust adjustment</p>
                          <p className="text-xs leading-5 text-muted-foreground">
                            Switches the drill-down list from base desert score to trust-adjusted score.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setTrustAdjusted((value) => !value)}
                          className={`h-7 w-12 rounded-full p-1 transition-colors ${
                            trustAdjusted ? 'bg-primary' : 'bg-muted'
                          }`}
                          aria-pressed={trustAdjusted}
                          aria-label="Toggle trust adjustment"
                        >
                          <span
                            className={`block h-5 w-5 rounded-full bg-background transition-transform ${
                              trustAdjusted ? 'translate-x-5' : ''
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded-xl border bg-muted/25 p-3">
                      <p className="text-xs text-muted-foreground">Max desert signal</p>
                      <p className="mt-1 text-2xl font-semibold">{selected.max_trust_adjusted_score}</p>
                    </div>
                    <div className="rounded-xl border bg-muted/25 p-3">
                      <p className="text-xs text-muted-foreground">Evidence confidence</p>
                      <p className="mt-1 text-2xl font-semibold">{selected.avg_evidence_confidence}</p>
                    </div>
                  </>
                )}
                <div className="rounded-xl border bg-muted/25 p-3">
                  <p className="text-xs text-muted-foreground">Districts scored</p>
                  <p className="mt-1 text-2xl font-semibold">{selected.district_count}</p>
                </div>
                <div className="rounded-xl border bg-muted/25 p-3">
                  <p className="text-xs text-muted-foreground">Facilities found</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {mode === 'state' ? stateFacilities.length.toLocaleString() : selected.facility_count}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <Badge variant={actionVariant(selected.top_district_action)}>
                    {actionLabels[selected.top_district_action]}
                  </Badge>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Recommended action for the top district by current rule-based classifier.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {mode === 'state' && (
            <Card>
              <CardHeader>
                <CardTitle>District drill-down</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Ranked by {trustAdjusted ? 'trust-adjusted score' : 'base desert score'} for the selected state.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {stateDrillLoading && <Skeleton className="h-28 rounded-xl" />}
                {stateDrillError && <p className="text-sm text-destructive">{stateDrillError}</p>}
                {[...stateDistricts]
                  .sort((a, b) =>
                    trustAdjusted
                      ? b.trust_adjusted_score - a.trust_adjusted_score
                      : b.desert_score - a.desert_score
                  )
                  .slice(0, 8)
                  .map((district) => (
                    <div key={district.district_key} className="rounded-xl border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-foreground">{district.district_name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {district.desert_area_pct ?? district.facility_scarcity_score}% base desert proxy ·{' '}
                            {district.desert_area_pct_trust_adjusted ?? district.facility_scarcity_score}% trust-adjusted
                          </p>
                        </div>
                        <Badge variant={actionVariant(district.recommended_action)}>
                          {actionLabels[district.recommended_action]}
                        </Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <span>Need {district.health_need_score}</span>
                        <span>Scarcity {district.facility_scarcity_score}</span>
                        <span>Confidence {district.evidence_trust_score}</span>
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Top state signals</CardTitle>
              <p className="text-sm text-muted-foreground">Ranked by strongest district signal in each state.</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {topStates.map((state) => (
                <button
                  key={state.state_key}
                  type="button"
                  onClick={() => {
                    setSelectedKey(state.state_key);
                    if (mode === 'state') {
                      setStateDrillLoading(true);
                      setStateDrillError(null);
                    }
                  }}
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${
                    selectedKey === state.state_key ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{state.state_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {state.top_district_name} · {actionLabels[state.top_district_action]}
                      </p>
                    </div>
                    <p className="font-semibold tabular-nums text-foreground">{state.max_trust_adjusted_score}</p>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="rounded-xl border bg-muted/25 p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">Caveat:</strong> this is a first-pass national view from available district
        and facility records rendered on state and union territory boundaries, not a district polygon map yet.{' '}
        {data.assignmentMethod} Source: {data.freshness}.
      </div>
    </div>
  );
}
