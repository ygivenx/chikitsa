import { useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@databricks/appkit-ui/react';
import { Search, ShieldAlert } from 'lucide-react';
import { fetchJson } from '../lib/api';
import type { DistrictPriority, Facility } from '../lib/chikitsa-types';

export function ExplorePage() {
  const [districts, setDistricts] = useState<DistrictPriority[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [query, setQuery] = useState('');
  const [state, setState] = useState('');
  const [district, setDistrict] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchJson<DistrictPriority[]>('/api/districts?limit=40')
      .then(setDistricts)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Failed to load districts.'))
      .finally(() => setLoading(false));
  }, []);

  async function searchFacilities(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ q: query, state, district, limit: '40' });
    try {
      setFacilities(await fetchJson<Facility[]>(`/api/facilities?${params.toString()}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Facility search failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Badge variant="outline">Evidence explorer</Badge>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">District burden and facility evidence</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Use exact evidence for investigation. Facility counts represent records discovered in the marketplace dataset,
          not an authoritative inventory of all providers.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Search discovered facilities</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={(event) => { void searchFacilities(event); }} className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto]">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or specialty" />
            <Input value={state} onChange={(event) => setState(event.target.value)} placeholder="State, e.g. bihar" />
            <Input value={district} onChange={(event) => setDistrict(event.target.value)} placeholder="District, e.g. purnia" />
            <Button type="submit" disabled={loading}><Search className="mr-2 h-4 w-4" /> Search</Button>
          </form>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {facilities.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Facility results</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {facilities.map((facility) => (
              <div key={facility.facility_id} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{facility.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[facility.city, facility.district_name, facility.state_or_region].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {(facility.coordinate_quality !== 'plausible_india' || facility.capacity_outlier_flag) && (
                    <ShieldAlert className="h-4 w-4 text-destructive" aria-label="Quality flag" />
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {facility.facility_type && <Badge variant="secondary">{facility.facility_type}</Badge>}
                  <Badge variant={facility.is_unambiguous ? 'outline' : 'destructive'}>
                    {facility.is_unambiguous ? 'PIN mapped' : 'Geography uncertain'}
                  </Badge>
                </div>
                {facility.specialties && <p className="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground">{facility.specialties}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Priority district table</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {loading && districts.length === 0 ? (
            <div className="space-y-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-10" />)}</div>
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-3">District</th>
                  <th className="pb-3">Need score</th>
                  <th className="pb-3">Child anaemia</th>
                  <th className="pb-3">Underweight</th>
                  <th className="pb-3">4+ ANC</th>
                  <th className="pb-3">Insurance</th>
                  <th className="pb-3">Facilities</th>
                  <th className="pb-3">Caution</th>
                </tr>
              </thead>
              <tbody>
                {districts.map((row) => (
                  <tr key={`${row.state_key}-${row.district_key}`} className="border-b last:border-0">
                    <td className="py-3 pr-3"><strong>{row.district_name}</strong><br /><span className="text-xs text-muted-foreground">{row.state_name}</span></td>
                    <td className="py-3 pr-3 font-semibold">{row.health_need_score}</td>
                    <td className="py-3 pr-3">{row.child_anaemia_pct}%</td>
                    <td className="py-3 pr-3">{row.child_underweight_pct}%</td>
                    <td className="py-3 pr-3">{row.four_anc_visits_pct}%</td>
                    <td className="py-3 pr-3">{row.health_insurance_pct}%</td>
                    <td className="py-3 pr-3">{row.facility_count}</td>
                    <td className="py-3">
                      {row.contains_caution_estimate || row.contains_suppressed_value
                        ? <Badge variant="destructive">Review</Badge>
                        : <Badge variant="outline">Clear</Badge>}
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
