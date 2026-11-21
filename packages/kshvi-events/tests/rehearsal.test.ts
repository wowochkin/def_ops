import { describe, expect, it } from 'vitest';
import { rehearseCatalog } from '../src/rehearsal/rehearse';
import { serializeRehearsalReport } from '../src/rehearsal/rehearsal-report';
import { blueNorthTarget, makeProfile, makeState, makeTemplate } from './fixtures/autonomy';

function rehearsalInput() {
  return {
    templates: [
      makeTemplate(),
      makeTemplate({ templateId: 'recon-01', category: 'reconnaissance', learningQuestion: 'Проверить пересмотр сведений.' }),
    ],
    profile: makeProfile('CUSTOM', { attemptsPerOperationalHour: 12, maxEventsPerInterval: 3 }),
    seeds: ['seed-a', 'seed-b'],
    fromSecond: 0,
    toSecond: 14_400,
    state: makeState(),
    targets: [blueNorthTarget],
    branchId: 'branch-rehearsal',
    snapshotHash: 'snapshot-rehearsal',
    templateSetVersion: 'catalog-rehearsal-v1',
  };
}

describe('Ускоренные граничные репетиции', () => {
  it('обязательно сравнивает нулевой и высокий профили на нескольких зернах', () => {
    const report = rehearseCatalog(rehearsalInput());
    expect(report.reportVersion).toBe(1);
    expect(report.runs).toHaveLength(4);
    const zeroRuns = report.runs.filter(run => run.profileLevel === 'OFF');
    const highRuns = report.runs.filter(run => run.profileLevel === 'CUSTOM');
    expect(zeroRuns).toHaveLength(2);
    expect(highRuns).toHaveLength(2);
    expect(zeroRuns.every(run => run.eventCount === 0 && run.attemptCount === 0 && run.emptyIntervals > 0)).toBe(true);
    expect(highRuns.every(run => run.attemptCount > 0)).toBe(true);
    expect(highRuns.every(run => (run.frequenciesByCategory.logistics ?? 0) > 0)).toBe(true);
    expect(highRuns.every(run => run.learningQuestions.length > 0)).toBe(true);
    expect(report.runs.every(run => run.rejectionReasons && typeof run.controlHash === 'string')).toBe(true);
    expect(report.runs.every(run => Number.isSafeInteger(run.maxCascadeDepth) && Number.isSafeInteger(run.maxCascadeEvents))).toBe(true);
    expect(report).not.toHaveProperty('createdAt');
  });

  it('повторяет отчёт и сериализацию без обязательства равенства разных зёрен', () => {
    const first = rehearseCatalog(rehearsalInput());
    const second = rehearseCatalog(rehearsalInput());
    expect(second).toEqual(first);
    expect(serializeRehearsalReport(second)).toBe(serializeRehearsalReport(first));
    expect(first.runs.find(run => run.seed === 'seed-a' && run.profileLevel === 'CUSTOM')?.controlHash).not.toBe(
      first.runs.find(run => run.seed === 'seed-b' && run.profileLevel === 'CUSTOM')?.controlHash,
    );
    expect(first.runs.filter(run => run.profileLevel === 'CUSTOM').every(run => run.eventCount <= 12)).toBe(true);
  });

  it('отмечает перегрузку и причины исчерпания лимитов', () => {
    const report = rehearseCatalog({
      ...rehearsalInput(),
      profile: makeProfile('CUSTOM', { attemptsPerOperationalHour: 100, maxEventsPerInterval: 1 }),
      seeds: ['overload-seed'],
    });
    const high = report.runs.find(run => run.profileLevel === 'CUSTOM');
    expect(high?.overloadWarnings.some(warning => warning.code === 'EVENT_INTERVAL_LIMIT')).toBe(true);
    expect(high?.rejectionReasons.EVENT_INTERVAL_LIMIT).toBeGreaterThan(0);
  });
});
