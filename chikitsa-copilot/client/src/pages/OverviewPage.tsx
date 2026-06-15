import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@databricks/appkit-ui/react';
import { ArrowRight, Database, MapPin, ShieldAlert, Stethoscope, TriangleAlert } from 'lucide-react';
import { fetchJson } from '../lib/api';
import type { Overview } from '../lib/chikitsa-types';

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof Database;
}) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{value.toLocaleString()}</p>
          </div>
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

export function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchJson<Overview>('/api/overview').then(setData).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Failed to load the planning overview.');
    });
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
        <p className="font-semibold">Healthcare data is not ready</p>
        <p className="mt-1">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-36 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  const metrics = [
    { label: 'Facilities', value: data.metrics.facilities, detail: 'Deduplicated marketplace entities', icon: Stethoscope },
    { label: 'NFHS districts', value: data.metrics.districts, detail: 'District profiles from NFHS-5', icon: MapPin },
    { label: 'PIN codes', value: data.metrics.pincodes, detail: 'One row per postal code', icon: Database },
    { label: 'Ambiguous PINs', value: data.metrics.ambiguous_pincodes, detail: 'Require geographic review', icon: TriangleAlert },
    { label: 'Facility flags', value: data.metrics.flagged_facilities, detail: 'Coordinate or capacity concerns', icon: ShieldAlert },
  ];

  return (
    <div className="space-y-7">
      <section className="hero-panel overflow-hidden rounded-2xl border px-6 py-7 md:px-8">
        <div className="max-w-3xl">
          <Badge variant="outline" className="border-primary/30 bg-background/70 text-foreground">
            Evidence-aware planning
          </Badge>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Find public-health priorities without hiding uncertainty.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
            Chikitsa combines district health burden, discovered facility capabilities, and explicit data-quality
            signals. Scores rank attention, not clinical outcomes or complete healthcare coverage.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/copilot">Ask the copilot <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/explore">Explore evidence</Link>
            </Button>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h3 className="text-lg font-semibold text-foreground">Coverage snapshot</h3>
          <p className="text-sm text-muted-foreground">Source: {data.freshness}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.75fr]">
        <Card className="shadow-sm">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Districts needing closer review</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Composite of child anaemia, underweight, low ANC coverage, and low insurance coverage.
              </p>
            </div>
            <Badge variant="secondary">Planning signal</Badge>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-3 font-medium">District</th>
                  <th className="pb-3 font-medium">Need score</th>
                  <th className="pb-3 font-medium">Anaemia</th>
                  <th className="pb-3 font-medium">Underweight</th>
                  <th className="pb-3 font-medium">4+ ANC</th>
                  <th className="pb-3 font-medium">Facilities found</th>
                </tr>
              </thead>
              <tbody>
                {data.priorityDistricts.slice(0, 8).map((district) => (
                  <tr key={`${district.state_key}-${district.district_key}`} className="border-b last:border-0">
                    <td className="py-3 pr-3">
                      <p className="font-medium text-foreground">{district.district_name}</p>
                      <p className="text-xs text-muted-foreground">{district.state_name}</p>
                    </td>
                    <td className="py-3 pr-3 font-semibold tabular-nums">{district.health_need_score}</td>
                    <td className="py-3 pr-3 tabular-nums">{district.child_anaemia_pct}%</td>
                    <td className="py-3 pr-3 tabular-nums">{district.child_underweight_pct}%</td>
                    <td className="py-3 pr-3 tabular-nums">{district.four_anc_visits_pct}%</td>
                    <td className="py-3 tabular-nums">{district.facility_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Quality review queue</CardTitle>
            <p className="text-sm text-muted-foreground">Claims that should not drive planning without verification.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.qualityIssues.map((issue) => (
              <div key={issue.facility_id} className="rounded-xl border bg-muted/25 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{issue.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[issue.city, issue.state_or_region, issue.pincode].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Badge variant={issue.capacity_outlier_flag ? 'destructive' : 'outline'}>
                    {issue.capacity_outlier_flag ? 'Capacity' : 'Coordinate'}
                  </Badge>
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-full" asChild>
              <Link to="/explore">Review facilities</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
