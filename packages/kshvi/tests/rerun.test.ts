import { expect, it } from 'vitest';
import { compareReruns, createRerun, rankReruns } from '../src/replay/rerun';

const source = {
  sessionId: 'session-1', scenarioRevision: { id: 'scenario', revision: 3, sha256: 'a'.repeat(64) },
  participants: [{ participantId: 'assignment-1', userId: 'user-1', role: 'COMMANDER' }],
  roles: { 'assignment-1': 'COMMANDER' },
  versions: {
    model: { id: 'model', revision: 1, sha256: 'b'.repeat(64) },
    environment: { id: 'environment', revision: 1, sha256: 'c'.repeat(64) }, reducerVersion: 1,
  },
};

it('копирует редакцию в новый сеанс с новыми участниками и протоколом различий', () => {
  const rerun = createRerun(source, {
    sessionId: 'session-2', participants: [{ participantId: 'assignment-2', userId: 'user-2', role: 'COMMANDER' }],
    roles: { 'assignment-2': 'COMMANDER' },
    environment: { id: 'environment', revision: 2, sha256: 'd'.repeat(64) },
  });
  expect(rerun.sessionId).toBe('session-2');
  expect(rerun.scenarioRevision).toEqual(source.scenarioRevision);
  expect(rerun.participants[0].participantId).toBe('assignment-2');
  expect(rerun.comparison.environment).toContain('environment: 1 → 2');
  expect(rerun.comparison.composition).not.toEqual([]);
  expect(rerun.comparison.roles).not.toEqual([]);
  expect(rerun.ranking).toBeNull();
  expect(compareReruns(source, rerun).model).toEqual([]);
  expect(() => rankReruns()).toThrow('единый рейтинг');
});
