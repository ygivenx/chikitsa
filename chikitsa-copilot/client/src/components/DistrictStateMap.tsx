import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@databricks/appkit-ui/react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { fetchJson } from '../lib/api';
import { actionLabels } from '../lib/chikitsa-copy';
import type { DistrictPriority } from '../lib/chikitsa-types';

interface BiharAdm2GeoJson {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: {
      districtName: string;
      districtKey: string;
    };
    geometry: unknown;
  }>;
}

interface DistrictStateMapProps {
  stateKey: string;
  districtKey: string;
}

export function DistrictStateMap({ stateKey, districtKey }: DistrictStateMapProps) {
  const [boundaryGeoJson, setBoundaryGeoJson] = useState<BiharAdm2GeoJson | null>(null);
  const [districts, setDistricts] = useState<DistrictPriority[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (stateKey !== 'bihar') return;

    void Promise.all([
      fetchJson<BiharAdm2GeoJson>('/bihar-adm2.json'),
      fetchJson<DistrictPriority[]>('/api/districts?state=bihar&limit=200'),
    ])
      .then(([boundary, rows]) => {
        echarts.registerMap('bihar-adm2', boundary as unknown as Parameters<typeof echarts.registerMap>[1]);
        setBoundaryGeoJson(boundary);
        setDistricts(rows);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Failed to load district map.');
      });
  }, [stateKey]);

  const districtByKey = useMemo(
    () => new Map(districts.map((district) => [district.district_key, district])),
    [districts]
  );

  const selectedDistrict = districtKey ? districtByKey.get(districtKey) : null;

  const chartOption = useMemo(() => {
    if (!boundaryGeoJson) return {};

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
          map: 'bihar-adm2',
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
          data: boundaryGeoJson.features.map((feature) => {
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
  }, [boundaryGeoJson, districtByKey, districtKey]);

  if (stateKey !== 'bihar') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>District within state</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">
            District boundary preview is currently wired for the Bihar demo state.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>District within Bihar</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!boundaryGeoJson || districts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>District within Bihar</CardTitle>
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
            <CardTitle>District within Bihar</CardTitle>
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
