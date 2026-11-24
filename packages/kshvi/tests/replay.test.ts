import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import {
  REPLAY_FACT_TYPES,
  ReplayReducerRegistry,
  journalCoverage,
  replayStateHash,
  restoreAt,
} from '../src/replay/replay-engine';
import { replayClockAt } from '../src/replay/replay-clock';
import { traceCauses } from '../src/replay/causal-links';
import { makeReplayArchive, replayDomains } from './fixtures/replay-archive';

it('восстанавливает сохранённый выбор из ближайшего снимка без повторного розыгрыша', () => {
  const archive = makeReplayArchive();
  const scheduler = vi.fn(() => { throw new Error('повторный розыгрыш запрещён'); });
  const languageModel = vi.fn(() => { throw new Error('внешний вызов запрещён'); });
  const random = vi.fn(() => { throw new Error('новый RNG запрещён'); });
  const externalService = vi.fn(() => { throw new Error('внешний сервис запрещён'); });
  const first = restoreAt({ archive, cursor: 3, scheduler, languageModel, random, externalService, playbackSpeed: 8 });
  const second = restoreAt({ archive, cursor: 3, scheduler, languageModel, random, externalService, playbackSpeed: 0.5 });
  expect(first.snapshotId).toBe('snapshot-2');
  expect(first.appliedEventIds).toEqual(['event-3']);
  expect(first.state.domains.Decisions).toEqual({ value: 4, selected: 'saved-choice' });
  expect(first.stateHash).toBe(second.stateHash);
  expect(first.stateHash).toBe(replayStateHash(first.state));
  for (const port of [scheduler, languageModel, random, externalService]) expect(port).not.toHaveBeenCalled();
});

it('сохраняет полный журнал фактов, отклонённые команды, сбои и две шкалы времени', () => {
  const archive = makeReplayArchive();
  const fullJournal = REPLAY_FACT_TYPES.map((type, index) => ({ ...archive.events[index % archive.events.length], eventId: `fact-${index}`, sequence: index + 1, type }));
  expect(journalCoverage(fullJournal)).toEqual([]);
  expect(journalCoverage(archive.events)).toEqual(REPLAY_FACT_TYPES.filter(type => !archive.events.some(event => event.type === type)));
  expect(archive.events.some(event => event.type === 'command.rejected')).toBe(true);
  expect(archive.events.some(event => event.type === 'technical.failure')).toBe(true);
  const frame = restoreAt({ archive, cursor: 3 });
  expect(frame.clock.operationalAt).toBe('2026-11-21T06:03:00.000Z');
  expect(frame.clock.wallClockAt).toBe('2026-11-21T09:03:00.000Z');
  expect(replayClockAt(archive, 3, 16).playbackSpeed).toBe(16);
});

it('не создаёт новое событие при повторном восстановлении и идёт от замечания к причинам', () => {
  const archive = makeReplayArchive();
  const before = archive.events.length;
  const first = restoreAt({ archive, cursor: 3 });
  const second = restoreAt({ archive, cursor: 3 });
  expect(first.events).toEqual(second.events);
  expect(archive.events).toHaveLength(before);
  expect(traceCauses(archive, 'event-3').map(event => event.eventId)).toEqual(['event-3', 'event-1']);
});

it('использует сохранённую версию reducer и не заявляет идентичность при несовместимости', () => {
  const archive = makeReplayArchive();
  archive.snapshots = archive.snapshots.filter(snapshot => snapshot.sequence === 0);
  archive.events = archive.events.slice(0, 1);
  archive.snapshots[0] = { ...archive.snapshots[0], reducerVersion: 7 };
  archive.versions.reducerVersion = 7;
  const registry = new ReplayReducerRegistry();
  registry.register(7, (state, event) => ({
    ...state,
    domains: { ...state.domains, Map: { legacy: event.eventId } },
    appliedEventIds: [...state.appliedEventIds, event.eventId],
  }));
  expect(restoreAt({ archive, cursor: 1, reducerRegistry: registry }).compatibility).toBe('REPRODUCIBLE');
  expect(restoreAt({ archive, cursor: 1 }).compatibility).toBe('INCOMPATIBLE_READ');
  expect(restoreAt({ archive, cursor: 1 }).stateHash).toBeNull();
  expect(restoreAt({ archive, cursor: 1 }).identityClaimed).toBe(false);
});

it('даёт идентичный хеш в отдельном процессе', () => {
  const archive = makeReplayArchive();
  const local = restoreAt({ archive, cursor: 3 }).stateHash;
  const script = fileURLToPath(new URL('./fixtures/replay-hash.mjs', import.meta.url));
  const remote = execFileSync(process.execPath, ['--import', 'tsx', script], { encoding: 'utf8' }).trim();
  expect(remote).toBe(local);
});

it('проверяет сохранённые контрольные точки и последовательность событий', () => {
  const archive = makeReplayArchive();
  const frame = restoreAt({ archive, cursor: 3 });
  archive.controlPoints = [{ sequence: 3, stateHash: frame.stateHash! }];
  expect(restoreAt({ archive, cursor: 3 }).stateHash).toBe(frame.stateHash);
  archive.controlPoints = [{ sequence: 3, stateHash: '0'.repeat(64) }];
  expect(() => restoreAt({ archive, cursor: 3 })).toThrow('Контрольный хеш');
  const gapped = { ...makeReplayArchive(), events: [makeReplayArchive().events[0], makeReplayArchive().events[2]] };
  expect(() => restoreAt({ archive: gapped, cursor: 3 })).toThrow('последовательность');
});

it('инициализирует все синхронизируемые домены без подмены неизвестного нулём', () => {
  const domains = replayDomains();
  expect(Object.keys(domains)).toHaveLength(22);
  const archive = makeReplayArchive();
  archive.snapshots[1].state.domains.Resources = { status: 'UNKNOWN', reason: 'Нет донесения' };
  const frame = restoreAt({ archive, cursor: 2 });
  expect(frame.state.domains.Resources).toEqual({ status: 'UNKNOWN', reason: 'Нет донесения' });
});
