import { expect, it } from 'vitest';
import { REPLAY_DOMAINS, restoreAt } from '../src/replay/replay-engine';
import { makeReplayArchive } from './fixtures/replay-archive';

it('синхронизирует карту, МПС, технику, МТО, местность, планировщик, агентов и остальные панели', () => {
  const archive = makeReplayArchive();
  const frame = restoreAt({ archive, cursor: 4 });
  expect(Object.keys(frame.state.domains)).toEqual([...REPLAY_DOMAINS]);
  for (const domain of REPLAY_DOMAINS) {
    expect(frame.panels[domain].sequence).toBe(4);
    expect(frame.panels[domain].source).toBe('TRUTH');
  }
  expect(frame.state.domains.MoralePsych).toBeDefined();
  expect(frame.state.domains.ReadinessActivities).toBeDefined();
  expect(frame.state.domains.SupplyMovements).toBeDefined();
  expect(frame.state.domains.RepairEvacuation).toBeDefined();
  expect(frame.state.domains.TerrainVersions).toBeDefined();
  expect(frame.state.domains.SchedulerAttempts).toBeDefined();
  expect(frame.state.domains.AgentCycles).toBeDefined();
  expect(frame.state.domains.AgentInterceptions).toBeDefined();
});

it('восстанавливает сохранённые ключи планировщика и след агента без повторного выбора', () => {
  const archive = makeReplayArchive();
  archive.events[2].savedTrace = {
    schedulerAttempts: [{ candidates: ['saved-event'], selected: 'saved-event', randomKey: archive.events[2].randomKey ?? null }],
    agentDecision: { cycle: 4, intercepted: true, selected: 'saved-choice', explanation: 'Сохранённое объяснение' },
  };
  const frame = restoreAt({ archive, cursor: 3 });
  expect(frame.traces).toHaveLength(1);
  expect(frame.traces[0].agentDecision).toMatchObject({ selected: 'saved-choice', cycle: 4 });
  expect(frame.traces[0].schedulerAttempts[0]).toMatchObject({ selected: 'saved-event' });
});
