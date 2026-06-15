import { useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton, Textarea } from '@databricks/appkit-ui/react';
import { Bot, Database, Send, ShieldCheck } from 'lucide-react';
import { fetchJson } from '../lib/api';
import type { CopilotResponse } from '../lib/chikitsa-types';

interface Identity {
  email: string;
  modelExecution: string;
  dataExecution: string;
}

const exampleQuestions = [
  'Which maternal and child health districts should be reviewed first, and why?',
  'What data-quality problems could distort a facility-gap analysis for Bihar?',
  'Compare facility evidence with nutrition burden and propose verification steps.',
];

export function CopilotPage() {
  const [question, setQuestion] = useState(exampleQuestions[0]);
  const [state, setState] = useState('');
  const [district, setDistrict] = useState('');
  const [result, setResult] = useState<CopilotResponse | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchJson<Identity>('/api/whoami').then(setIdentity).catch(() => undefined);
  }, []);

  async function analyze(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setResult(await fetchJson<CopilotResponse>('/api/copilot/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, state: state || undefined, district: district || undefined }),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Copilot analysis failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Badge variant="outline"><Bot className="mr-1 h-3.5 w-3.5" /> GPT OSS 120B</Badge>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">Planning copilot</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            The model explains deterministic evidence retrieved from Lakebase. It cannot execute SQL or change source data.
          </p>
        </div>
        {identity && <Badge variant="secondary">Signed in as {identity.email}</Badge>}
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader><CardTitle>Frame a planning question</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={(event) => { void analyze(event); }} className="space-y-4">
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                className="min-h-32"
                placeholder="Ask about district health burden, facility evidence, or data quality"
                required
                minLength={8}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input value={state} onChange={(event) => setState(event.target.value)} placeholder="Optional state filter" />
                <Input value={district} onChange={(event) => setDistrict(event.target.value)} placeholder="Optional district filter" />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Example questions</p>
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

        <Card className="min-h-[520px]">
          <CardHeader><CardTitle>Evidence-grounded response</CardTitle></CardHeader>
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
                  Responses include source period, retrieved district and facility evidence, and explicit uncertainty.
                </p>
              </div>
            )}
            {!loading && result && (
              <div className="space-y-5">
                <div className="prose-output whitespace-pre-wrap text-sm leading-7 text-foreground">{result.answer}</div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border bg-muted/25 p-3">
                    <Database className="h-4 w-4 text-primary" />
                    <p className="mt-2 text-2xl font-semibold">{result.evidence.districts.length}</p>
                    <p className="text-xs text-muted-foreground">District rows retrieved</p>
                  </div>
                  <div className="rounded-xl border bg-muted/25 p-3">
                    <Database className="h-4 w-4 text-primary" />
                    <p className="mt-2 text-2xl font-semibold">{result.evidence.facilities.length}</p>
                    <p className="text-xs text-muted-foreground">Facility rows retrieved</p>
                  </div>
                  <div className="rounded-xl border bg-muted/25 p-3">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <p className="mt-2 text-sm font-semibold">Deterministic SQL</p>
                    <p className="text-xs text-muted-foreground">Model cannot query directly</p>
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/30 p-4 text-xs leading-5 text-muted-foreground">
                  <p><strong className="text-foreground">Model:</strong> {result.trust.model}</p>
                  <p><strong className="text-foreground">Execution:</strong> {result.trust.modelExecution}; data reads use the app service principal.</p>
                  <p><strong className="text-foreground">Sources:</strong> {result.evidence.sourcePeriod}</p>
                  <p className="mt-2">AI-generated planning support. Verify recommendations and source records before operational use.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
