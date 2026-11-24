import type { EventTemplate } from '../../src/model/event-template';
import type { TemplateValidationContext } from '../../src/validate-template';

export const validTemplate: EventTemplate = {
  schemaVersion: 1,
  templateId: 'logistics.fuel-shortage',
  version: 1,
  title: 'Снижение запаса топлива',
  description: 'Учебное событие моделирует расход топлива и последующее восстановление запаса.',
  category: 'logistics',
  learningQuestion: 'Проверить действия инстанции при ограничении материально-технического обеспечения.',
  provenance: {
    type: 'TRAINING_ASSUMPTION',
    statement: 'Допускается сценарное изменение запаса в заданных пределах.',
    rationale: 'Событие предназначено для проверки процедур доклада и восстановления обеспечения.',
    approvedBy: 'Методист учения',
  },
  applicability: {
    scales: ['tactical', 'operational'],
    stageIds: ['stage-main'],
    sideIds: ['blue'],
    geography: {
      areaIds: ['area-north'],
      boundingBox: {
        minLatitude: 50,
        maxLatitude: 51,
        minLongitude: 30,
        maxLongitude: 31,
      },
      requiresEnvironmentCoverage: true,
    },
    operationalWindows: [{ startMinute: 0, endMinute: 240 }],
  },
  preconditions: [
    {
      type: 'fact.comparison',
      fact: 'resources.blue.fuel.status',
      operator: 'EQ',
      value: 'AVAILABLE',
      required: true,
      onUnknown: 'NOT_TRUE',
    },
  ],
  parameters: [
    {
      parameterId: 'amount',
      title: 'Объём изменения запаса',
      unit: 'L',
      range: { min: 1, max: 100 },
      defaultValue: 10,
    },
  ],
  baseWeight: 0.5,
  severity: { level: 'MODERATE', cost: 2 },
  limits: {
    cooldownSeconds: 3600,
    maxOccurrences: 3,
    maxPerStage: 2,
    mutuallyExclusiveGroupIds: ['fuel-disruption'],
  },
  cascade: { allowedTemplateIds: [], maxDepth: 2, maxEvents: 4 },
  effects: [
    {
      type: 'resource.adjust',
      resourceId: 'fuel',
      ownerSideId: 'blue',
      unit: 'L',
      operation: 'CONSUME',
      amount: { parameterId: 'amount' },
    },
  ],
  observations: [
    {
      observationId: 'observation-fuel',
      source: { kind: 'UNIT', sourceId: 'logistics-unit-blue', sideId: 'blue' },
      recipientSideIds: ['blue'],
      channelId: 'logistics-channel',
      visibility: 'PARTICIPANT',
      delaySeconds: { min: 0, max: 60 },
    },
  ],
  reports: [
    {
      reportId: 'report-fuel',
      basedOnObservationId: 'observation-fuel',
      recipientSideIds: ['blue'],
      channelId: 'logistics-channel',
      title: 'Донесение об изменении запаса топлива',
    },
  ],
  compensations: [
    {
      type: 'resource.restore',
      effectIndex: 0,
      resourceId: 'fuel',
      ownerSideId: 'blue',
      unit: 'L',
      amount: { parameterId: 'amount' },
      maxDelaySeconds: 1800,
    },
  ],
};

export const validationContext: TemplateValidationContext = {
  stageIds: ['stage-main', 'stage-other'],
  sideIds: ['blue', 'red'],
  areaIds: ['area-north', 'area-south'],
  resources: [{ resourceId: 'fuel', ownerSideId: 'blue', unit: 'L' }],
  templateIds: ['logistics.fuel-shortage', 'logistics.fuel-restored'],
};
