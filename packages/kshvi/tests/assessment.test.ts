import { expect, it } from 'vitest';
import { approveAssessment, draftAssessment } from '../src/assessment/assessment-sheet';

const input = {
  scope: 'INDIVIDUAL' as const, subjectId: 'participant-1', criteria: ['Своевременность решения'], scale: ['удовлетворительно', 'хорошо'],
  observations: [{ eventId: 'event-1', text: 'Решение принято после уточнения' }], positiveFacts: ['Запрошены данные'], negativeFacts: ['Позднее донесение'],
  comment: 'Требуется разбор', assessor: { id: 'assessor-1', role: 'ASSESSOR' }, systemProposal: 'Проект: хорошо',
};

it('отделяет проект системы от итоговой человеческой оценки', () => {
  const draft = draftAssessment(input);
  expect(draft.status).toBe('DRAFT');
  expect(draft.systemProposal).toBe('Проект: хорошо');
  expect(draft.finalAssessment).toBeNull();
  expect(draft.confirmation).toBeNull();
  expect(draft).not.toHaveProperty('totalScore');
  expect(() => approveAssessment(draft, {
    finalAssessment: 'хорошо', comment: 'Итог', confirmedBy: { id: 'system', role: 'SYSTEM' }, confirmedAt: '2026-11-21T12:00:00Z',
  })).toThrow('человек');
});

it('подтверждает индивидуальный и коллективный лист только руководителем', () => {
  const draft = draftAssessment(input);
  const approved = approveAssessment(draft, {
    finalAssessment: 'хорошо', comment: 'Итоговый качественный разбор',
    confirmedBy: { id: 'leader-1', role: 'LEADER' }, confirmedAt: '2026-11-21T12:00:00Z',
  });
  expect(approved.status).toBe('APPROVED');
  expect(approved.finalAssessment).toBe('хорошо');
  expect(approved.confirmation).toMatchObject({ id: 'leader-1', role: 'LEADER' });
  expect(approved.systemProposal).toBe('Проект: хорошо');
  const collective = draftAssessment({ ...input, scope: 'COLLECTIVE', subjectId: 'headquarters-1' });
  expect(collective.scope).toBe('COLLECTIVE');
  expect(collective.finalAssessment).toBeNull();
});
