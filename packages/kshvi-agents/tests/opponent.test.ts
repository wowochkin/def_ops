import { describe, expect, it } from 'vitest';
import profile from '../data/modern-profiles/balanced.json';
import {
  CONTROL_SOURCES,
  assertAgentDataRequest,
  assertModernAgentProfile,
  createEvaluationRequest,
  defaultControlAssignments,
} from '../src/ports/modern-choice';
import { evaluateChoices, type AgentEnginePort, type AgentEvaluation } from '../src/ports/agent-engine';
import type { AgentProjection } from '../src/ports/modern-choice';

const projection: AgentProjection = {
  instanceId: 'instance-1', revision: 4, agentId: 'red-command', tick: 7,
  ownOrders: [{ id: 'order-1', kind: 'ADVANCE', issuedTick: 1 }],
  observations: [{ id: 'obs-1', observedTick: 6, strength: 0.5, confidence: 0.8 }],
  reports: [{ id: 'report-1', sender: 'hq-sub', tick: 6, text: 'Готовность сохранена' }],
  ownForces: [{ id: 'force-1', hqId: 'hq-red', mps: { confidence: 0.8, stress: 0.1 }, operationalEquipment: 4, totalEquipment: 4 }],
  resources: { supplyFraction: 0.9 },
  terrain: { routeOpen: true },
  weather: { movementFactor: 0.9 },
};

describe('современный системный противник', () => {
  it('назначает противника AGENT при одной обучаемой ступени и показывает все источники', () => {
    const assignments = defaultControlAssignments({ trainedLevels: 1, opponentId: 'red-command', supportingIds: ['red-support'] });
    expect(CONTROL_SOURCES).toEqual(['HUMAN', 'SCRIPT', 'PLAYBOOK', 'AGENT', 'HYBRID']);
    expect(assignments).toEqual([
      { instanceId: 'red-command', role: 'OPPONENT', source: 'AGENT' },
      { instanceId: 'red-support', role: 'SUPPORTING', source: 'AGENT' },
    ]);
  });

  it('проверяет новый современный паспорт, а не историческую доктрину', () => {
    expect(assertModernAgentProfile(profile).version).toBe('modern-opponent-1');
    expect(() => assertModernAgentProfile({ ...profile, source: { ...profile.source, era: 'historical' } })).toThrow('современ');
    expect(() => assertModernAgentProfile({ ...profile, searchDepth: 0 })).toThrow('глубина');
  });

  it('передаёт в engine только собственные приказы, наблюдения, донесения и ресурсы', async () => {
    let received: unknown;
    const evaluation: AgentEvaluation = {
      selected: { id: 'hold', kind: 'HOLD', label: 'Удерживать', commandType: 'force.hold.v1' },
      options: [], unknown: [], forkHashes: [], destroyedForks: 0, orders: [], reports: [], trace: { safe: true },
    };
    const engine: AgentEnginePort = {
      async evaluateChoices(request) { received = request; return evaluation; },
    };
    const contaminated = {
      ...projection,
      hiddenTruth: { enemyStrength: 900 },
      traineeDrafts: ['черновик'], futureInputs: ['вводная'], officialBenchmark: { answer: 42 },
    };
    await evaluateChoices(engine, createEvaluationRequest({ profile: assertModernAgentProfile(profile), seed: 11n, projection: contaminated }));
    expect(received).toMatchObject({ projection });
    const serialized = JSON.stringify(received, (_key, value: unknown) => typeof value === 'bigint' ? `${value}n` : value);
    expect(serialized).not.toContain('900');
    expect(serialized).not.toContain('черновик');
    expect(serialized).not.toContain('вводная');
  });

  it('не раскрывает черновики, будущие вводные и служебный эталон', () => {
    for (const kind of ['TRAINEE_DRAFTS', 'FUTURE_INPUTS', 'OFFICIAL_BENCHMARK', 'HIDDEN_TRUTH'] as const) {
      expect(() => assertAgentDataRequest({ kind, requesterId: 'red-command' })).toThrow('недоступ');
    }
    expect(assertAgentDataRequest({ kind: 'OWN_OBSERVATIONS', requesterId: 'red-command' })).toEqual({ allowed: true });
  });
});


it('отклоняет маскировку скрытого запроса под собственные данные', () => {
  const disguised = { kind: 'OWN_HIDDEN_TRUTH', requesterId: 'red-command' } as unknown as Parameters<typeof assertAgentDataRequest>[0];
  expect(() => assertAgentDataRequest(disguised)).toThrow('недоступ');
});
