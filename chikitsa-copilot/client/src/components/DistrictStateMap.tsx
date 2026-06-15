import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@databricks/appkit-ui/react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { fetchJson } from '../lib/api';
import { actionLabels } from '../lib/chikitsa-copy';
import type { DistrictPriority } from '../lib/chikitsa-types';

interface DistrictBoundaryGeoJson {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: {
      districtName: string;
      districtKey: string;
      stateName?: string;
      stateKey?: string;
    };
    geometry: unknown;
  }>;
}

interface DistrictStateMapProps {
  stateKey: string;
  stateName?: string;
  districtKey: string;
}

interface StateBoundaryAsset {
  mapName: string;
  url: string;
}

interface LoadedBoundaryState {
  stateKey: string;
  boundaryGeoJson: DistrictBoundaryGeoJson;
  districts: DistrictPriority[];
}

function stateBoundaryFileName(stateKey: string) {
  return stateKey.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function DistrictStateMap({ stateKey, stateName, districtKey }: DistrictStateMapProps) {
  const [loadedBoundary, setLoadedBoundary] = useState<LoadedBoundaryState | null>(null);
  const [loadError, setLoadError] = useState<{ stateKey: string; message: string } | null>(null);
  const boundaryAsset = useMemo<StateBoundaryAsset | null>(() => {
    if (!stateKey) return null;
    const fileName = stateBoundaryFileName(stateKey);
    return {
      mapName: `state-districts-${fileName}`,
      url: `/state-district-boundaries/${fileName}.json`,
    };
  }, [stateKey]);
  const selectedStateLabel = stateName || 'selected state';
  const currentBoundary = loadedBoundary?.stateKey === stateKey ? loadedBoundary.boundaryGeoJson : null;
  const districts = useMemo(
    () => (loadedBoundary?.stateKey === stateKey ? loadedBoundary.districts : []),
    [loadedBoundary, stateKey]
  );
  const error = loadError?.stateKey === stateKey ? loadError.message : null;

  useEffect(() => {
    if (!boundaryAsset) return;
    let cancelled = false;

    void Promise.all([
      fetchJson<DistrictBoundaryGeoJson>(boundaryAsset.url),
      fetchJson<DistrictPriority[]>(`/api/districts?state=${encodeURIComponent(stateKey)}&limit=200`),
    ])
      .then(([boundary, rows]) => {
        if (cancelled) return;
        echarts.registerMap(boundaryAsset.mapName, boundary as unknown as Parameters<typeof echarts.registerMap>[1]);
        setLoadedBoundary({ stateKey, boundaryGeoJson: boundary, districts: rows });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setLoadError({
          stateKey,
          message: reason instanceof Error ? reason.message : 'Failed to load district map.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [boundaryAsset, stateKey]);

  const districtByKey = useMemo(
    () => new Map(districts.map((district) => [district.district_key, district])),
    [districts]
  );

  const selectedDistrict = districtKey ? districtByKey.get(districtKey) : null;

  const chartOption = useMemo(() => {
    if (!currentBoundary || !boundaryAsset) return {};

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: { name: string; value?: number }) => {
          const district = districtByKey.get(params.name);
          if (!district) return 'No district score';
          return [
            `<strong>${district.district_name}</strong>`,
            `Action: ${actionLabels[district.recommended_action]}`,
            `Trust-adjusted: ${district.trust_adjusted_score}`,
            `Need: ${district.health_need_score}`,
            `Facilities found: ${district.facility_count}`,
          ].join('<br/>');
        },
      },
      visualMap: {
        min: 0,
        max: 70,
        show: false,
        inRange: {
          color: ['#f5e9c8', '#f0b35a', '#d95a38', '#9f1239'],
        },
      },
      series: [
        {
          name: 'District desert signal',
          type: 'map',
          map: boundaryAsset.mapName,
          nameProperty: 'districtKey',
          roam: true,
          selectedMode: false,
          label: {
            show: false,
          },
          emphasis: {
            label: {
              show: true,
              color: '#1f2937',
              fontWeight: 650,
            },
            itemStyle: {
              areaColor: '#fb923c',
              borderColor: '#7c2d12',
              borderWidth: 1.4,
            },
          },
          itemStyle: {
            borderColor: '#ffffff',
            borderWidth: 0.75,
            areaColor: '#f4efe4',
          },
          data: currentBoundary.features.map((feature) => {
            const district = districtByKey.get(feature.properties.districtKey);
            const isSelected = districtKey && feature.properties.districtKey === districtKey;
            return {
              name: feature.properties.districtKey,
              value: district?.trust_adjusted_score ?? 0,
              itemStyle: isSelected
                ? {
                    areaColor: '#dc2626',
                    borderColor: '#450a0a',
                    borderWidth: 2,
                  }
                : undefined,
            };
          }),
        },
      ],
    };
  }, [boundaryAsset, currentBoundary, districtByKey, districtKey]);

  if (!stateKey) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>District within state</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">
            Choose a state to preview district boundaries and highlight a selected district.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!boundaryAsset) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>District within {selectedStateLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">
            District boundary preview is not available for this state yet. Scores and recommendations still use the
            selected state and district filters.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>District within {selectedStateLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!currentBoundary || districts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>District within {selectedStateLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-72 rounded-xl" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>District within {selectedStateLabel}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {selectedDistrict
                ? `${selectedDistrict.district_name} highlighted inside state boundaries.`
                : 'Select a district to highlight it inside the state.'}
            </p>
          </div>
          {selectedDistrict && <Badge variant="secondary">{actionLabels[selectedDistrict.recommended_action]}</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        <ReactECharts
          option={chartOption}
          className="min-h-72 rounded-xl border bg-card"
          style={{ height: 288 }}
        />
      </CardContent>
    </Card>
  );
}
