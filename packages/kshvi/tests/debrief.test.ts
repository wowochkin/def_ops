import { expect, it } from 'vitest';
import { buildDebrief, publishDebrief, REQUIRED_DEBRIEF_SECTIONS, type DebriefMaterial } from '../src/assessment/debrief';

const sections = REQUIRED_DEBRIEF_SECTIONS.map((section, index): DebriefMaterial => ({
  id: `material-${index}`, section, instanceId: index === 0 ? 'hq-other' : 'hq-1', sideId: index % 2 ? 'red' : 'blue',
  trainingQuestions: ['question-1'], audience: ['GENERAL', 'PRIVATE', 'PUBLIC', 'commanders'], payload: { text: `Раздел ${section}` },
}));

it('формирует общий и частный разбор с полными разделами и ограничением инстанции', () => {
  const general = buildDebrief({
    scope: 'GENERAL', instanceId: 'all', trainingQuestions: ['question-1'], audience: 'GENERAL', allowedSideIds: ['blue', 'red'], materials: sections,
    referenceIntent: { text: 'Замысел руководства' }, deviations: [{ decisionId: 'd1', instanceId: 'hq-1', sideId: 'blue', trainingQuestions: ['question-1'], audience: ['GENERAL', 'commanders'], rationale: 'Обоснование', consequences: ['Последствие'] }],
  });
  expect(general.materials.map(material => material.section)).toEqual(REQUIRED_DEBRIEF_SECTIONS);
  expect(general.reference.kind).toBe('LEADERSHIP_INTENT');
  expect(general.reference.notTheOnlyCorrectSolution).toBe(true);
  expect(general.deviations[0].consequences).toEqual(['Последствие']);
  const privateDebrief = buildDebrief({
    scope: 'PRIVATE', instanceId: 'hq-1', trainingQuestions: ['question-1'], audience: 'PRIVATE', allowedSideIds: ['blue'], materials: sections,
    referenceIntent: { text: 'Замысел' }, deviations: [],
  });
  expect(privateDebrief.materials.every(material => material.instanceId === 'hq-1' && material.sideId === 'blue')).toBe(true);
  expect(privateDebrief.materials.some(material => material.instanceId === 'hq-other')).toBe(false);
});

it('публикация фиксирует редакцию и аудиторию и исключает служебные черновики', () => {
  const debrief = buildDebrief({
    scope: 'GENERAL', instanceId: 'all', trainingQuestions: ['question-1'], audience: 'GENERAL', allowedSideIds: ['blue'], materials: sections,
    referenceIntent: { text: 'Замысел' }, deviations: [],
  });
  debrief.draftComments = ['Служебный секретный черновик'];
  const published = publishDebrief(debrief, { revision: 3, audience: ['commanders'], publishedBy: 'leader-1', publishedAt: '2026-11-21T12:00:00Z' });
  expect(published.revision).toBe(3);
  expect(published.audience).toEqual(['commanders']);
  expect(JSON.stringify(published)).not.toContain('Служебный секретный черновик');
  expect(published).not.toHaveProperty('draftComments');
});


it('общий разбор объединяет разрешённые материалы разных сторон в одном разделе', () => {
  const materials: DebriefMaterial[] = [
    { id: 'blue-decision', section: 'KEY_DECISIONS', instanceId: 'blue-hq', sideId: 'blue', trainingQuestions: ['q'], audience: ['GENERAL'], payload: { text: 'Решение синих' } },
    { id: 'red-decision', section: 'KEY_DECISIONS', instanceId: 'red-hq', sideId: 'red', trainingQuestions: ['q'], audience: ['GENERAL'], payload: { text: 'Решение красных' } },
  ];
  const debrief = buildDebrief({
    scope: 'GENERAL', instanceId: 'all', trainingQuestions: ['q'], audience: 'GENERAL', allowedSideIds: ['blue', 'red'], materials,
    referenceIntent: { text: 'Замысел' }, deviations: [],
  });
  expect(debrief.materials.filter(material => material.section === 'KEY_DECISIONS').map(material => material.id)).toEqual(['blue-decision', 'red-decision']);
});
