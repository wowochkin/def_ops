import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CatalogEffect, CatalogEffectOperation, EventUnit } from './model/event-effect';
import type { EventParameter, EventScale, EventTemplate, ValidationIssue } from './model/event-template';
import { templateContentHash, type CatalogManifest } from './catalog-manifest';
import { validateEventTemplate } from './validate-template';

type RawEffect = {
  type: string;
  target: { domain: string; ref: string };
  mechanism: string;
  reason: string;
  [key: string]: unknown;
};
type RawTemplate = {
  templateId: string;
  version: number;
  name: string;
  description: string;
  category: string;
  educationalQuestion: string;
  trainingAssumption: string;
  source: { note: string };
  review: { method: string };
  applicability: {
    scales: EventScale[];
    stages: string[];
    sides: string[];
    geography: { requiredFeatures: string[] };
  };
  preconditions: { fact: string; operator: string; value: string | number | boolean }[];
  parameters: { id: string; name: string; unit: string; min: number; max: number; default?: number }[];
  weight: number;
  severity: number;
  limits: { cooldown: { value: number; unit: string }; maxOccurrences: number; mutuallyExclusiveGroups: string[] };
  cascade: { allowedFollowUpTemplateIds: string[]; budget: { maxDepth: number; maxEvents: number } };
  effects: RawEffect[];
  observations: { kind: string; sourceRequirement: string; visibility: string }[];
  reports: { kind: string; channelRequirement: string }[];
  compensations: { targetEffectType: string; method: string }[];
};
type RawCatalogFile = { templates: RawTemplate[] };
type RawManifest = { catalogId: string; catalogVersion: string };

const REVIEW_DATE = '2026-11-21';

function quantity(value: number, sourceUnit: string): { value: number; unit: EventUnit } {
  switch (sourceUnit) {
    case 'day': return { value: value * 86_400, unit: 's' };
    case 'h': return { value: value * 3_600, unit: 's' };
    case 'min': return { value: value * 60, unit: 's' };
    case 'km': return { value: value * 1_000, unit: 'm' };
    case 'mm': return { value: value / 1_000, unit: 'm' };
    case 'm': return { value, unit: 'm' };
    case 't': return { value: value * 1_000, unit: 'kg' };
    case 'l': return { value, unit: 'L' };
    case '%': return { value: value / 100, unit: 'ratio' };
    case 'point': return { value, unit: 'ratio' };
    case 'degree': return { value, unit: 'deg' };
    case 'case': case 'event': case 'unit': case 'vehicle': case 'person': return { value, unit: 'count' };
    default: return { value, unit: 'ratio' };
  }
}

function parameter(raw: RawTemplate['parameters'][number]): EventParameter {
  const min = quantity(raw.min, raw.unit);
  const max = quantity(raw.max, raw.unit);
  const defaultValue = raw.default === undefined ? undefined : quantity(raw.default, raw.unit).value;
  return { parameterId: raw.id, title: raw.name, unit: min.unit, range: { min: min.value, max: max.value }, defaultValue };
}

function effect(raw: RawEffect): CatalogEffect {
  const parameters = Object.fromEntries(Object.entries(raw).filter(([key, value]) => (
    !['type', 'target', 'mechanism', 'reason'].includes(key)
    && (value === null || ['string', 'number', 'boolean'].includes(typeof value))
  ))) as CatalogEffect['parameters'];
  return {
    type: 'catalog.effect',
    operation: raw.type as CatalogEffectOperation,
    target: raw.target,
    mechanism: raw.mechanism,
    reason: raw.reason,
    parameters,
  };
}

function normalizeTemplate(raw: RawTemplate): EventTemplate {
  const cooldown = quantity(raw.limits.cooldown.value, raw.limits.cooldown.unit);
  const observations = raw.observations.map((observation, index) => ({
    observationId: `${raw.templateId}-observation-${index + 1}`,
    source: { kind: observation.visibility === 'CONTROL_ONLY' ? 'CONTROL' as const : 'OBSERVER' as const, sourceId: observation.sourceRequirement, sideId: raw.applicability.sides[0] },
    recipientSideIds: raw.applicability.sides,
    channelId: raw.reports[0]?.channelRequirement ?? 'scenario-channel',
    visibility: observation.visibility === 'CONTROL_ONLY' ? 'CONTROL' as const : 'PARTICIPANT' as const,
    delaySeconds: { min: 0, max: 0 },
  }));
  return {
    schemaVersion: 1,
    templateId: raw.templateId,
    version: raw.version,
    title: raw.name,
    description: raw.description,
    category: raw.category.toLowerCase() as EventTemplate['category'],
    learningQuestion: raw.educationalQuestion,
    provenance: {
      type: 'TRAINING_ASSUMPTION',
      statement: raw.trainingAssumption,
      rationale: raw.source.note,
      approvedBy: raw.review.method,
    },
    applicability: {
      scales: raw.applicability.scales,
      stageIds: raw.applicability.stages,
      sideIds: raw.applicability.sides,
      geography: {
        areaIds: raw.applicability.geography.requiredFeatures,
        boundingBox: { minLatitude: -90, maxLatitude: 90, minLongitude: -180, maxLongitude: 180 },
        requiresEnvironmentCoverage: true,
      },
      operationalWindows: [{ startMinute: 0, endMinute: 525_600 }],
    },
    preconditions: raw.preconditions.map(precondition => ({
      type: 'fact.comparison',
      fact: precondition.fact,
      operator: 'EQ',
      value: precondition.value,
      required: true,
      onUnknown: 'NOT_TRUE',
    })),
    parameters: raw.parameters.map(parameter),
    baseWeight: raw.weight,
    severity: {
      level: raw.severity <= 1 ? 'LOW' : raw.severity === 2 ? 'MODERATE' : raw.severity === 3 ? 'HIGH' : 'CRITICAL',
      cost: raw.severity,
    },
    limits: {
      cooldownSeconds: cooldown.value,
      maxOccurrences: raw.limits.maxOccurrences,
      maxPerStage: raw.limits.maxOccurrences,
      mutuallyExclusiveGroupIds: raw.limits.mutuallyExclusiveGroups,
    },
    cascade: {
      allowedTemplateIds: raw.cascade.allowedFollowUpTemplateIds,
      maxDepth: Math.max(1, raw.cascade.budget.maxDepth),
      maxEvents: raw.cascade.budget.maxEvents,
    },
    effects: raw.effects.map(effect),
    observations,
    reports: raw.reports.map(report => ({
      reportId: `${raw.templateId}-${report.kind}`,
      basedOnObservationId: observations[0]?.observationId ?? 'no-observation',
      recipientSideIds: raw.applicability.sides,
      channelId: report.channelRequirement,
      title: report.kind,
    })),
    compensations: raw.compensations.map(compensation => ({
      type: 'manual.review',
      effectIndex: Math.max(0, raw.effects.findIndex(candidate => candidate.type === compensation.targetEffectType)),
      instruction: compensation.method,
      maxDelaySeconds: 0,
    })),
  };
}

export async function loadEventCatalog(directory: string): Promise<{ templates: EventTemplate[]; manifest: CatalogManifest; issues: ValidationIssue[] }> {
  const files = (await readdir(directory)).filter(file => /^[a-z]+\.json$/.test(file) && !['manifest.json', 'sources.json'].includes(file)).sort();
  const rawManifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as RawManifest;
  const issues: ValidationIssue[] = [];
  const templates: EventTemplate[] = [];
  const rawTemplates: RawTemplate[] = [];
  for (const file of files) {
    const data = JSON.parse(await readFile(join(directory, file), 'utf8')) as RawCatalogFile;
    for (const raw of data.templates) {
      const template = normalizeTemplate(raw);
      templates.push(template);
      rawTemplates.push(raw);
      for (const issue of validateEventTemplate(template).issues) issues.push({ ...issue, path: `/${template.templateId}${issue.path}` });
    }
  }
  const manifest: CatalogManifest = {
    schemaVersion: 1,
    catalogId: rawManifest.catalogId,
    version: Number.parseInt(rawManifest.catalogVersion, 10),
    templates: templates.map((template, index) => ({
      templateId: template.templateId,
      version: template.version,
      sha256: templateContentHash(template),
      reviewStatus: 'APPROVED',
      reviewedBy: rawTemplates[index].review.method,
      reviewedAt: REVIEW_DATE,
    })),
  };
  return { templates, manifest, issues };
}
