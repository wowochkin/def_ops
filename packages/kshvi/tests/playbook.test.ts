import { expect, it } from 'vitest';
import { assignStageCalculationProfile, evaluatePlaybook } from '../src/decisions/playbook';

it('не выдумывает действие вне плейбука', () => {
  expect(evaluatePlaybook({ rules: [{ when: 'contact', command: 'report' }] }, { kind: 'unknown' })).toEqual({ kind: 'ESCALATE', reason: 'NO_RULE' });
});

it('воспроизводимо выполняет известное обязательное правило с объяснением', () => {
  const playbook = { id: 'playbook-1', version: 3, rules: [{ id: 'rule-contact', when: 'contact', command: 'report', mandatory: true }] } as const;
  const first = evaluatePlaybook(playbook, { kind: 'contact' });
  const second = evaluatePlaybook(playbook, { kind: 'contact' });
  expect(first).toEqual(second);
  expect(first).toMatchObject({ kind: 'COMMAND', command: 'report', ruleId: 'rule-contact', playbookVersion: 3 });
});

it('явно разграничивает обязательный плейбук и разрешённое поведение агента', () => {
  const playbook = {
    id: 'playbook-2', version: 1,
    rules: [{ id: 'mandatory', when: 'contact', command: 'report', mandatory: true }],
    agent: { allowedCommands: ['hold', 'observe'] },
  } as const;
  expect(evaluatePlaybook(playbook, { kind: 'contact' })).toMatchObject({ kind: 'COMMAND', command: 'report' });
  expect(evaluatePlaybook(playbook, { kind: 'patrol' })).toEqual({ kind: 'AGENT', allowedCommands: ['hold', 'observe'], reason: 'NO_MANDATORY_RULE' });
  expect(evaluatePlaybook(playbook, { kind: 'unknown' })).toEqual({ kind: 'ESCALATE', reason: 'NO_RULE' });
});

it('назначает модель нового этапа явно и сохраняет состояние', () => {
  const stage = assignStageCalculationProfile(
    { stageId: 'stage-1', calculationProfileId: 'profile-1', state: { remainingMeters: 500 } },
    { stageId: 'stage-2', calculationProfileId: 'profile-2' },
  );
  expect(stage).toEqual({ stageId: 'stage-2', calculationProfileId: 'profile-2', state: { remainingMeters: 500 } });
  expect(() => assignStageCalculationProfile({ stageId: 'stage-1', calculationProfileId: 'profile-1', state: {} }, { stageId: 'stage-2' })).toThrow('расчётный профиль');
});
