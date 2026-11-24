import { describe, expect, it } from 'vitest';
import {
  REQUIRED_CATEGORIES,
  analyzeCatalog,
  buildManifest,
  mechanismFingerprint,
  rehearseTemplate,
} from '../../../scripts/kshvi-catalog-content-check.mjs';

const sources = {
  schemaVersion: '1.0.0',
  sources: [
    {
      sourceId: 'spec-com',
      revision: 1,
      kind: 'PROJECT_SPEC',
      title: 'Современный КШВИ: связь и автономное наращивание',
      path: 'docs/superpowers/specs/2026-11-20-kshvi-modern-design.md',
      requirements: ['KSHVI-F-COM-06', 'KSHVI-F-AUTO-02'],
      numericUse: 'Числа задаются только как учебные допущения.',
    },
  ],
};

type AnyRecord = Record<string, any>;

function makeTemplate(): AnyRecord {
  return {
    schemaVersion: '1.0.0',
    templateId: 'control-01-channel-queue',
    version: 1,
    reviewStatus: 'APPROVED',
    name: 'Перегрузка основного канала связи',
    description: 'Очередь сообщений основного канала превышает его учебную ёмкость.',
    category: 'CONTROL',
    educationalQuestion: 'Как сохранить доведение срочных донесений при перегрузке основного канала?',
    source: { sourceId: 'spec-com', revision: 1, note: 'Сценарный отказ и правило восстановления.' },
    trainingAssumption: 'Длительность перегрузки является учебным параметром, а не нормативом реальной сети.',
    applicability: {
      scales: ['tactical', 'operational', 'strategic'],
      stages: ['READINESS', 'MANEUVER', 'CONTACT', 'SUSTAINMENT', 'RECOVERY'],
      sides: ['FRIENDLY', 'OPPOSING', 'NEUTRAL'],
      allowedStates: ['ACTIVE'],
      disallowedStates: ['UNKNOWN', 'CANCELLED', 'COMPLETED'],
      geography: { geometry: 'AREA', requiredFeatures: ['COMMUNICATION_NODE'], excludedFeatures: [] },
      time: {
        operationalOnly: true,
        withinStage: true,
        allowBackward: false,
        minLead: { value: 0, unit: 'min' },
      },
    },
    preconditions: [
      {
        fact: 'communication.channel.state',
        operator: 'EQUALS',
        value: 'DEGRADED',
        onUnknown: 'REJECT',
        description: 'Канал уже имеет наблюдаемую деградацию.',
      },
    ],
    parameters: [
      { id: 'duration', name: 'Длительность перегрузки', unit: 'min', min: 5, max: 120, default: 30 },
    ],
    weight: 10,
    severity: 2,
    limits: {
      maxSeverity: 3,
      cooldown: { value: 120, unit: 'min' },
      maxOccurrences: 2,
      mutuallyExclusiveGroups: ['control-channel-loss'],
    },
    cascade: {
      allowedFollowUpTemplateIds: [],
      budget: { maxDepth: 1, maxEvents: 2 },
      onExhausted: 'REJECT_AND_REPORT',
    },
    effects: [
      {
        type: 'applyCommunicationFailure',
        target: { domain: 'communications', ref: 'channel' },
        failureKind: 'QUEUE_OVERFLOW',
        durationParameter: 'duration',
        reason: 'Перегрузка основного канала связи',
      },
    ],
    observations: [
      {
        kind: 'CHANNEL_DEGRADED',
        sourceRequirement: 'COMMUNICATION_MONITOR',
        visibility: 'AUTHORIZED_SIDE',
        geometryRef: 'target',
      },
    ],
    reports: [
      {
        kind: 'COMMUNICATION_STATUS',
        channelRequirement: 'ANY_AVAILABLE',
        deadlineParameter: 'duration',
        requiredFields: ['channelState', 'queuedMessages'],
      },
    ],
    compensations: [
      {
        trigger: 'RESTORATION_CONFIRMED',
        type: 'createCompensationRequest',
        targetEffectType: 'applyCommunicationFailure',
        method: 'RESTORE_PRIMARY_CHANNEL',
        approval: 'REQUIRED',
      },
    ],
    expectedEvidence: ['WORLD_EVENT', 'OBSERVATION', 'REPORT', 'COMPENSATION_REQUEST'],
    rehearsal: {
      suitableFacts: { 'communication.channel.state': 'DEGRADED' },
      unsuitableFacts: { 'communication.channel.state': 'AVAILABLE' },
      expectedRejectCode: 'PRECONDITION_FAILED',
    },
    review: {
      method: 'AUTHOR_METHODICAL_REVIEW_WITH_INDEPENDENT_AUTOMATED_CHECK',
      sourceChecked: true,
      effectsChecked: true,
      rehearsalRequired: true,
    },
    _file: 'control.json',
  };
}

function analyze(templates: AnyRecord[], extra: AnyRecord = {}): AnyRecord {
  return analyzeCatalog({
    templates,
    sources,
    requireMinimum: 1,
    requirePerCategory: 0,
    ...extra,
  });
}

function issueCodes(report: AnyRecord) {
  return report.issues.map((issue: AnyRecord) => issue.code);
}

describe('содержательный отпечаток и репетиция', () => {
  it('отклоняет числовой клон и простое переименование', () => {
    const original = makeTemplate();
    const clone = structuredClone(original);
    clone.templateId = 'control-99-renamed-clone';
    clone.name = 'Совсем другое название';
    clone.description = 'Переименованная запись без нового механизма.';
    clone.parameters[0].min = 1;
    clone.parameters[0].max = 999;
    clone.parameters[0].default = 77;
    clone.weight = 99;
    clone.limits.cooldown.value = 999;
    clone.effects[0].target.ref = 'another-channel';

    expect(mechanismFingerprint(clone)).toBe(mechanismFingerprint(original));
    const report = analyze([original, clone], { requireMinimum: 2 });
    expect(report.approvedDistinct).toBe(1);
    expect(report.duplicateMechanisms).toHaveLength(1);
    expect(issueCodes(report)).toContain('DUPLICATE_MECHANISM');
  });

  it('применяет шаблон только в подходящем состоянии и отклоняет UNKNOWN', () => {
    const template = makeTemplate();
    expect(rehearseTemplate(template, template.rehearsal.suitableFacts)).toMatchObject({
      outcome: 'APPLIED',
      applicable: true,
      failedPreconditions: [],
    });
    expect(rehearseTemplate(template, template.rehearsal.unsuitableFacts)).toMatchObject({
      outcome: 'REJECTED',
      applicable: false,
      reasonCode: 'PRECONDITION_FAILED',
    });
    expect(rehearseTemplate(template, { 'communication.channel.state': 'UNKNOWN' })).toMatchObject({
      outcome: 'REJECTED',
      reasonCode: 'PRECONDITION_UNKNOWN',
    });
    expect(rehearseTemplate(template, {})).toMatchObject({ outcome: 'REJECTED' });
  });

  it('возвращает стабильный отпечаток независимо от порядка ключей', () => {
    const template = makeTemplate();
    const reversed = JSON.parse(JSON.stringify(template, (_key, value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.fromEntries(Object.entries(value).reverse());
      }
      return value;
    }));
    expect(mechanismFingerprint(reversed)).toBe(mechanismFingerprint(template));
  });
});

describe('отказ заведомо дефектных записей AC-20', () => {
  it('отклоняет неизвестную операцию и запрещённое изменение оценки', () => {
    const unknown = makeTemplate();
    unknown.effects[0].type = 'executeJavaScript';
    const assessment = makeTemplate();
    assessment.templateId = 'control-02-assessment';
    assessment.effects[0].target.domain = 'assessment';
    const report = analyze([unknown, assessment], { requireMinimum: 2 });
    expect(issueCodes(report)).toContain('UNKNOWN_EFFECT');
    expect(issueCodes(report)).toContain('PROTECTED_TARGET');
  });

  it('отклоняет цикл разрешённых последующих событий', () => {
    const first = makeTemplate();
    const second = makeTemplate();
    second.templateId = 'control-02-next';
    second.educationalQuestion = 'Как подтвердить восстановление после обходного маршрута?';
    first.cascade.allowedFollowUpTemplateIds = [second.templateId];
    second.cascade.allowedFollowUpTemplateIds = [first.templateId];
    const report = analyze([first, second], { requireMinimum: 2 });
    expect(issueCodes(report)).toContain('CASCADE_CYCLE');
  });

  it('отклоняет отрицательный ресурс и обратный диапазон параметра', () => {
    const negative = makeTemplate();
    negative.effects[0] = {
      type: 'consumeResource',
      target: { domain: 'resources', ref: 'fuel' },
      resourceKind: 'FUEL',
      quantityParameter: 'duration',
      allowNegative: true,
    };
    const reversed = makeTemplate();
    reversed.templateId = 'control-02-range';
    reversed.parameters[0].min = 50;
    reversed.parameters[0].max = 10;
    const report = analyze([negative, reversed], { requireMinimum: 2 });
    expect(issueCodes(report)).toContain('NEGATIVE_RESOURCE');
    expect(issueCodes(report)).toContain('PARAMETER_RANGE');
  });

  it('отклоняет отрицательный диапазон расходуемого ресурса', () => {
    const template = makeTemplate();
    template.effects[0] = {
      type: 'consumeResource',
      target: { domain: 'resources', ref: 'fuel' },
      resourceKind: 'FUEL',
      quantityParameter: 'duration',
      allowNegative: false,
    };
    template.compensations[0].targetEffectType = 'consumeResource';
    template.parameters[0].min = -5;
    const report = analyze([template]);
    expect(issueCodes(report)).toContain('NEGATIVE_RESOURCE');
  });

  it('отклоняет отсутствие источника и учебного допущения', () => {
    const template = makeTemplate();
    delete template.source;
    delete template.trainingAssumption;
    const report = analyze([template]);
    expect(issueCodes(report)).toContain('MISSING_PROVENANCE');
    expect(report.approvedDistinct).toBe(0);
  });

  it('отклоняет отсутствие компенсации и неподходящую контрольную репетицию', () => {
    const noCompensation = makeTemplate();
    noCompensation.compensations = [];
    const badRehearsal = makeTemplate();
    badRehearsal.templateId = 'control-02-bad-rehearsal';
    badRehearsal.rehearsal.unsuitableFacts = structuredClone(badRehearsal.rehearsal.suitableFacts);
    const report = analyze([noCompensation, badRehearsal], { requireMinimum: 2 });
    expect(issueCodes(report)).toContain('MISSING_COMPENSATION');
    expect(issueCodes(report)).toContain('UNSUITABLE_STATE_ACCEPTED');
  });

  it('отклоняет предусловие, принимающее UNKNOWN за истину', () => {
    const template = makeTemplate();
    template.preconditions[0].onUnknown = 'ALLOW';
    const report = analyze([template]);
    expect(issueCodes(report)).toContain('UNKNOWN_ACCEPTING_PRECONDITION');
  });

  it('отклоняет неизвестные единицу, этап и сторону', () => {
    const template = makeTemplate();
    template.parameters[0].unit = 'условных попугаев';
    template.applicability.stages = ['HISTORICAL_STAGE'];
    template.applicability.sides = ['REAL_PERSON'];
    const report = analyze([template]);
    expect(issueCodes(report)).toContain('UNKNOWN_UNIT');
    expect(issueCodes(report)).toContain('UNKNOWN_STAGE');
    expect(issueCodes(report)).toContain('UNKNOWN_SIDE');
  });

  it('не утверждает запись без русского содержания и доказательств', () => {
    const template = makeTemplate();
    template.name = 'Queue failure';
    template.description = '';
    template.educationalQuestion = 'Question?';
    template.expectedEvidence = [];
    const report = analyze([template]);
    expect(issueCodes(report)).toContain('RUSSIAN_CONTENT_REQUIRED');
    expect(issueCodes(report)).toContain('MISSING_EVIDENCE');
  });
});

describe('манифест и машинный отчёт', () => {
  it('связывает шаблон с SHA-256 и обнаруживает изменение содержимого', () => {
    const template = makeTemplate();
    const manifest = buildManifest({ templates: [template], rawFiles: { 'control.json': '{}' } });
    expect(manifest.templates[0]).toMatchObject({
      templateId: template.templateId,
      category: 'CONTROL',
      reviewStatus: 'APPROVED',
    });
    expect(manifest.templates[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(analyze([template], { manifest, requireManifest: true }).valid).toBe(true);

    template.weight += 1;
    const changed = analyze([template], { manifest, requireManifest: true });
    expect(issueCodes(changed)).toContain('MANIFEST_HASH_MISMATCH');
    expect(changed.valid).toBe(false);
  });

  it('содержит пути, отпечатки и результаты обеих репетиций', () => {
    const template = makeTemplate();
    const report = analyze([template]);
    expect(report.valid).toBe(true);
    expect(report.requiredCategories).toEqual(REQUIRED_CATEGORIES.map((category: string) => expect.objectContaining({ category })));
    expect(report.mechanismFingerprints[0]).toMatchObject({ templateId: template.templateId, file: 'control.json' });
    expect(report.mechanismFingerprints[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.rehearsals[0]).toMatchObject({
      templateId: template.templateId,
      file: 'control.json',
      suitable: { outcome: 'APPLIED' },
      unsuitable: { outcome: 'REJECTED' },
    });
  });
});
