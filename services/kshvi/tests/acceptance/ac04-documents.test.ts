import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createService } from '@def-ops/service-kit';
import { afterEach, expect, it } from 'vitest';
import { buildRouter } from '../../src/app';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { CommandService } from '../../src/instances/command-service';
import { publishChainEvent, SubscriptionService } from '../../src/http/subscription-service';
import { verifyExportSet } from '../../../../packages/kshvi/src/documents/export-set';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { withKshviDatabase } from '../helpers/database';

const services: Array<ReturnType<typeof createService>> = [];
afterEach(async () => { while (services.length) await services.pop()?.close(); });
const documentDraft = (body: string) => ({
  id: 'document-1:r1', documentId: 'document-1', revision: 1,
  requisites: {
    exerciseId: 'ac04', scenarioRevisionId: 'scenario-r1', instanceId: 'ac04', authorId: 'author', category: 'OPERATIONAL', type: 'ORDER',
    title: 'Распоряжение', number: '1', operationalAt: '2030-01-01T01:00:00+03:00', place: 'Район', validFrom: '2030-01-01T00:00:00+03:00',
    validUntil: '2030-01-02T00:00:00+03:00', stageId: 'stage', sideId: 'blue', visibility: { sideIds: ['blue'], instanceIds: [], roles: [] },
    addressees: [{ instanceId: 'node-1', channelId: 'radio' }, { instanceId: 'node-2', channelId: 'radio' }], copies: [], sourceRole: 'LEADER',
    deliveryChannelId: 'radio', basis: 'decision-1', executorId: 'node-1', deadlineAt: '2030-01-01T02:00:00+03:00',
    linkedEventIds: [], linkedDecisionIds: ['decision-1'], linkedTaskIds: ['task'], templateVersion: '1',
  },
  content: { body, units: { distance: 'км' } },
  map: { environmentSnapshotId: 'environment-1', legend: ['Синие: свои'], attribution: ['© Учебный источник'], visibility: { sideIds: ['blue'], instanceIds: [], roles: [] } },
  attachments: [], approvalRouteId: 'dual-chain', supersedes: null, supersedesRevision: null, supersedeReason: null,
}) as const;

it('AC-04: двойная вертикаль, каскад и новая редакция сохраняют доказательства', async () => {
  await withKshviDatabase(async store => {
    const sessions = new SessionManager({ store: new InMemorySessionStore() });
    const logins = new Map<string, { token: string; csrfToken: string }>();
    for (const [userId, role] of [['author', 'AUTHOR'], ['command', 'APPROVER'], ['service', 'APPROVER'], ['director', 'DIRECTOR']] as const) {
      await sessions.createAccount({
        userId, username: userId, password: 'secret123', organizationId: 'org-ac04',
        roles: [{ id: `role-${userId}`, role, sideId: 'blue', authorities: ['instance:command', 'projection:read'], assignedNodeIds: ['node-1', 'node-2'] }],
      });
      const login = await sessions.login(userId, 'secret123');
      await sessions.selectRole(login.token, `role-${userId}`);
      logins.set(userId, login);
    }
    const operations = {
      knownInstanceIds: ['ac04', 'node-1', 'node-2'], availableChannelIds: ['radio'], channels: [], nodes: [],
      approvalAssignments: { command: ['command'], service: ['service'], finalApproverId: 'director' },
      treeEdges: [{ from: 'ac04', to: 'node-1' }, { from: 'node-1', to: 'node-2' }],
      cascadeLegs: [
        { id: 'leg-1', from: 'ac04', to: 'node-1', channelId: 'radio', delayMinutes: 0, relayId: 'relay-1', processingDeadlineAt: '2030-01-01T02:00:00+03:00' },
        { id: 'leg-2', from: 'node-1', to: 'node-2', channelId: 'radio', delayMinutes: 30, relayId: 'relay-2', processingDeadlineAt: '2030-01-01T02:00:00+03:00' },
      ],
    } as const;
    const subscriptions = new SubscriptionService();
    const commands = new CommandService({ store, organizationId: 'org-ac04', operations, eventSink: event => publishChainEvent(subscriptions, event) });
    const service = createService({ name: 'kshvi-ac04', port: 0, router: buildRouter({ sessions, commands, subscriptions }) });
    services.push(service);
    const port = await service.listen();
    const base = `http://127.0.0.1:${port}`;
    const command = async (userId: string, expectedRevision: number, type: string, payload: Record<string, unknown>, expected = 200) => {
      const response = await fetch(`${base}/kshvi/instances/ac04/commands`, {
        method: 'POST', headers: { Authorization: `Bearer ${logins.get(userId)!.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: 'main', expectedRevision, idempotencyKey: `${type}-${expectedRevision}-${userId}`, type, at: '2030-01-01T01:00:00+03:00', payload }),
      });
      const text = await response.text();
      expect(response.status, text).toBe(expected);
      return text;
    };
    await command('author', 0, 'document.create', { revision: documentDraft('') });
    await command('author', 1, 'document.transition', { documentId: 'document-1', action: 'SUBMIT' });
    await command('command', 2, 'document.approval', { documentId: 'document-1', decision: { branch: 'command', decision: 'APPROVED' } });
    await command('service', 3, 'document.approval', { documentId: 'document-1', decision: { branch: 'service', decision: 'APPROVED' } });
    await command('director', 4, 'document.transition', { documentId: 'document-1', action: 'APPROVE' }, 500);
    await command('author', 4, 'document.edit', { documentId: 'document-1', changes: { content: { body: 'Выполнить задачу', units: { distance: 'км' } } } });
    await command('author', 5, 'document.transition', { documentId: 'document-1', action: 'SUBMIT' });
    await command('command', 6, 'document.approval', { documentId: 'document-1', decision: { branch: 'command', decision: 'APPROVED', comment: 'Согласовано' } });
    await command('service', 7, 'document.approval', { documentId: 'document-1', decision: { branch: 'service', decision: 'CHANGES_REQUESTED', comment: 'Противоречивое замечание' } });
    expect(commands.state('ac04', 'main').approvalChains['document-1']?.state).toBe('CONFLICT');
    await command('director', 8, 'document.conflict.resolve', { documentId: 'document-1', decision: { decision: 'APPROVED', comment: 'Разногласие разрешено' } });
    await command('director', 9, 'document.transition', { documentId: 'document-1', action: 'APPROVE' });
    await command('director', 10, 'document.transition', { documentId: 'document-1', action: 'ISSUE', recipient: { instanceId: 'node-1', sideId: 'blue', roles: ['TRAINEE'] } });
    await command('director', 11, 'document.cascade.issue', { documentId: 'document-1' });
    await command('director', 12, 'document.cascade.advance', { documentId: 'document-1', deliveryId: 'leg-1', action: 'BEGIN' });
    await command('director', 13, 'document.cascade.advance', { documentId: 'document-1', deliveryId: 'leg-1', action: 'DELIVER', at: '2030-01-01T01:01:00+03:00' });
    await command('director', 14, 'document.cascade.fact', { documentId: 'document-1', deliveryId: 'leg-1', factType: 'ACKNOWLEDGED', at: '2030-01-01T01:02:00+03:00' });
    await command('director', 15, 'document.cascade.fact', { documentId: 'document-1', deliveryId: 'leg-1', factType: 'EXECUTION_STARTED', at: '2030-01-01T01:03:00+03:00' });
    await command('director', 16, 'document.cascade.advance', { documentId: 'document-1', deliveryId: 'leg-2', action: 'BEGIN' });
    await command('director', 17, 'document.cascade.advance', { documentId: 'document-1', deliveryId: 'leg-2', action: 'DELIVER', at: '2030-01-01T01:02:00+03:00' }, 500);
    await command('director', 17, 'document.cascade.fact', { documentId: 'document-1', deliveryId: 'leg-2', factType: 'EXECUTION_STARTED', at: '2030-01-01T01:03:00+03:00' }, 500);
    await command('director', 17, 'document.revise', { documentId: 'document-1', reason: 'Уточнение подписанного распоряжения', changes: { content: { body: 'Выполнить задачу уточнённо', units: { distance: 'км' } } } });

    const state = commands.state('ac04', 'main');
    const current = state.documents['document-1']!;
    expect(current.revision).toBe(2);
    expect(current.supersedesRevision).toBe(1);
    expect(current.supersedes).toBe(state.documentRevisions['document-1']![1]!.sha256);
    expect(state.documentRevisions['document-1']![1]!.signatures).not.toHaveLength(0);
    expect(state.cascades['document-1']!.deliveries.map(delivery => delivery.state)).toEqual(['EXECUTION_STARTED', 'IN_TRANSIT']);
    const exportedAt = new Date().toISOString();
    const exportResponse = await fetch(`${base}/kshvi/instances/ac04/documents/document-1/export?revision=2&exportedAt=${encodeURIComponent(exportedAt)}`, {
      headers: { Authorization: `Bearer ${logins.get('director')!.token}` },
    });
    const exportText = await exportResponse.text();
    expect(exportResponse.status, exportText).toBe(200);
    const exported = JSON.parse(exportText) as { model: Parameters<typeof verifyExportSet>[0]['model']; json: string; pdf: string; docx: string };
    const verification = await verifyExportSet({ model: exported.model, json: exported.json, pdf: Buffer.from(exported.pdf, 'base64'), docx: Buffer.from(exported.docx, 'base64') });
    expect(verification).toEqual({ valid: true, issues: [] });
    expect(exported.model.source.revision).toBe(2);
    expect(exported.model.legend).toEqual(['Синие: свои']);
    expect(exported.model.attribution).toEqual(['© Учебный источник']);

    const history = await store.listEvents('org-ac04', 'ac04', 'main');
    const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
    if (runId) {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const directory = 'docs/release/kshvi/evidence/ac04';
      await mkdir(directory, { recursive: true });
      const initialScenario = { document: documentDraft(''), operations };
      const initialRevision = { id: 'ac04-documents', revision: 1, sha256: hashCanonical(initialScenario) };
      const environment = { transport: 'HTTP', dualChain: true, cascadeLegs: 2, exportVerified: verification.valid };
      const metrics = { revisions: 2, cascadeLegs: 2, conflictResolved: 1, exportValid: verification.valid ? 1 : 0, events: history.length };
      const initialPath = `${directory}/initial-scenario.json`;
      const journalPath = `${directory}/journal.json`;
      const protocolPath = `${directory}/protocol.txt`;
      const metricsPath = `${directory}/metrics.json`;
      const environmentPath = `${directory}/environment.json`;
      const limitations = ['PDF и DOCX проверены структурно и по содержимому; визуальная сверка печатной формы выполняется отдельно.'];
      await writeFile(initialPath, JSON.stringify({ initialRevision, scenario: initialScenario }, null, 2));
      await writeFile(journalPath, JSON.stringify({ runId, commit, events: history }, null, 2));
      await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
      await writeFile(environmentPath, JSON.stringify(environment, null, 2));
      await writeFile(protocolPath, `AC-04 завершён\nrunId: ${runId}\ncommit: ${commit}\nНеполный документ отклонён; конфликт разрешён; плечи независимы; редакция 2 содержит supersedes; экспорт соответствует источнику.\n`);
      const proof = {
        runId, commit, initialRevision,
        journal: { path: journalPath, sha256: hashCanonical(history), eventCount: history.length },
        hashes: { scenario: initialRevision.sha256, environment: hashCanonical(environment), journal: hashCanonical(history) },
        protocols: [protocolPath], screenshots: [], metrics, limitations,
        artifacts: [initialPath, journalPath, protocolPath, metricsPath, environmentPath],
      };
      await writeFile('docs/release/kshvi/acceptance/AC-04.proof.json', JSON.stringify(proof, null, 2));
    }
  });
}, 25_000);
