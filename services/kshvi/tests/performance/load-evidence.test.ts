import { resolve } from 'node:path';
import { expect, it } from 'vitest';

type Evidence = { id: string; status: 'passed' | 'failed' | 'blocked'; openErrors: string[] };
type EvidenceInput = {
  thresholdIssues: string[];
  offlineStatus: 'passed' | 'failed' | 'blocked';
  ntpStatus: 'passed' | 'failed' | 'not-verified';
  networkScope: 'physical-lan' | 'loopback';
  report: {
    connections: number;
    activeParticipants: number;
    delivery: { p95Ms: number; samples: number };
    map: { p95Ms: number; samples: number };
    deliveryMissing: number;
    confirmedLost: number;
    duplicateEffects: number;
    orderingErrors: number;
    sustained: { achievedRate: number; targetRate: number };
    burst: { achievedRate: number; targetRate: number; durationSeconds: number; commands: number };
    dataset: { instances: number; forces: number; events: number };
    heavyJobs: { attempted: number; completed: number; maxRunning: number };
    time: { clientClockIndependent: boolean };
  };
};
type EvidenceModule = { buildNfEvidence(input: EvidenceInput): Evidence[] };
const loadModule = async () => import(resolve('scripts/kshvi-load-test.mjs')) as Promise<EvidenceModule>;

const report: EvidenceInput['report'] = {
  connections: 50,
  activeParticipants: 25,
  delivery: { p95Ms: 100, samples: 1500 },
  map: { p95Ms: 100, samples: 1500 },
  deliveryMissing: 0,
  confirmedLost: 0,
  duplicateEffects: 0,
  orderingErrors: 0,
  sustained: { achievedRate: 5, targetRate: 5 },
  burst: { achievedRate: 20, targetRate: 20, durationSeconds: 60, commands: 1200 },
  dataset: { instances: 100, forces: 1000, events: 10_000 },
  heavyJobs: { attempted: 4, completed: 4, maxRunning: 2 },
  time: { clientClockIndependent: true },
};

it('не повышает NF при нарушенных порогах, отсутствии NTP или физического LAN', async () => {
  const { buildNfEvidence } = await loadModule();
  const base = { report, thresholdIssues: [], offlineStatus: 'passed' as const, ntpStatus: 'passed' as const, networkScope: 'physical-lan' as const };
  expect(buildNfEvidence(base).map(item => item.status)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed']);
  expect(buildNfEvidence({ ...base, networkScope: 'loopback' }).slice(0, 4).map(item => item.status)).toEqual(['blocked', 'blocked', 'blocked', 'blocked']);
  expect(buildNfEvidence({ ...base, ntpStatus: 'not-verified' })[4]?.status).toBe('blocked');
  const degraded = buildNfEvidence({ ...base, thresholdIssues: ['DELIVERY_P95_EXCEEDED'] });
  expect(degraded.filter(item => item.status === 'failed').map(item => item.id)).toEqual(['NF-02', 'NF-03', 'NF-04']);
  expect(buildNfEvidence({ ...base, report: { ...base.report, time: { clientClockIndependent: false } } })[4]?.status).toBe('failed');
});
