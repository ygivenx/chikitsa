import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Textarea,
} from '@databricks/appkit-ui/react';
import DOMPurify from 'dompurify';
import { Bot, Send } from 'lucide-react';
import { marked } from 'marked';
import { useSearchParams } from 'react-router';
import { DistrictStateMap } from '../components/DistrictStateMap';
import { SearchableSelect } from '../components/SearchableSelect';
import { fetchJson } from '../lib/api';
import type { CopilotResponse, LocationOptions } from '../lib/chikitsa-types';

const exampleQuestions = [
  'What intervention should the government investigate first across the current evidence?',
  'For the selected district, explain the evidence, uncertainty, and recommended next action.',
  'Which districts look like data deserts rather than healthcare deserts?',
];

export function CopilotPage() {
  const [searchParams] = useSearchParams();
  const [question, setQuestion] = useState(searchParams.get('q') || exampleQuestions[0]);
  const [state, setState] = useState(searchParams.get('state') || '');
  const [district, setDistrict] = useState(searchParams.get('district') || '');
  const [locations, setLocations] = useState<LocationOptions | null>(null);
  const [result, setResult] = useState<CopilotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renderedAnswer = useMemo(() => {
    if (!result) return '';
    const html = marked.parse(result.answer, {
      async: false,
      breaks: false,
      gfm: true,
    });
    return DOMPurify.sanitize(html);
  }, [result]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (state) params.set('state', state);
    void fetchJson<LocationOptions>(`/api/location-options?${params.toString()}`)
      .then(setLocations)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Failed to load filters.'));
  }, [state]);

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

  const selectedStateName = stateOptions.find((option) => option.value === state)?.label;

  async function analyze(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setResult(
        await fetchJson<CopilotResponse>('/api/copilot/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, state: state || undefined, district: district || undefined }),
        })
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Copilot analysis failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Badge variant="outline">
          <Bot className="mr-1 h-3.5 w-3.5" /> Planning copilot
        </Badge>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          Ask the one question the demo is built around
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          The copilot receives deterministic district and facility evidence from Lakebase and returns one recommended
          action with caveats.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.7fr_1.3fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Question</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(event) => {
                  void analyze(event);
                }}
                className="space-y-4"
              >
                <Textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  className="min-h-32"
                  placeholder="Ask about district health burden, facility evidence, or data quality"
                  required
                  minLength={8}
                />
                <SearchableSelect
                  id="copilot-state"
                  label="State focus"
                  value={state}
                  options={stateOptions}
                  onChange={(nextState) => {
                    setState(nextState);
                    setDistrict('');
                  }}
                  placeholder="Type a state"
                />
                <SearchableSelect
                  id="copilot-district"
                  label="District focus"
                  value={district}
                  options={districtOptions}
                  onChange={setDistrict}
                  placeholder={state ? 'Optional district focus' : 'Select a state first'}
                  disabled={!locations || !state}
                />
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Use one prompt</p>
                  {exampleQuestions.map((example) => (
                    <button
                      key={example}
                      type="button"
                      className="block w-full rounded-lg border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() => setQuestion(example)}
                    >
                      {example}
                    </button>
                  ))}
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading || question.trim().length < 8}>
                  <Send className="mr-2 h-4 w-4" /> {loading ? 'Analyzing evidence…' : 'Analyze evidence'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <DistrictStateMap stateKey={state} stateName={selectedStateName} districtKey={district} />
        </div>

        <Card className="min-h-[520px]">
          <CardHeader>
            <CardTitle>Answer</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && (
              <div className="space-y-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="mt-6 h-28 w-full" />
              </div>
            )}
            {!loading && !result && (
              <div className="flex min-h-96 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
                <Bot className="h-9 w-9 text-primary" />
                <p className="mt-4 font-medium text-foreground">Ask a scoped planning question</p>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                  Start with the default question. Add a district only when you want to explain one row from the
                  shortlist.
                </p>
              </div>
            )}
            {!loading && result && (
              <div className="space-y-4">
                <div
                  className="prose-output text-sm leading-7 text-foreground"
                  dangerouslySetInnerHTML={{ __html: renderedAnswer }}
                />
                <div className="rounded-xl border bg-muted/30 p-4 text-xs leading-5 text-muted-foreground">
                  <p>
                    <strong className="text-foreground">Grounding:</strong> {result.evidence.districts.length} district
                    rows and {result.evidence.facilitySummaryByDistrict.length} facility-summary rows;{' '}
                    {result.evidence.sourcePeriod}.
                  </p>
                  <p className="mt-2">
                    Facility record examples are used for QA only; the facility snapshot is not a registry.
                  </p>
                  <p className="mt-2">District coverage: {result.evidence.retrievalScope.districtCoverage}.</p>
                  <p className="mt-2">
                    The model does not query directly. Treat the answer as planning support, then verify records before
                    operational use.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
