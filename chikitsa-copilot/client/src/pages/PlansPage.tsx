import { useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton, Textarea } from '@databricks/appkit-ui/react';
import { CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { fetchJson } from '../lib/api';
import type { Intervention } from '../lib/chikitsa-types';

const nextStatus: Record<Intervention['status'], Intervention['status']> = {
  draft: 'review',
  review: 'approved',
  approved: 'active',
  active: 'complete',
  complete: 'complete',
};

export function PlansPage() {
  const [plans, setPlans] = useState<Intervention[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    state: '',
    district: '',
    priority: 'high' as Intervention['priority'],
    owner: '',
    notes: '',
  });

  useEffect(() => {
    void fetchJson<Intervention[]>('/api/interventions')
      .then(setPlans)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Failed to load intervention plans.'))
      .finally(() => setLoading(false));
  }, []);

  async function createPlan(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await fetchJson<Intervention>('/api/interventions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setPlans((current) => [created, ...current]);
      setForm({ title: '', state: '', district: '', priority: 'high', owner: '', notes: '' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to create intervention.');
    }
  }

  async function advancePlan(plan: Intervention) {
    if (plan.status === 'complete') return;
    const updated = await fetchJson<Intervention>(`/api/interventions/${plan.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus[plan.status] }),
    });
    setPlans((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function deletePlan(id: string) {
    const response = await fetch(`/api/interventions/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      setError('Failed to delete intervention.');
      return;
    }
    setPlans((current) => current.filter((item) => item.id !== id));
  }

  return (
    <div className="space-y-6">
      <div>
        <Badge variant="outline">Persistent workflow</Badge>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">Intervention plans</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Turn a planning signal into a reviewable action. Records are stored in Lakebase, separate from read-only synced evidence.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader><CardTitle>Create a plan</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={(event) => { void createPlan(event); }} className="space-y-3">
              <Input required minLength={3} placeholder="Plan title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input required placeholder="State" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} />
                <Input required placeholder="District" value={form.district} onChange={(event) => setForm({ ...form, district: event.target.value })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={form.priority}
                  onChange={(event) => setForm({ ...form, priority: event.target.value as Intervention['priority'] })}
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  aria-label="Priority"
                >
                  <option value="low">Low priority</option>
                  <option value="medium">Medium priority</option>
                  <option value="high">High priority</option>
                  <option value="critical">Critical priority</option>
                </select>
                <Input placeholder="Owner" value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} />
              </div>
              <Textarea placeholder="Evidence, assumptions, and next steps" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full"><Plus className="mr-2 h-4 w-4" /> Add intervention</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Planning queue</CardTitle>
            <p className="text-sm text-muted-foreground">Draft → review → approved → active → complete</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
            {!loading && plans.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center">
                <p className="font-medium text-foreground">No intervention plans yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Create one from a district signal or copilot recommendation.</p>
              </div>
            )}
            {plans.map((plan) => (
              <div key={plan.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{plan.title}</p>
                      <Badge variant={plan.priority === 'critical' ? 'destructive' : 'secondary'}>{plan.priority}</Badge>
                      <Badge variant="outline">{plan.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{plan.district}, {plan.state}{plan.owner ? ` · ${plan.owner}` : ''}</p>
                    {plan.notes && <p className="mt-3 text-sm leading-6 text-muted-foreground">{plan.notes}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => void advancePlan(plan)} disabled={plan.status === 'complete'}>
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Advance
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void deletePlan(plan.id)} aria-label={`Delete ${plan.title}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
