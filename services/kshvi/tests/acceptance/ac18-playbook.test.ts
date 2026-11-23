import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { runOfficialG2 } from '../e2e/conduct-cycle.test';
import { withKshviDatabase } from '../helpers/database';
import { SubscriptionService } from '../../src/http/subscription-service';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { evaluatePlaybook } from '../../../../packages/kshvi/src/decisions/playbook';
import { buildDebrief, type DebriefMaterial } from '../../../../packages/kshvi/src/assessment/debrief';

function snapshotHash(payload: unknown): string | undefined {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).snapshotHash as string | undefined : undefined;
}

it('AC-18: версионный плейбук эскалирует неизвестное, сохраняет мир при смене модели и не раскрывается обучаемому', { timeout: 120_000 }, async () => {
  await withKshviDatabase(async store => {
    const result = await runOfficialG2(store);
    const known = result.events.find(event => event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      && (event.payload as Record<string, unknown>).commandId === 'playbook-known');
    const unknown = result.events.find(event => event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      && (event.payload as Record<string, unknown>).commandId === 'playbook-unknown');
    const stage = result.events.find(event => event.type === 'stage.calculation.assigned.v1');
    const jump = result.events.find(event => event.type === 'time.jump.applied.v1');
    const completion = result.events.find(event => event.type === 'exercise.completed.v1');
    expect(known?.type).toBe('playbook.command.v1');
    expect(known?.payload).toMatchObject({
      causedBy: 'playbook-g2',
      result: { kind: 'COMMAND', command: 'report', ruleId: 'contact', playbookVersion: 1 },
    });
    expect(unknown?.type).toBe('playbook.escalated.v1');
    expect(unknown?.payload).toMatchObject({ causedBy: 'playbook-g2', result: { kind: 'ESCALATE', reason: 'NO_RULE' } });
    expect(JSON.stringify(unknown?.payload)).not.toContain('arbitrary');
    expect(stage?.payload).toMatchObject({ causedBy: 'stage-2', calculationProfileId: 'manual-v1' });
    expect(snapshotHash(completion?.payload)).toBe(snapshotHash(jump?.payload));
    expect(completion?.payload).toMatchObject({ status: 'COMPLETED', outcomeAuthority: 'EXERCISE_LEADER' });
    expect(result.events.map(event => event.type)).not.toContain('exercise.winner.declared.v1');

    const playbook = { id: 'playbook-g2', version: 1, rules: [{ id: 'contact', when: 'contact', command: 'report', mandatory: true }] } as const;
    expect(evaluatePlaybook(playbook, { kind: 'contact' })).toEqual(evaluatePlaybook(playbook, { kind: 'contact' }));
    const subscriptions = new SubscriptionService();
    let hiddenTraineeEvents = 0;
    for (const event of [known, unknown]) {
      if (!event) throw new Error('События плейбука не найдены');
      const projection = subscriptions.payloadFor({
        ...event,
        payload: event.payload as { side?: string; recipients?: readonly string[] } & Record<string, unknown>,
      }, { side: 'blue', role: 'TRAINEE', operationalAt: '2030-01-01T02:30:00Z', scope: 'own' });
      expect(projection).toEqual({ type: 'projection.refresh' });
      expect(JSON.stringify(projection)).not.toContain('playbook-g2');
      hiddenTraineeEvents += 1;
    }

    const scope = { instanceId: result.sessionIds[0]!, sideId: 'blue', trainingQuestions: ['q18'], audience: ['LEADER'] };
    const materials: DebriefMaterial[] = [
      { ...scope, id: 'goals-18', section: 'GOALS_STAGES', payload: { blue: ['Учебная цель blue'], red: ['Учебная цель red'] } },
      { ...scope, id: 'decisions-18', section: 'KEY_DECISIONS', payload: { comparison: [{ decisionId: 'decision-blue-2', consequences: ['Дефицит fuel: 2 Л'] }] } },
    ];
    const debrief = buildDebrief({
      scope: 'GENERAL', instanceId: scope.instanceId, trainingQuestions: scope.trainingQuestions, audience: 'LEADER', allowedSideIds: ['blue', 'red'], materials,
      referenceIntent: { ...scope, content: { goals: ['Учебная цель blue'] } },
      deviations: [{ ...scope, decisionId: 'decision-blue-2', rationale: 'Уточнённый замысел blue', consequences: ['Дефицит fuel: 2 Л'] }],
    });
    expect(debrief.materials.find(material => material.section === 'KEY_DECISIONS')?.payload).toHaveProperty('comparison');
    expect(debrief.deviations[0]?.consequences).toEqual(['Дефицит fuel: 2 Л']);
    expect(JSON.stringify(debrief)).not.toContain('automaticWinner');

    const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
    if (!runId) return;
    const directory = 'docs/release/kshvi/evidence/ac18';
    await mkdir(directory, { recursive: true });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const journalPath = `${directory}/journal.json`;
    const protocolPath = `${directory}/protocol.txt`;
    const metricsPath = `${directory}/metrics.json`;
    const journal = { runId, commit, scenarioHash: result.scenarioHash, environmentHash: result.environmentHash, events: result.events, debrief };
    const journalSha256 = hashCanonical(journal);
    const metrics = { knownReactions: 1, unknownEscalations: 1, stageTransitions: 1, hiddenTraineeEvents, automaticWinners: 0, preservedSnapshotHashes: 1 };
    await writeFile(journalPath, JSON.stringify(journal, null, 2));
    await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
    await writeFile(protocolPath, `AC-18 завершён\nrunId: ${runId}\ncommit: ${commit}\nИзвестное условие дало версионную команду; неизвестное передано группе розыгрыша; stage-2 использует manual-v1 без изменения снимка мира; обучаемый получил только projection.refresh; победитель не назначался.\n`);
    await writeFile('docs/release/kshvi/acceptance/AC-18.proof.json', JSON.stringify({
      runId, commit,
      initialRevision: { id: 'g2-ac18', revision: 1, sha256: result.scenarioHash },
      journal: { path: journalPath, sha256: journalSha256, eventCount: result.events.length },
      hashes: { scenario: result.scenarioHash, environment: result.environmentHash, journal: journalSha256 },
      protocols: [protocolPath], screenshots: [], metrics,
      limitations: ['Односторонний плейбук подтверждён в серверном G2; физическое размещение обучаемого и группы розыгрыша на отдельных устройствах проверяется на контрольном стенде.'],
      artifacts: [journalPath, protocolPath, metricsPath],
    }, null, 2));
  });
});
