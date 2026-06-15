import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
  Textarea,
} from '@databricks/appkit-ui/react';
import { CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { fetchJson } from '../lib/api';
import { actionDescriptions, actionLabels, actionVariant } from '../lib/chikitsa-copy';
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
    district: '',
    action_type: 'investigate' as Intervention['action_type'],
    owner: '',
    notes: '',
  });

  useEffect(() => {
    void fetchJson<Intervention[]>('/api/interventions')
      .then(setPlans)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Failed to load intervention plans.')
      )
      .finally(() => setLoading(false));
  }, []);

  async function createPlan(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const actionLabel = actionLabels[form.action_type];
    const priority: Intervention['priority'] =
      form.action_type === 'build' || form.action_type === 'verify' ? 'critical' : 'high';
    try {
      const created = await fetchJson<Intervention>('/api/interventions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          title: `${actionLabel} investigation: ${form.district}`,
          state: 'Bihar',
          priority,
        }),
      });
      setPlans((current) => [created, ...current]);
      setForm({
        district: '',
        action_type: 'investigate',
        owner: '',
        notes: '',
      });
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
    setPlans((current) => current.map((item) => (item.id === updated.id ? updated : item)));
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
        <Badge variant="outline">Follow-up queue</Badge>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">Turn the shortlist into action</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Keep the workflow small: pick a Bihar district, choose the action class, assign an owner, and capture the next
          verification step.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.7fr_1.3fr]">
        <Card>
          <CardHeader>
            <CardTitle>Create follow-up</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(event) => {
                void createPlan(event);
              }}
              className="space-y-3"
            >
              <Input
                required
                placeholder="District, e.g. Purnia"
                value={form.district}
                onChange={(event) => setForm({ ...form, district: event.target.value })}
              />
              <select
                value={form.action_type}
                onChange={(event) =>
                  setForm({ ...form, action_type: event.target.value as Intervention['action_type'] })
                }
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                aria-label="Action type"
              >
                {Object.entries(actionLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}: {actionDescriptions[value as Intervention['action_type']]}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Owner"
                value={form.owner}
                onChange={(event) => setForm({ ...form, owner: event.target.value })}
              />
              <Textarea
                placeholder="Next verification step"
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full">
                <Plus className="mr-2 h-4 w-4" /> Add intervention
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Action queue</CardTitle>
            <p className="text-sm text-muted-foreground">Draft → review → approved → active → complete</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
            {!loading && plans.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center">
                <p className="font-medium text-foreground">No intervention plans yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create one from a district signal or copilot recommendation.
                </p>
              </div>
            )}
            {plans.map((plan) => (
              <div key={plan.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{plan.title}</p>
                      <Badge variant={actionVariant(plan.action_type)}>{actionLabels[plan.action_type]}</Badge>
                      <Badge variant={plan.priority === 'critical' ? 'destructive' : 'secondary'}>
                        {plan.priority}
                      </Badge>
                      <Badge variant="outline">{plan.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {plan.district}, {plan.state}
                      {plan.owner ? ` · ${plan.owner}` : ''}
                    </p>
                    {plan.notes && <p className="mt-3 text-sm leading-6 text-muted-foreground">{plan.notes}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void advancePlan(plan)}
                      disabled={plan.status === 'complete'}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Advance
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void deletePlan(plan.id)}
                      aria-label={`Delete ${plan.title}`}
                    >
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
