import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@databricks/appkit-ui/react';
import { ArrowRight } from 'lucide-react';
import { fetchJson } from '../lib/api';
import { actionLabels, actionVariant } from '../lib/chikitsa-copy';
import type { DistrictPriority, Overview } from '../lib/chikitsa-types';

const defaultCopilotQuestion = 'What intervention should the government investigate first across the current evidence?';

function copilotLink(question: string, district?: DistrictPriority) {
  const params = new URLSearchParams({ q: question });
  if (district) {
    params.set('state', district.state_key);
    params.set('district', district.district_key);
  }
  return `/copilot?${params.toString()}`;
}

export function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchJson<Overview>('/api/overview')
      .then(setData)
      .catch((reason: unknown) => {
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
        <Skeleton className="h-56 w-full rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-36 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  const districts = data.priorityDistricts.slice(0, 8);
  const leadDistrict = districts[0];
  const verifyCount = districts.filter((district) => district.recommended_action === 'verify').length;
  const actionCounts = districts.reduce<Record<string, number>>((counts, district) => {
    counts[district.recommended_action] = (counts[district.recommended_action] ?? 0) + 1;
    return counts;
  }, {});
  const demoPath = [
    {
      label: 'Rank',
      detail: 'Start with high need and low discovered facility coverage.',
    },
    {
      label: 'Check trust',
      detail: 'Lower confidence when records are missing, ambiguous, or implausible.',
    },
    {
      label: 'Choose action',
      detail: 'Turn each district into Build, Verify, Upgrade, or Improve access.',
    },
  ];

  return (
    <div className="space-y-6">
      <section className="hero-panel rounded-2xl border p-6 md:p-8">
        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <div>
            <Badge variant="outline" className="border-primary/30 bg-background/70 text-foreground">
              National decision brief
            </Badge>
            <h2 className="mt-4 max-w-4xl text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              Which districts should government investigate first?
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              The app ranks districts, explains whether the signal is a real healthcare gap or a data gap, and produces
              an action class that can be reviewed by state or district.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {districts.slice(0, 5).map((district) => (
                <Badge key={`${district.state_key}-${district.district_key}`} variant="secondary">
                  {district.district_name}, {district.state_name}
                </Badge>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button asChild>
                <Link to={copilotLink(defaultCopilotQuestion)}>
                  Ask the demo question <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/explore">See the ranking logic</Link>
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border bg-card/75 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Current lead</p>
            {leadDistrict ? (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <h3 className="text-2xl font-semibold text-foreground">{leadDistrict.district_name}</h3>
                  <Badge variant={actionVariant(leadDistrict.recommended_action)}>
                    {actionLabels[leadDistrict.recommended_action]}
                  </Badge>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Trust-adjusted score {leadDistrict.trust_adjusted_score}, with need {leadDistrict.health_need_score},
                  scarcity {leadDistrict.facility_scarcity_score}, and evidence trust{' '}
                  {leadDistrict.evidence_trust_score}.
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No district ranking returned.</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {demoPath.map((step) => (
          <Card key={step.label} className="border-border/70 shadow-sm">
            <CardContent className="p-4">
              <p className="text-sm font-semibold text-foreground">{step.label}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.detail}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="shadow-sm">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>National action shortlist</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Ordered by trust-adjusted score. Use this table as the demo’s main artifact.
            </p>
          </div>
          <Badge variant="secondary">{verifyCount} possible data gaps</Badge>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-3 font-medium">District</th>
                <th className="pb-3 font-medium">Action</th>
                <th className="pb-3 font-medium">Why it ranks</th>
                <th className="pb-3 font-medium">Score</th>
                <th className="pb-3 font-medium">Trust</th>
              </tr>
            </thead>
            <tbody>
              {districts.map((district) => (
                <tr key={`${district.state_key}-${district.district_key}`} className="border-b last:border-0">
                  <td className="py-3 pr-3">
                    <Link
                      to={copilotLink(
                        `For ${district.district_name}, explain the evidence, uncertainty, and recommended next action.`,
                        district
                      )}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {district.district_name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {district.state_name}; {district.facility_count} facilities found
                    </p>
                  </td>
                  <td className="py-3 pr-3">
                    <Badge variant={actionVariant(district.recommended_action)}>
                      {actionLabels[district.recommended_action]}
                    </Badge>
                  </td>
                  <td className="py-3 pr-3 text-muted-foreground">
                    Need {district.health_need_score}; scarcity {district.facility_scarcity_score}
                  </td>
                  <td className="py-3 pr-3 font-semibold tabular-nums">{district.trust_adjusted_score}</td>
                  <td className="py-3 tabular-nums">{district.evidence_trust_score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="rounded-xl border bg-muted/25 p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">Evidence base:</strong> {data.freshness}. National source coverage:{' '}
        {data.metrics.districts.toLocaleString()} NFHS districts, {data.metrics.facilities.toLocaleString()} discovered
        facility records, and {data.metrics.ambiguous_pincodes.toLocaleString()} ambiguous PIN mappings. Top actions in
        this brief:{' '}
        {Object.entries(actionCounts)
          .map(([action, count]) => `${actionLabels[action as keyof typeof actionLabels]} ${count}`)
          .join(', ')}
        .
      </div>
    </div>
  );
}
