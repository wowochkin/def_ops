import { expect, it } from 'vitest';
import { buildLinkedScenarioKit, REQUIRED_SCENARIO_ITEMS, validateKit } from '../src/scenario/scenario-kit';
import { buildOperationalAssignment } from '../src/scenario/concept';
import { stageImpact } from '../src/scenario/stage-plan';

it('не разрешает молчаливо исключить обязательную МТО', () => {
  const issues = validateKit({ items: [], usesLogistics: true, omissions: [{ item: 'LOGISTICS_PLAN', reason: '', decisionBy: '' }] });
  expect(issues).toContainEqual(expect.objectContaining({ code: 'LOGISTICS_PLAN_REQUIRED', severity: 'ERROR' }));
});

it('содержит все 19 частей и фиксирует обоснованные сокращения', () => {
  expect(REQUIRED_SCENARIO_ITEMS).toHaveLength(19);
  const linked = buildLinkedScenarioKit({
    documents: REQUIRED_SCENARIO_ITEMS.map((item, index) => ({ id: `doc-${index + 1}`, item, revision: 1, content: { item } })),
    usesLogistics: true,
  });
  const items = linked.items;
  expect(validateKit(linked)).toEqual([]);
  const shortened = items.filter(item => item.item !== 'RESEARCH_PLAN');
  const issues = validateKit({ ...linked, items: shortened, omissions: [{ item: 'RESEARCH_PLAN', reason: 'Исследовательские цели не заданы', decisionBy: 'leader-1' }] });
  expect(issues).toContainEqual(expect.objectContaining({ code: 'OMISSION_ACCEPTED', severity: 'WARNING', item: 'RESEARCH_PLAN' }));
});

it('не даёт убрать карту, профиль агентов или исследование при их использовании', () => {
  const issues = validateKit({ items: [], usesLogistics: false, usesAutonomy: true, researchGoals: true, omissions: [] });
  expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['INITIAL_MAP_REQUIRED', 'AGENT_PROFILES_REQUIRED', 'RESEARCH_PLAN_REQUIRED']));
});

it('формирует частное задание без публикации общего замысла', () => {
  const assignment = buildOperationalAssignment(
    { generalSituation: 'Общие сведения', fullIntent: 'Скрытый общий замысел', referenceData: 'Справка' },
    { nodeId: 'node-1', privateSituation: 'Частные сведения', task: 'Занять район', allowedGeneralSituation: 'Разрешённые сведения' },
  );
  expect(assignment).toEqual({ nodeId: 'node-1', generalSituation: 'Разрешённые сведения', privateSituation: 'Частные сведения', task: 'Занять район' });
  expect(JSON.stringify(assignment)).not.toContain('Скрытый общий замысел');
  expect(JSON.stringify(assignment)).not.toContain('referenceData');
  expect(JSON.stringify(assignment)).not.toContain('Справка');
});

it('точно перечисляет затронутые изменением этапа связи', () => {
  const impact = stageImpact('stage-2', ['expectedActions'], {
    inputs: [{ id: 'input-1', stageIds: ['stage-2'], affectedBy: ['expectedActions'] }, { id: 'input-2', stageIds: ['stage-1'], affectedBy: ['expectedActions'] }],
    maps: [{ id: 'map-1', stageIds: ['stage-2'], affectedBy: ['initialSituation'] }],
    documents: [{ id: 'doc-1', stageIds: ['stage-2'], affectedBy: ['expectedActions'] }],
    criteria: [{ id: 'criterion-1', stageIds: ['stage-2'], affectedBy: ['expectedActions'] }],
  });
  expect(impact).toEqual({ inputs: ['input-1'], maps: [], documents: ['doc-1'], criteria: ['criterion-1'] });
});
