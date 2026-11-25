import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { FormationPlan } from '../../../../../../packages/kshvi/src/forces/formation';
import { validateFormation } from '../../../../../../packages/kshvi/src/forces/formation-validation';

export function emptyFormationPlan(at: string): FormationPlan {
  return {
    id: crypto.randomUUID(), orderVersion: 1, orderIssuedAt: at, orderReceivedAt: at,
    echelons: [], reserves: [], supportGroups: [], columns: [], areas: [], routes: [],
    controlPosts: [
      { id: 'main-cp', role: 'MAIN', nodeId: 'hq', available: true },
      { id: 'alternate-cp', role: 'ALTERNATE', nodeId: 'hq', available: true },
    ],
    logistics: { transportAvailable: 0, communicationsAvailable: true, requiredStocks: {}, availableStocks: {} },
  };
}

export function upsertFormationElement(draft: PreparationDraft, plan: FormationPlan): PreparationDraft {
  const { issues } = validateFormation(plan);
  if (issues.some(issue => issue.severity === 'ERROR')) throw new Error(issues.filter(issue => issue.severity === 'ERROR').map(issue => issue.message).join('\n'));
  return { ...draft, formation: plan };
}

export function addEchelon(draft: PreparationDraft, input: { forceId: string; areaId: string; readyAt: string }): PreparationDraft {
  if (!input.forceId || !input.areaId.trim() || !Number.isFinite(Date.parse(input.readyAt))) throw new Error('Выберите силу, район и срок готовности эшелона');
  if (!draft.forces.some(force => force.id === input.forceId)) throw new Error('Выбранная сила не найдена в редакции');
  const current = draft.formation ?? emptyFormationPlan(draft.updatedAt);
  const areas = current.areas.some(area => area.id === input.areaId)
    ? current.areas
    : [...current.areas, { id: input.areaId, kind: 'AREA' as const, capacityForces: null }];
  const order = Math.max(0, ...current.echelons.map(item => item.order)) + 1;
  return upsertFormationElement(draft, {
    ...current, areas,
    echelons: [...current.echelons, { id: crypto.randomUUID(), order, forceIds: [input.forceId], areaId: input.areaId, readyAt: input.readyAt, dependsOn: [] }],
  });
}
