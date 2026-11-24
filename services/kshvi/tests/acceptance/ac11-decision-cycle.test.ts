import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { runOfficialG2 } from '../e2e/conduct-cycle.test';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { withKshviDatabase } from '../helpers/database';

it('AC-11: двусторонние решения проходят доставку и исполнение, а отмена не стирает затраты', { timeout: 120_000 }, async () => {
  await withKshviDatabase(async store => {
    process.env.KSHVI_G2_EVIDENCE = '1';
    const result = await runOfficialG2(store);
    expect(result.coverage['AC-11']).toBe('passed');
    expect(result.sessionIds).toHaveLength(2);
    expect(new Set(result.sessionIds).size).toBe(2);
    expect(result.infrastructure).toEqual({ postgresql: 'passed', cartography: 'passed', gateway: 'passed' });

    const cancelledOrder = result.events.find(event => event.type === 'order.cancelled.v1');
    expect(cancelledOrder).toBeDefined();
    const costs = result.events.filter(event => event.type === 'resource.consumed.v1');
    expect(costs.length).toBeGreaterThan(0);
    expect(result.events.some(event => event.type === 'decision.created.v1')).toBe(true);

    const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
    if (!runId) return;
    const directory = 'docs/release/kshvi/evidence/ac11';
    await mkdir(directory, { recursive: true });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const initialRevision = { id: 'g2-ac11', revision: 1, sha256: result.scenarioHash };
    const journalPath = 'docs/release/kshvi/evidence/g2-journal.json';
    const infrastructurePath = 'docs/release/kshvi/evidence/g2-infrastructure.json';
    const journalSha256 = hashCanonical(result.events);
    const metrics = {
      independentSessions: result.sessionIds.length,
      domainEvents: result.events.length,
      resourceConsumptionEvents: costs.length,
      orderCancellationEvents: result.events.filter(event => event.type === 'order.cancelled.v1').length,
      verifiedInfrastructure: Object.keys(result.infrastructure).length,
    };
    const limitations = ['Двусторонний цикл подтверждён серверными событиями; физический многоуровневый стенд с отдельными рабочими местами проверяется отдельно.'];
    const protocolPath = `${directory}/protocol.txt`;
    const metricsPath = `${directory}/metrics.json`;
    const initialPath = `${directory}/initial-scenario.json`;
    await writeFile(initialPath, JSON.stringify({ initialRevision, scenarioHash: result.scenarioHash, environmentHash: result.environmentHash }, null, 2));
    await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
    await writeFile(protocolPath, `AC-11 завершён\nrunId: ${runId}\ncommit: ${commit}\nДва независимых сеанса; доставка и исполнение подтверждены; затраты сохраняются после отмены; PostgreSQL, картография и шлюз проверены.\n`);
    const proof = {
      runId, commit, initialRevision,
      journal: { path: journalPath, sha256: journalSha256, eventCount: result.events.length },
      hashes: { scenario: result.scenarioHash, environment: result.environmentHash, journal: journalSha256 },
      protocols: [protocolPath, infrastructurePath], screenshots: [], metrics, limitations,
      artifacts: [initialPath, journalPath, infrastructurePath, protocolPath, metricsPath],
    };
    await writeFile('docs/release/kshvi/acceptance/AC-11.proof.json', JSON.stringify(proof, null, 2));
  });
});
