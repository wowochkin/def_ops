import { expect, it } from 'vitest';
import * as scenarioKitApi from '../src/scenario/scenario-kit';
import * as commandTreeApi from '../src/forces/command-tree';
import { advanceCascadeDelivery } from '../src/documents/cascade';
import { capabilityFactors } from '../src/forces/capability';
import { REQUIRED_SCENARIO_ITEMS, validateKit } from '../src/scenario/scenario-kit';
import { validateCommandTree, type CommandTree } from '../src/forces/command-tree';

const fullTree = (): CommandTree => ({
  nodes: [
    { id: 'a', parentId: null, trained: true },
    { id: 'b', parentId: 'a', trained: true },
    { id: 'c', parentId: 'b', trained: true },
  ],
  edges: [
    {
      from: 'a', to: 'b', active: true, kind: 'OPERATIONAL_COMMAND', validFrom: '2025-01-01T00:00:00Z', validTo: '2027-01-01T00:00:00Z',
      authorities: ['ISSUE_ORDER'], allowedDocumentTypes: ['ORDER'], channelId: 'radio', delayMinutes: 0, processingDeadlineAt: '2026-01-01T03:00:00Z',
      playRole: { kind: 'SCRIPT', assignmentId: 'script-1' },
    },
    {
      from: 'b', to: 'c', active: true, kind: 'COORDINATION', validFrom: '2025-01-01T00:00:00Z', validTo: '2027-01-01T00:00:00Z',
      authorities: ['RELAY_ORDER'], allowedDocumentTypes: ['ORDER'], channelId: 'radio', delayMinutes: 0, processingDeadlineAt: '2026-01-01T03:00:00Z',
      playRole: { kind: 'HYBRID', assignmentId: 'hybrid-1' },
    },
  ],
});

it('строит 19 связанных документов и выявляет повреждение содержимого', () => {
  const api = scenarioKitApi as unknown as Record<string, (...args: any[]) => any>;
  expect(api.buildLinkedScenarioKit).toBeTypeOf('function');
  const kit = api.buildLinkedScenarioKit({
    documents: REQUIRED_SCENARIO_ITEMS.map((item, index) => ({
      id: `doc-${index + 1}`, item, revision: 1, content: { text: `Содержимое ${item}` }, dependsOn: index ? [`doc-${index}`] : [],
    })),
    usesLogistics: true,
  });
  expect(kit.items).toHaveLength(19);
  expect(kit.documents).toHaveLength(19);
  expect(kit.items.every((item: any) => item.documentId && item.sha256)).toBe(true);
  expect(validateKit(kit)).toEqual([]);
  const tampered = structuredClone(kit);
  tampered.documents[0].content.text = 'Подменено';
  expect(validateKit(tampered).map((issue: any) => issue.code)).toContain('DOCUMENT_HASH_INVALID');
});

it('не считает named row связанным документом', () => {
  const issues = validateKit({
    items: [{ item: 'CONCEPT', present: true }], usesLogistics: false, omissions: [],
  });
  expect(issues.map(issue => issue.code)).toContain('DOCUMENT_LINK_REQUIRED');
});

it('требует тип, период, полномочия, документы и канал активного стыка', () => {
  const tree = fullTree();
  const incomplete = { ...tree, edges: [{ ...tree.edges[0], authorities: [], allowedDocumentTypes: [], kind: undefined, validFrom: undefined, channelId: undefined }] };
  expect(validateCommandTree(incomplete).map(issue => issue.code)).toEqual(expect.arrayContaining([
    'LINK_TYPE_REQUIRED', 'LINK_PERIOD_REQUIRED', 'LINK_AUTHORITIES_REQUIRED', 'LINK_DOCUMENTS_REQUIRED', 'LINK_CHANNEL_REQUIRED',
  ]));
  expect(validateCommandTree(fullTree())).toEqual([]);
  for (const kind of ['SCRIPT', 'PLAYBOOK', 'HYBRID'] as const) {
    const tree = fullTree();
    tree.edges[0].playRole!.kind = kind;
    expect(validateCommandTree(tree)).toEqual([]);
  }
});

it('строит каскад по дереву с независимыми статусами плеч', () => {
  const api = commandTreeApi as unknown as Record<string, (...args: any[]) => any>;
  expect(api.cascadeCommandDocument).toBeTypeOf('function');
  const cascade = api.cascadeCommandDocument(fullTree(), {
    originInstanceId: 'a', issuedAt: '2026-01-01T00:00:00Z', availableChannelIds: ['radio'],
    revision: { documentId: 'doc-order', revision: 1, state: 'ISSUED', sha256: 'a'.repeat(64), requisites: { type: 'ORDER' } },
  });
  expect(cascade.deliveries).toHaveLength(2);
  const begun = advanceCascadeDelivery(cascade.deliveries[0], 'BEGIN', { at: '2026-01-01T00:00:00Z' });
  const delivered = advanceCascadeDelivery(begun, 'DELIVER', { at: '2026-01-01T00:01:00Z', actorId: 'b' });
  expect(delivered.state).toBe('DELIVERED');
  expect(cascade.deliveries[1].state).toBe('QUEUED');
});

it('required = 0 не даёт Infinity и ложный CALCULATED', () => {
  const result = capabilityFactors({
    initialAssessment: { value: 0.8, source: 'scenario-1' },
    equipment: { actual: 7, authorized: 10 }, personnel: { actual: 8, authorized: 10 },
    supplies: { available: 60, required: 0 }, fatigue: 0.2, morale: 0.7, readiness: 0.6, supply: 0.5,
    manualCorrection: null,
  });
  expect(result.status).toBe('REQUIRES_REVIEW');
  expect(result.unknown).toContain('supplies');
  expect(result.factors.supplies).toBeNull();
  expect(JSON.stringify(result)).not.toContain('Infinity');
});
