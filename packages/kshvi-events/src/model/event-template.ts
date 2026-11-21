import type { EventAmount, EventEffect, EventUnit } from './event-effect';

export const EVENT_CATEGORIES = [
  'control',
  'reconnaissance',
  'maneuver',
  'combat',
  'engineering',
  'environment',
  'logistics',
  'maintenance',
  'personnel',
  'medical',
  'settlements',
  'interaction',
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type EventScale = 'tactical' | 'operational' | 'strategic' | 'custom';

export type EventProvenance =
  | {
      type: 'SOURCE';
      citation: string;
      locator: string;
      version: string;
      approvedBy: string;
    }
  | {
      type: 'TRAINING_ASSUMPTION';
      statement: string;
      rationale: string;
      approvedBy: string;
    };

export type EventPrecondition = {
  type: 'fact.comparison';
  fact: string;
  operator: 'EQ' | 'NE' | 'LT' | 'LE' | 'GT' | 'GE';
  value: string | number | boolean;
  required: boolean;
  onUnknown: 'NOT_TRUE';
};

export type EventParameter = {
  parameterId: string;
  title: string;
  unit: EventUnit;
  range: { min: number; max: number };
  defaultValue?: number;
};

export type EventObservation = {
  observationId: string;
  source: {
    kind: 'UNIT' | 'SENSOR' | 'OBSERVER' | 'CONTROL';
    sourceId: string;
    sideId: string;
  };
  recipientSideIds: string[];
  channelId: string;
  visibility: 'PARTICIPANT' | 'CONTROL';
  delaySeconds: { min: number; max: number };
};

export type EventReport = {
  reportId: string;
  basedOnObservationId: string;
  recipientSideIds: string[];
  channelId: string;
  title: string;
};

export type EventCompensation =
  | {
      type: 'resource.restore';
      effectIndex: number;
      resourceId: string;
      ownerSideId: string;
      unit: EventUnit;
      amount: EventAmount;
      maxDelaySeconds: number;
    }
  | {
      type: 'manual.review';
      effectIndex: number;
      instruction: string;
      maxDelaySeconds: number;
    };

export type EventTemplate = {
  schemaVersion: 1;
  templateId: string;
  version: number;
  title: string;
  description: string;
  category: EventCategory;
  learningQuestion: string;
  provenance: EventProvenance;
  applicability: {
    scales: EventScale[];
    stageIds: string[];
    sideIds: string[];
    geography: {
      areaIds: string[];
      boundingBox: {
        minLatitude: number;
        maxLatitude: number;
        minLongitude: number;
        maxLongitude: number;
      };
      requiresEnvironmentCoverage: true;
    };
    operationalWindows: { startMinute: number; endMinute: number }[];
  };
  preconditions: EventPrecondition[];
  parameters: EventParameter[];
  baseWeight: number;
  severity: {
    level: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
    cost: number;
  };
  limits: {
    cooldownSeconds: number;
    maxOccurrences: number;
    maxPerStage: number;
    mutuallyExclusiveGroupIds: string[];
  };
  cascade: {
    allowedTemplateIds: string[];
    maxDepth: number;
    maxEvents: number;
  };
  effects: EventEffect[];
  observations: EventObservation[];
  reports: EventReport[];
  compensations: EventCompensation[];
};

export type ValidationSeverity = 'ERROR' | 'WARNING' | 'INFO';

export type ValidationIssue = {
  code: string;
  path: string;
  message: string;
  severity: ValidationSeverity;
};

export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};
