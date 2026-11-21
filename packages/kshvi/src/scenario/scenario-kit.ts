export const REQUIRED_SCENARIO_ITEMS = [
  'ORGANIZATION_ORDER', 'PREPARATION_CALENDAR', 'LEADERSHIP_SCHEME', 'CONCEPT', 'OPERATIONAL_ASSIGNMENTS',
  'CONDUCT_CALENDAR', 'ESCALATION_PLAN', 'MAP_SET', 'AGENT_PROFILES', 'PRIVATE_PLANS',
  'ELECTRONIC_INTERMEDIARIES', 'COMMUNICATION_PLAN', 'EQUIPMENT_STATEMENT', 'LOGISTICS_PLAN',
  'FORMATION_PLAN', 'READINESS_PLAN', 'ASSESSMENT_PLAN', 'RESEARCH_PLAN', 'ASSUMPTION_PASSPORT',
] as const;
export type ScenarioItem = typeof REQUIRED_SCENARIO_ITEMS[number];
export type ScenarioKit = {
  items: readonly { item: ScenarioItem; present: boolean }[];
  usesLogistics: boolean;
  usesAutonomy?: boolean;
  researchGoals?: boolean;
  omissions: readonly { item: ScenarioItem; reason: string; decisionBy: string }[];
};
export type KitIssue = { code: string; severity: 'ERROR' | 'WARNING'; item: ScenarioItem; message: string };

export function validateKit(kit: ScenarioKit): KitIssue[] {
  const issues: KitIssue[] = [];
  for (const item of REQUIRED_SCENARIO_ITEMS) {
    const present = kit.items.some(candidate => candidate.item === item && candidate.present);
    const omission = kit.omissions.find(candidate => candidate.item === item);
    if (present) continue;
    if (item === 'MAP_SET') {
      issues.push({ code: 'INITIAL_MAP_REQUIRED', severity: 'ERROR', item, message: 'Начальная карта обязательна' });
      continue;
    }
    if (item === 'LOGISTICS_PLAN' && kit.usesLogistics) {
      issues.push({ code: 'LOGISTICS_PLAN_REQUIRED', severity: 'ERROR', item, message: 'План МТО обязателен при использовании логистики' });
      continue;
    }
    if (item === 'AGENT_PROFILES' && kit.usesAutonomy) {
      issues.push({ code: 'AGENT_PROFILES_REQUIRED', severity: 'ERROR', item, message: 'Профиль автономных участников обязателен' });
      continue;
    }
    if (item === 'RESEARCH_PLAN') {
      if (kit.researchGoals) issues.push({ code: 'RESEARCH_PLAN_REQUIRED', severity: 'ERROR', item, message: 'При исследовательских целях нужен план исследований' });
      else if (omission?.reason && omission.decisionBy) issues.push({ code: 'OMISSION_ACCEPTED', severity: 'WARNING', item, message: omission.reason });
      continue;
    }
    if (!omission?.reason || !omission.decisionBy) {
      issues.push({ code: 'MISSING_REQUIRED_ITEM', severity: 'ERROR', item, message: 'Часть отсутствует без обоснованного решения руководителя' });
    } else {
      issues.push({ code: 'OMISSION_ACCEPTED', severity: 'WARNING', item, message: omission.reason });
    }
  }
  return issues;
}
