import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { DocumentRequisites, DocumentRevision, DocumentType } from '../src/documents/document';
import { fillTemplate } from '../src/documents/template-fill';
import { documentTemplateLibrary, templateForType } from '../src/documents/template';
import { exportDocument } from '../src/documents/export-json';
import { exportDocumentSet, verifyExportSet } from '../src/documents/export-set';

const HASH = 'a'.repeat(64);

function requisites(overrides: Partial<DocumentRequisites> = {}): DocumentRequisites {
  return {
    exerciseId: 'exercise-1', scenarioRevisionId: 'scenario-3', instanceId: 'hq', authorId: 'author-1',
    category: 'OPERATIONAL', type: 'ORDER', title: 'Приказ на действия', number: '15',
    operationalAt: '2030-01-01T06:00:00+03:00', place: 'Пункт управления',
    validFrom: '2030-01-01T06:00:00+03:00', validUntil: '2030-01-02T06:00:00+03:00',
    stageId: 'stage-1', sideId: 'blue', visibility: { sideIds: ['blue'], instanceIds: [], roles: [] },
    addressees: [{ instanceId: 'unit-1', channelId: 'radio-1' }], copies: [], sourceRole: 'COMMANDER',
    deliveryChannelId: 'radio-1', basis: 'Замысел учения', executorId: 'unit-1',
    deadlineAt: '2030-01-01T08:00:00+03:00', linkedEventIds: [], linkedDecisionIds: [], linkedTaskIds: ['task-1'],
    templateVersion: 'order:v1', ...overrides,
  };
}

function revision(overrides: Partial<DocumentRevision> = {}): DocumentRevision {
  return {
    id: 'order-1:r2', documentId: 'order-1', revision: 2, state: 'APPROVED', requisites: requisites(),
    content: { body: 'Перейти рубеж «Северный», сохраняя темп наступления.', units: { distance: 'm', duration: 'min' } },
    map: {
      environmentSnapshotId: 'environment-1', legend: ['cp:v1', 'unit-blue:v2'], attribution: ['© OpenStreetMap contributors', 'Учебный снимок карты'],
      visibility: { sideIds: ['blue'], instanceIds: [], roles: [] },
    },
    attachments: [], approvalRouteId: 'route-1', sha256: HASH, supersedes: null, supersedesRevision: null,
    supersedeReason: null, signatures: [{ userId: 'commander-1', role: 'COMMANDER', signedAt: '2030-01-01T05:30:00+03:00', revision: 2, sha256: HASH }],
    delivery: { state: 'NOT_ISSUED', facts: [] }, ...overrides,
  };
}

const context = { exerciseTitle: 'Учение «Взаимодействие»', exerciseRevision: 7, exportedAt: '2030-01-01T07:00:00Z' };

describe('шаблоны и разрешённое автозаполнение', () => {
  it('содержит все приказные, донесённые и итоговые типы DOC-06', () => {
    const expected: DocumentType[] = [
      'ORDER', 'COMBAT_ORDER', 'DIRECTIVE', 'PLAN', 'REPORT', 'BRIEFING', 'REQUEST',
      'INTELLIGENCE_SUMMARY', 'OPERATIONAL_ASSIGNMENT', 'INJECT', 'DUTY_JOURNAL', 'ASSESSMENT_SHEET', 'DEBRIEF_MATERIAL',
    ];
    expect(documentTemplateLibrary.map(template => template.type)).toEqual(expected);
    for (const template of documentTemplateLibrary) {
      expect(template.version).toMatch(/:v1$/);
      expect(template.validationRules.length).toBeGreaterThan(0);
      expect(template.textLayout).toContain('{{body}}');
      expect(template.mapLayout.legend).toBe(true);
    }
  });

  it('оставляет автозаполнение проектом и использует только разрешённую проекцию', async () => {
    const template = templateForType('ORDER');
    const result = await fillTemplate({
      template,
      base: revision({ state: 'IN_REVIEW', content: { body: 'Исходный текст', units: { distance: 'm' } } }),
      permittedProjection: {
        fields: { body: 'Разрешённая задача {{unknown}}', secret: 'Скрытое значение' },
        requisites: { number: '16', deadlineAt: '2030-01-01T09:00:00+03:00' },
      },
    });
    expect(result.revision.state).toBe('DRAFT');
    expect(result.revision.signatures).toEqual([]);
    expect(result.revision.requisites.number).toBe('16');
    expect(result.revision.requisites.deadlineAt).toBe('2030-01-01T09:00:00+03:00');
    expect(result.revision.content.body).toContain('Разрешённая задача');
    expect(result.revision.content.body).not.toContain('Скрытое значение');
    expect(result.autoFilledFields).toEqual(expect.arrayContaining(['content.body', 'requisites.number', 'requisites.deadlineAt']));
    expect(result.status).toBe('DRAFT');
    expect(result.revision.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('не подставляет UNKNOWN как утверждённое значение при пробеле проекции', async () => {
    await expect(fillTemplate({
      template: { ...templateForType('ORDER'), textLayout: 'Срок: {{deadline}}. {{body}}' },
      base: revision(),
      permittedProjection: { fields: { body: 'Задача' } },
    })).rejects.toThrow('UNKNOWN: deadline');
  });
});

describe('единый автономный экспорт DOC-08', () => {
  it('JSON содержит одну редакцию, реквизиты, легенду и атрибуцию', () => {
    const result = exportDocument(revision(), context);
    expect(result.schemaVersion).toBe(1);
    expect(result.source).toEqual({ documentId: 'order-1', revision: 2, sha256: HASH, templateVersion: 'order:v1' });
    expect(result.exercise).toEqual({ title: 'Учение «Взаимодействие»', revision: 7 });
    expect(result.document).toMatchObject({ number: '15', operationalAt: '2030-01-01T06:00:00+03:00', units: { distance: 'm', duration: 'min' } });
    expect(result.legend).toEqual(['cp:v1', 'unit-blue:v2']);
    expect(result.attribution).toEqual(['© OpenStreetMap contributors', 'Учебный снимок карты']);
    expect(result.exportedAt).toBe(context.exportedAt);
    expect(result.pageNumbering).toBe('decimal');
  });

  it('формирует открываемые PDF и DOCX без сети из того же источника, что JSON', async () => {
    const result = await exportDocumentSet(revision(), context);
    expect(new TextDecoder().decode(result.pdf.slice(0, 8))).toBe('%PDF-1.3');
    expect(result.pdf.byteLength).toBeGreaterThan(1000);
    expect([...result.docx.slice(0, 2)]).toEqual([0x50, 0x4b]);
    const zip = await JSZip.loadAsync(result.docx);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    expect(documentXml).toContain('Приказ на действия');
    expect(documentXml).toContain('Перейти рубеж');
    expect(documentXml).toContain('© OpenStreetMap contributors');
    expect(documentXml).toContain(HASH);
    expect(zip.file('word/footer1.xml')).toBeTruthy();
    expect(JSON.parse(result.json)).toEqual(result.model);
    await expect(verifyExportSet(result)).resolves.toEqual({ valid: true, issues: [] });
  });

  it('сохраняет содержательный состав при другом exportedAt и замечает подмену редакции', async () => {
    const first = await exportDocumentSet(revision(), context);
    const second = await exportDocumentSet(revision(), { ...context, exportedAt: '2030-01-01T07:05:00Z' });
    expect(second.model.contentBlocks).toEqual(first.model.contentBlocks);
    expect(second.model.source).toEqual(first.model.source);
    expect(second.model.exportedAt).not.toBe(first.model.exportedAt);
    const parsed = JSON.parse(first.json) as typeof first.model;
    const tampered = { ...parsed, source: { ...parsed.source, revision: 99 } };
    const verification = await verifyExportSet({ ...first, json: JSON.stringify(tampered) });
    expect(verification.valid).toBe(false);
    expect(verification.issues).toContain('SOURCE_REVISION_MISMATCH');
  });
});
