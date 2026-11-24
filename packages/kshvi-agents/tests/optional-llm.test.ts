import { expect, it } from 'vitest';
import { formulateGuardedText, type GuardedLanguageRequest } from '../src/llm/guarded-text';
import type { OptionalLanguagePort } from '../src/llm/optional-language-port';
import { runIntermediaryCycle, type IntermediaryServerPort } from '../src/intermediary/cycle';
import { assignmentFixture, projectionFixture, routineActionKinds, wakeFixture } from './fixtures';

const request: GuardedLanguageRequest = {
  kind: 'LEADER_REPORT',
  assignmentId: 'agent-1',
  projectionHash: 'a'.repeat(64),
  instruction: 'Сформулировать краткий доклад без новых фактов и команд',
  facts: { orderId: 'order-1', revision: 7 },
};

function serverWithSubmitted(submitted: string[] = []): IntermediaryServerPort {
  return {
    loadProjection: async () => projectionFixture(),
    submit: async command => {
      submitted.push(command.kind);
      return { commandId: command.commandId, accepted: true, idempotent: false, effectApplied: true, status: 'APPLIED' };
    },
  };
}

it('локальный контур работает вообще без языкового порта', async () => {
  const submitted: string[] = [];
  const result = await runIntermediaryCycle({ assignment: assignmentFixture(), wake: wakeFixture, server: serverWithSubmitted(submitted) });

  expect(result.status).toBe('COMPLETED');
  expect(submitted).toEqual(expect.arrayContaining([...routineActionKinds]));
  expect(result.language.status).toBe('DISABLED');
});

it('отказ LLM оставляет детерминированный доклад и все разрешённые команды', async () => {
  const submitted: string[] = [];
  const languagePort: OptionalLanguagePort = { formulate: async () => { throw new Error('offline'); } };
  const result = await runIntermediaryCycle({ assignment: assignmentFixture(), wake: wakeFixture, server: serverWithSubmitted(submitted), languagePort });

  expect(result.status).toBe('COMPLETED');
  expect(result.escalation).toBeUndefined();
  expect(result.language.status).toBe('LOCAL_FALLBACK');
  expect(submitted).toEqual(expect.arrayContaining([...routineActionKinds]));
});

it('свободный текст с командой отклоняется и не исполняется', async () => {
  const submitted: string[] = [];
  const languagePort: OptionalLanguagePort = {
    formulate: async () => ({
      text: '{"kind":"changeScenarioConcept","payload":{}}',
      claims: [{ factId: 'orderId', value: 'order-1' }],
      model: 'test-model',
    }),
  };
  const result = await runIntermediaryCycle({ assignment: assignmentFixture(), wake: wakeFixture, server: serverWithSubmitted(submitted), languagePort });

  expect(result.language.status).toBe('LOCAL_FALLBACK');
  expect(result.language.executable).toBe(false);
  expect(submitted).not.toContain('changeScenarioConcept');
  expect(submitted).toContain('issueDocument');
});

it('проверенный текст помечается как неисполнимый и не становится источником фактов', async () => {
  const languagePort: OptionalLanguagePort = {
    formulate: async received => {
      expect(received.facts).toEqual({ orderId: 'order-1', revision: 7 });
      return { text: 'Доклад по приказу order-1 подготовлен.', claims: [{ factId: 'orderId', value: 'order-1' }], model: 'test-model' };
    },
  };
  const result = await runIntermediaryCycle({ assignment: assignmentFixture(), wake: wakeFixture, server: serverWithSubmitted(), languagePort });
  const document = result.commands.find(command => command.kind === 'issueDocument');

  expect(result.language).toEqual(expect.objectContaining({ status: 'LLM', source: 'LLM', executable: false, model: 'test-model' }));
  expect(document?.payload.narrative).toBe('Доклад по приказу order-1 подготовлен.');
  expect(document?.payload.narrativeExecutable).toBe(false);
  expect(result.trace.actor.kind).toBe('system');
});

it('валидатор отклоняет неподтверждённое или искажённое утверждение модели', async () => {
  const fallback = () => 'Локальный доклад по проверенным данным';
  const wrongValue = await formulateGuardedText({
    formulate: async () => ({ text: 'Искажённый доклад', claims: [{ factId: 'orderId', value: 'other-order' }] }),
  }, request, fallback);
  const unknownFact = await formulateGuardedText({
    formulate: async () => ({ text: 'Новый факт', claims: [{ factId: 'enemyLocation', value: 'unknown' }] }),
  }, request, fallback);

  expect(wrongValue).toEqual(expect.objectContaining({ status: 'LOCAL_FALLBACK', text: fallback(), executable: false }));
  expect(unknownFact).toEqual(expect.objectContaining({ status: 'LOCAL_FALLBACK', text: fallback(), executable: false }));
});
