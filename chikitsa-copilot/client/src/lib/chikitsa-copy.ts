import type { InterventionAction } from './chikitsa-types';

export const actionLabels: Record<InterventionAction, string> = {
  build: 'Build',
  verify: 'Verify',
  upgrade: 'Upgrade',
  improve_access: 'Improve access',
  investigate: 'Investigate',
};

export const actionDescriptions: Record<InterventionAction, string> = {
  build: 'Severe shortage with reliable demand evidence.',
  verify: 'Apparent shortage may be a data desert.',
  upgrade: 'Facilities exist, but services may not match local needs.',
  improve_access: 'Facilities exist, but geography or transport may limit access.',
  investigate: 'Context correlates with poor coverage and needs deeper review.',
};

export function actionVariant(action: InterventionAction) {
  if (action === 'build') return 'destructive';
  if (action === 'verify') return 'outline';
  return 'secondary';
}
