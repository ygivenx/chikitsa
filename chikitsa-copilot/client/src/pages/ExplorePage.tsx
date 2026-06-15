import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@databricks/appkit-ui/react';
import { SearchableSelect } from '../components/SearchableSelect';
import { fetchJson } from '../lib/api';
import { actionLabels, actionVariant } from '../lib/chikitsa-copy';
import type { DistrictPriority, LocationOptions } from '../lib/chikitsa-types';

export function ExplorePage() {
  const [districts, setDistricts] = useState<DistrictPriority[]>([]);
  const [state, setState] = useState('');
  const [district, setDistrict] = useState('');
  const [locations, setLocations] = useState<LocationOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (state) params.set('state', state);
    void fetchJson<LocationOptions>(`/api/location-options?${params.toString()}`)
      .then(setLocations)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Failed to load filters.'));
  }, [state]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ limit: district ? '1' : '200' });
      if (state) params.set('state', state);
      if (district) params.set('district', district);
      void fetchJson<DistrictPriority[]>(`/api/districts?${params.toString()}`)
        .then(setDistricts)
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Failed to load districts.'))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [district, state]);

  const stateOptions = useMemo(
    () => [
      { value: '', label: 'All states', description: 'National scope' },
      ...(locations?.states.map((option) => ({
        value: option.state_key,
        label: option.state_name,
        description: `${option.district_count} districts`,
      })) ?? []),
    ],
    [locations]
  );

  const districtOptions = useMemo(
    () => [
      { value: '', label: 'All districts', description: state ? 'Within selected state' : 'Select a state first' },
      ...(locations?.districts.map((option) => ({
        value: option.district_key,
        label: option.district_name,
        description: option.state_name,
      })) ?? []),
    ],
    [locations, state]
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div>
          <Badge variant="outline">Ranking logic</Badge>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
            Why a district is a healthcare desert or a data desert
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Use the filters to review the national ranking or focus one state before selecting a district.
          </p>
        </div>
        <Card>
          <CardContent className="space-y-3 p-4">
            <SearchableSelect
              id="explore-state"
              label="State filter"
              value={state}
              options={stateOptions}
              onChange={(nextState) => {
                setState(nextState);
                setDistrict('');
              }}
              placeholder="Type a state"
            />
            <SearchableSelect
              id="explore-district"
              label="District filter"
              value={district}
              options={districtOptions}
              onChange={setDistrict}
              placeholder={state ? 'Type a district' : 'Select a state first'}
              disabled={!locations || !state}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/70">
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-foreground">Need</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              NFHS indicators: anaemia, underweight, ANC access, and insurance coverage.
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-foreground">Scarcity</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Fewer discovered facilities raise the apparent healthcare desert score.
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-foreground">Trust</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Missing or implausible evidence shifts the action toward verification.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>District ranking</CardTitle>
          <p className="text-sm text-muted-foreground">
            One row, one action. The score columns are supporting evidence, not separate products.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading && districts.length === 0 ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : (
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-3">District</th>
                  <th className="pb-3">Action</th>
                  <th className="pb-3">Trust-adjusted</th>
                  <th className="pb-3">Desert</th>
                  <th className="pb-3">Need score</th>
                  <th className="pb-3">Scarcity</th>
                  <th className="pb-3">Evidence trust</th>
                  <th className="pb-3">Child anaemia</th>
                  <th className="pb-3">Facilities</th>
                  <th className="pb-3">Trust flags</th>
                </tr>
              </thead>
              <tbody>
                {districts.map((row) => (
                  <tr key={`${row.state_key}-${row.district_key}`} className="border-b last:border-0">
                    <td className="py-3 pr-3">
                      <strong>{row.district_name}</strong>
                      <br />
                      <span className="text-xs text-muted-foreground">{row.state_name}</span>
                    </td>
                    <td className="py-3 pr-3">
                      <Badge variant={actionVariant(row.recommended_action)}>
                        {actionLabels[row.recommended_action]}
                      </Badge>
                    </td>
                    <td className="py-3 pr-3 font-semibold">{row.trust_adjusted_score}</td>
                    <td className="py-3 pr-3">{row.desert_score}</td>
                    <td className="py-3 pr-3 font-semibold">{row.health_need_score}</td>
                    <td className="py-3 pr-3">{row.facility_scarcity_score}</td>
                    <td className="py-3 pr-3">{row.evidence_trust_score}</td>
                    <td className="py-3 pr-3">{row.child_anaemia_pct}%</td>
                    <td className="py-3 pr-3">{row.facility_count}</td>
                    <td className="py-3">
                      {row.contains_caution_estimate ||
                      row.contains_suppressed_value ||
                      row.flagged_facility_count > 0 ? (
                        <Badge variant="destructive">Review</Badge>
                      ) : (
                        <Badge variant="outline">Clear</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
