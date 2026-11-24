#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CATEGORY_FILES = Object.freeze({
  CONTROL: 'control.json',
  RECONNAISSANCE: 'reconnaissance.json',
  MANEUVER: 'maneuver.json',
  COMBAT: 'combat.json',
  ENGINEERING: 'engineering.json',
  ENVIRONMENT: 'environment.json',
  LOGISTICS: 'logistics.json',
  MAINTENANCE: 'maintenance.json',
  PERSONNEL: 'personnel.json',
  MEDICAL: 'medical.json',
  SETTLEMENTS: 'settlements.json',
  INTERACTION: 'interaction.json',
});

export const REQUIRED_CATEGORIES = Object.freeze(Object.keys(CATEGORY_FILES));

const SCHEMA_VERSION = '1.0.0';
const EFFECT_CONTRACT_VERSION = 'kshvi-domain-effects-v1';
const SCALES = new Set(['tactical', 'operational', 'strategic']);
const STAGES = new Set(['READINESS', 'MANEUVER', 'CONTACT', 'SUSTAINMENT', 'RECOVERY']);
const SIDES = new Set(['FRIENDLY', 'OPPOSING', 'NEUTRAL']);
const UNITS = new Set([
  'min', 'h', 'day', 'km', 'm', 'mm', 'm/s', '%', 'ratio', 'message', 'person',
  'vehicle', 't', 'l', 'event', 'point', 'degree', 'unit', 'crossing', 'case',
]);
const OPERATORS = new Set(['EQUALS', 'NOT_EQUALS', 'IN', 'GREATER_OR_EQUAL', 'LESS_OR_EQUAL', 'GREATER', 'LESS']);
const PROTECTED_DOMAINS = new Set(['assessment', 'assessments', 'objective', 'objectives', 'evaluation', 'learningObjectives']);

const EFFECT_DOMAINS = Object.freeze({
  applyCommunicationFailure: 'communications',
  restoreCommunicationChannel: 'communications',
  rerouteMessage: 'communications',
  createDocumentRevision: 'documents',
  markReportOverdue: 'reports',
  recordCommandNodeState: 'command',
  createObservation: 'observations',
  reviseObservation: 'observations',
  markObservationStale: 'observations',
  delayMovement: 'movement',
  rerouteMovement: 'movement',
  holdFormation: 'formation',
  changeFormationState: 'formation',
  consumeResource: 'resources',
  recordResourceDeficit: 'resources',
  transferResource: 'resources',
  advanceSupply: 'supply',
  delaySupply: 'supply',
  redirectSupply: 'supply',
  updateSupplyNode: 'supply',
  transitionEquipment: 'equipment',
  requestRepair: 'maintenance',
  scheduleEvacuation: 'maintenance',
  updateRepairCapacity: 'maintenance',
  applyMoraleImpact: 'morale',
  scheduleRest: 'personnel',
  recordPersonnelChange: 'personnel',
  recordReadinessActivity: 'readiness',
  updateTerrainState: 'terrain',
  updateWeather: 'weather',
  updateCrossingState: 'crossings',
  closeRoute: 'routes',
  restoreRoute: 'routes',
  updateInfrastructureState: 'infrastructure',
  createCivilContextEvent: 'civilContext',
  recordInteractionConstraint: 'interaction',
  createApprovalRequest: 'approvals',
  createScenarioZone: 'zones',
  createMedicalProcess: 'medical',
  advanceMedicalEvacuation: 'medical',
  updateMedicalCapacity: 'medical',
  recordInformationState: 'information',
  reconcileInformation: 'information',
  createTask: 'tasks',
  updateTask: 'tasks',
  recordCoordination: 'interaction',
  reserveCapacity: 'capacity',
  releaseCapacity: 'capacity',
  recordSafetyConstraint: 'safety',
  recordScenarioCondition: 'scenario',
});

export const ALLOWED_EFFECT_TYPES = Object.freeze(Object.keys(EFFECT_DOMAINS));

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasRussian(value) {
  return typeof value === 'string' && /[А-Яа-яЁё]/.test(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => !key.startsWith('_'))
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

function templateFile(template) {
  return template?._file || CATEGORY_FILES[template?.category] || 'unknown.json';
}

function fingerprintValue(value, key = '') {
  if (typeof value === 'number') return '<numeric>';
  if (Array.isArray(value)) return value.map((item) => fingerprintValue(item, key));
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((name) => ![
          'target', 'addressee', 'addressees', 'recipient', 'recipients', 'name', 'description',
          'min', 'max', 'default', 'weight', 'severity', 'value', 'cooldown', 'maxOccurrences',
          'maxSeverity', 'budget', 'rehearsal', 'review', 'reviewStatus', 'source',
          'trainingAssumption', 'version', 'schemaVersion', 'templateId', '_file',
        ].includes(name))
        .sort()
        .map((name) => [name, fingerprintValue(value[name], name)]),
    );
  }
  return value;
}

export function mechanismFingerprint(template) {
  const applicability = isObject(template?.applicability) ? template.applicability : {};
  const time = isObject(applicability.time) ? applicability.time : {};
  const limits = isObject(template?.limits) ? template.limits : {};
  const cascade = isObject(template?.cascade) ? template.cascade : {};
  const material = {
    category: template?.category,
    educationalQuestion: typeof template?.educationalQuestion === 'string'
      ? template.educationalQuestion.trim().replace(/\s+/g, ' ')
      : template?.educationalQuestion,
    applicability: {
      scales: applicability.scales,
      stages: applicability.stages,
      sides: applicability.sides,
      allowedStates: applicability.allowedStates,
      disallowedStates: applicability.disallowedStates,
      geography: applicability.geography,
      time: { ...time, minLead: undefined },
    },
    preconditions: Array.isArray(template?.preconditions)
      ? template.preconditions.map((condition) => ({
          fact: condition?.fact,
          operator: condition?.operator,
          value: typeof condition?.value === 'number' ? '<numeric>' : fingerprintValue(condition?.value),
          onUnknown: condition?.onUnknown,
        }))
      : template?.preconditions,
    parameters: Array.isArray(template?.parameters)
      ? template.parameters.map((parameter) => ({ id: parameter?.id, unit: parameter?.unit }))
      : template?.parameters,
    limits: { mutuallyExclusiveGroups: limits.mutuallyExclusiveGroups },
    cascade: {
      allowedFollowUpTemplateIds: cascade.allowedFollowUpTemplateIds,
      onExhausted: cascade.onExhausted,
    },
    effects: fingerprintValue(template?.effects),
    observations: fingerprintValue(template?.observations),
    reports: fingerprintValue(template?.reports),
    compensations: fingerprintValue(template?.compensations),
    expectedEvidence: template?.expectedEvidence,
  };
  return sha256(material);
}

function compare(condition, facts) {
  const actual = facts?.[condition.fact];
  if (actual === undefined || actual === null || actual === 'UNKNOWN') return 'UNKNOWN';
  const expected = condition.value;
  switch (condition.operator) {
    case 'EQUALS': return actual === expected;
    case 'NOT_EQUALS': return actual !== expected;
    case 'IN': return Array.isArray(expected) && expected.includes(actual);
    case 'GREATER_OR_EQUAL': return typeof actual === 'number' && actual >= expected;
    case 'LESS_OR_EQUAL': return typeof actual === 'number' && actual <= expected;
    case 'GREATER': return typeof actual === 'number' && actual > expected;
    case 'LESS': return typeof actual === 'number' && actual < expected;
    default: return false;
  }
}

export function rehearseTemplate(template, facts) {
  const failedPreconditions = (Array.isArray(template?.preconditions) ? template.preconditions : [])
    .map((condition) => ({ condition, result: compare(condition, facts) }))
    .filter((entry) => entry.result !== true)
    .map((entry) => ({
      fact: entry.condition.fact,
      code: entry.result === 'UNKNOWN' ? 'UNKNOWN_FACT' : 'PRECONDITION_FALSE',
    }));
  const applicable = failedPreconditions.length === 0;
  return {
    outcome: applicable ? 'APPLIED' : 'REJECTED',
    applicable,
    reasonCode: applicable
      ? null
      : failedPreconditions.some((failure) => failure.code === 'UNKNOWN_FACT')
        ? 'PRECONDITION_UNKNOWN'
        : 'PRECONDITION_FAILED',
    failedPreconditions,
    evidence: applicable
      ? (template.expectedEvidence || []).map((type) => ({ type, templateId: template.templateId }))
      : [],
  };
}

function findNonJson(value, path = '$', seen = new Set()) {
  if (typeof value === 'function') return path;
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findNonJson(value[index], `${path}[${index}]`, seen);
      if (found) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('_')) continue;
    const found = findNonJson(child, `${path}.${key}`, seen);
    if (found) return found;
  }
  return null;
}

function validateTemplate(template, sourceIndex, addIssue) {
  const path = (suffix) => `${templateFile(template)}#/${template?.templateId || 'unknown'}${suffix || ''}`;
  const issue = (code, suffix, message) => addIssue({
    code,
    path: path(suffix),
    templateId: template?.templateId || null,
    message,
  });
  if (!isObject(template)) {
    issue('TEMPLATE_NOT_OBJECT', '', 'Шаблон должен быть JSON-объектом.');
    return;
  }
  const nonJsonPath = findNonJson(template);
  if (nonJsonPath) issue('NON_JSON_DATA', nonJsonPath, 'Шаблон содержит функцию или не JSON-значение.');
  if (template.schemaVersion !== SCHEMA_VERSION) issue('SCHEMA_VERSION', '/schemaVersion', 'Неподдерживаемая версия схемы.');
  if (typeof template.templateId !== 'string' || !/^[a-z][a-z0-9-]+$/.test(template.templateId)) {
    issue('TEMPLATE_ID', '/templateId', 'Идентификатор должен быть стабильным slug без числового суффикса-варианта.');
  }
  if (!Number.isSafeInteger(template.version) || template.version < 1) issue('TEMPLATE_VERSION', '/version', 'Нужна положительная редакция шаблона.');
  if (!REQUIRED_CATEGORIES.includes(template.category)) issue('UNKNOWN_CATEGORY', '/category', 'Неизвестная категория события.');
  if (template._file && CATEGORY_FILES[template.category] && template._file !== CATEGORY_FILES[template.category]) {
    issue('CATEGORY_FILE_MISMATCH', '/category', 'Файл не соответствует категории шаблона.');
  }
  for (const field of ['name', 'description', 'educationalQuestion']) {
    if (!hasRussian(template[field]) || String(template[field]).trim().length < 12) {
      issue('RUSSIAN_CONTENT_REQUIRED', `/${field}`, 'Название, описание и учебный вопрос должны быть содержательными русскими строками.');
    }
  }
  if (typeof template.educationalQuestion === 'string' && !template.educationalQuestion.includes('?')) {
    issue('EDUCATIONAL_QUESTION', '/educationalQuestion', 'Учебный вопрос должен быть сформулирован как вопрос.');
  }
  if (!template.source && !hasRussian(template.trainingAssumption)) {
    issue('MISSING_PROVENANCE', '/source', 'Нужен источник или явное русское учебное допущение.');
  }
  if (template.source) {
    const source = sourceIndex.get(template.source.sourceId);
    if (!source) issue('UNKNOWN_SOURCE', '/source/sourceId', 'Источник отсутствует в sources.json.');
    else if (template.source.revision !== source.revision) issue('SOURCE_REVISION', '/source/revision', 'Редакция источника не совпадает с реестром.');
  }
  if (template.trainingAssumption !== undefined && !hasRussian(template.trainingAssumption)) {
    issue('TRAINING_ASSUMPTION', '/trainingAssumption', 'Учебное допущение должно быть явно записано по-русски.');
  }

  const applicability = template.applicability;
  if (!isObject(applicability)) issue('MISSING_APPLICABILITY', '/applicability', 'Нужны масштабы, этапы, стороны и пространственно-временные пределы.');
  else {
    if (!Array.isArray(applicability.scales) || applicability.scales.length === 0 || applicability.scales.some((scale) => !SCALES.has(scale))) {
      issue('UNKNOWN_SCALE', '/applicability/scales', 'Указан неизвестный масштаб учения.');
    }
    if (!Array.isArray(applicability.stages) || applicability.stages.length === 0 || applicability.stages.some((stage) => !STAGES.has(stage))) {
      issue('UNKNOWN_STAGE', '/applicability/stages', 'Указан неизвестный этап учения.');
    }
    if (!Array.isArray(applicability.sides) || applicability.sides.length === 0 || applicability.sides.some((side) => !SIDES.has(side))) {
      issue('UNKNOWN_SIDE', '/applicability/sides', 'Указана неизвестная сторона учения.');
    }
    if (!Array.isArray(applicability.allowedStates) || applicability.allowedStates.length === 0
      || !Array.isArray(applicability.disallowedStates) || applicability.disallowedStates.length === 0) {
      issue('STATE_APPLICABILITY', '/applicability', 'Нужно явно перечислить допустимые и недопустимые состояния.');
    }
    if (!isObject(applicability.geography) || !Array.isArray(applicability.geography.requiredFeatures)) {
      issue('GEOGRAPHY_PRECONDITION', '/applicability/geography', 'Нужны географические предусловия и требуемые объекты.');
    }
    if (!isObject(applicability.time) || applicability.time.operationalOnly !== true
      || applicability.time.withinStage !== true || applicability.time.allowBackward !== false) {
      issue('TIME_PRECONDITION', '/applicability/time', 'Допускается только прямое оперативное время внутри этапа.');
    }
  }

  if (!Array.isArray(template.preconditions) || template.preconditions.length === 0) {
    issue('MISSING_PRECONDITIONS', '/preconditions', 'Нужно хотя бы одно проверяемое предусловие.');
  } else {
    template.preconditions.forEach((condition, index) => {
      if (!isObject(condition) || typeof condition.fact !== 'string' || !OPERATORS.has(condition.operator)) {
        issue('UNKNOWN_PRECONDITION', `/preconditions/${index}`, 'Неизвестный факт или оператор предусловия.');
      }
      if (condition?.onUnknown !== 'REJECT') {
        issue('UNKNOWN_ACCEPTING_PRECONDITION', `/preconditions/${index}/onUnknown`, 'UNKNOWN и отсутствующие данные обязаны отклонять кандидата.');
      }
    });
  }

  const parameterIds = new Set();
  if (!Array.isArray(template.parameters) || template.parameters.length === 0) {
    issue('MISSING_PARAMETERS', '/parameters', 'Нужен хотя бы один параметр с единицей и диапазоном.');
  } else {
    template.parameters.forEach((parameter, index) => {
      if (!isObject(parameter) || typeof parameter.id !== 'string') {
        issue('PARAMETER_SHAPE', `/parameters/${index}`, 'Некорректный параметр.');
        return;
      }
      parameterIds.add(parameter.id);
      if (!UNITS.has(parameter.unit)) issue('UNKNOWN_UNIT', `/parameters/${index}/unit`, 'Неизвестная единица измерения.');
      if (![parameter.min, parameter.max, parameter.default].every(Number.isFinite)
        || parameter.min > parameter.max) {
        issue('PARAMETER_RANGE', `/parameters/${index}`, 'Диапазон параметра обращён или нечисловой.');
      } else if (parameter.default < parameter.min || parameter.default > parameter.max) {
        issue('PARAMETER_DEFAULT', `/parameters/${index}/default`, 'Значение по умолчанию вне диапазона.');
      }
    });
  }
  if (!Number.isFinite(template.weight) || template.weight <= 0) issue('WEIGHT', '/weight', 'Базовый вес должен быть положительным.');
  if (!Number.isSafeInteger(template.severity) || template.severity < 1 || template.severity > 5) {
    issue('SEVERITY', '/severity', 'Тяжесть задаётся целым значением от 1 до 5.');
  }
  const limits = template.limits;
  if (!isObject(limits) || !Number.isSafeInteger(limits.maxOccurrences) || limits.maxOccurrences < 1
    || !Number.isFinite(limits.cooldown?.value) || limits.cooldown.value < 0
    || !Array.isArray(limits.mutuallyExclusiveGroups)) {
    issue('LIMITS', '/limits', 'Нужны cooldown, максимум срабатываний и взаимоисключающие группы.');
  }

  if (!Array.isArray(template.effects) || template.effects.length === 0) {
    issue('MISSING_EFFECTS', '/effects', 'Нужен хотя бы один типизированный доменный эффект.');
  } else {
    template.effects.forEach((effect, index) => {
      const expectedDomain = EFFECT_DOMAINS[effect?.type];
      if (!expectedDomain) issue('UNKNOWN_EFFECT', `/effects/${index}/type`, 'Операция отсутствует в закрытом реестре эффектов.');
      const domain = effect?.target?.domain;
      if (PROTECTED_DOMAINS.has(domain) || PROTECTED_DOMAINS.has(effect?.target?.ref)) {
        issue('PROTECTED_TARGET', `/effects/${index}/target`, 'Событие не может изменять цели или оценку обучаемого.');
      } else if (expectedDomain && domain !== expectedDomain) {
        issue('EFFECT_DOMAIN', `/effects/${index}/target/domain`, 'Домен цели не соответствует типизированной операции.');
      }
      if (effect?.type === 'consumeResource') {
        const quantity = template.parameters?.find((parameter) => parameter.id === effect.quantityParameter);
        if (effect.allowNegative === true || effect.fixedQuantity < 0 || quantity?.min < 0) {
          issue('NEGATIVE_RESOURCE', `/effects/${index}/quantityParameter`, 'Расход ресурса не может иметь отрицательную величину или создавать отрицательный остаток.');
        }
      }
      for (const [key, value] of Object.entries(effect || {})) {
        if (key.endsWith('Parameter') && !parameterIds.has(value)) {
          issue('UNKNOWN_EFFECT_PARAMETER', `/effects/${index}/${key}`, 'Эффект ссылается на неизвестный параметр.');
        }
      }
    });
  }
  if (!Array.isArray(template.observations) || template.observations.length === 0) {
    issue('MISSING_OBSERVATION', '/observations', 'Событие должно иметь доступный источник наблюдения.');
  }
  if (!Array.isArray(template.reports) || template.reports.length === 0) {
    issue('MISSING_REPORT', '/reports', 'Событие должно создавать донесение.');
  } else {
    template.reports.forEach((report, index) => {
      if (report.deadlineParameter && !parameterIds.has(report.deadlineParameter)) {
        issue('UNKNOWN_REPORT_PARAMETER', `/reports/${index}/deadlineParameter`, 'Донесение ссылается на неизвестный параметр.');
      }
    });
  }
  if (!Array.isArray(template.compensations) || template.compensations.length === 0) {
    issue('MISSING_COMPENSATION', '/compensations', 'Нужно правило компенсации последствия.');
  } else {
    const effectTypes = new Set((template.effects || []).map((effect) => effect.type));
    template.compensations.forEach((compensation, index) => {
      if (compensation.type !== 'createCompensationRequest') {
        issue('UNKNOWN_COMPENSATION', `/compensations/${index}/type`, 'Компенсация оформляется только типизированной заявкой.');
      }
      if (!effectTypes.has(compensation.targetEffectType)) {
        issue('COMPENSATION_TARGET', `/compensations/${index}/targetEffectType`, 'Компенсация должна ссылаться на эффект этого шаблона.');
      }
    });
  }
  if (!Array.isArray(template.expectedEvidence) || template.expectedEvidence.length === 0) {
    issue('MISSING_EVIDENCE', '/expectedEvidence', 'Нужны ожидаемые доказательства применения и разбора.');
  }
  if (!isObject(template.cascade) || !Array.isArray(template.cascade.allowedFollowUpTemplateIds)
    || !Number.isSafeInteger(template.cascade.budget?.maxDepth) || template.cascade.budget.maxDepth < 0
    || !Number.isSafeInteger(template.cascade.budget?.maxEvents) || template.cascade.budget.maxEvents < 1) {
    issue('CASCADE_BUDGET', '/cascade', 'Нужны разрешённые последующие события и конечный бюджет каскада.');
  }

  if (!isObject(template.rehearsal) || !isObject(template.rehearsal.suitableFacts)
    || !isObject(template.rehearsal.unsuitableFacts)) {
    issue('MISSING_REHEARSAL', '/rehearsal', 'Нужны подходящее и неподходящее состояния репетиции.');
  } else {
    const suitable = rehearseTemplate(template, template.rehearsal.suitableFacts);
    const unsuitable = rehearseTemplate(template, template.rehearsal.unsuitableFacts);
    if (!suitable.applicable) issue('SUITABLE_STATE_REJECTED', '/rehearsal/suitableFacts', 'Подходящее состояние не проходит предусловия.');
    if (unsuitable.applicable) issue('UNSUITABLE_STATE_ACCEPTED', '/rehearsal/unsuitableFacts', 'Неподходящее состояние ошибочно проходит предусловия.');
    else if (template.rehearsal.expectedRejectCode !== unsuitable.reasonCode) {
      issue('REHEARSAL_REASON_MISMATCH', '/rehearsal/expectedRejectCode', 'Код отказа репетиции не совпадает с ожидаемым.');
    }
  }
  if (template.reviewStatus === 'APPROVED' && (!template.review?.sourceChecked
    || !template.review?.effectsChecked || !template.review?.rehearsalRequired)) {
    issue('REVIEW_INCOMPLETE', '/review', 'Утверждение требует проверки источника, эффектов и репетиции.');
  }
}

function detectCascadeIssues(templates, addIssue) {
  const byId = new Map(templates.map((template) => [template.templateId, template]));
  for (const template of templates) {
    for (const followUp of template.cascade?.allowedFollowUpTemplateIds || []) {
      if (!byId.has(followUp)) {
        addIssue({
          code: 'UNKNOWN_FOLLOW_UP',
          path: `${templateFile(template)}#/${template.templateId}/cascade`,
          templateId: template.templateId,
          message: `Неизвестное последующее событие ${followUp}.`,
        });
      }
    }
  }
  const state = new Map();
  const reported = new Set();
  function visit(templateId) {
    if (state.get(templateId) === 'DONE') return;
    if (state.get(templateId) === 'ACTIVE') return;
    state.set(templateId, 'ACTIVE');
    const template = byId.get(templateId);
    for (const next of template?.cascade?.allowedFollowUpTemplateIds || []) {
      if (!byId.has(next)) continue;
      if (state.get(next) === 'ACTIVE') {
        const key = [templateId, next].sort().join('|');
        if (!reported.has(key)) {
          reported.add(key);
          addIssue({
            code: 'CASCADE_CYCLE',
            path: `${templateFile(template)}#/${templateId}/cascade`,
            templateId,
            message: `Цикл каскада: ${templateId} → ${next}.`,
          });
        }
      } else visit(next);
    }
    state.set(templateId, 'DONE');
  }
  for (const templateId of byId.keys()) visit(templateId);
}

function validateManifest(templates, manifest, requireManifest, addIssue) {
  if (!manifest) {
    if (requireManifest) {
      addIssue({ code: 'MANIFEST_MISSING', path: 'manifest.json', templateId: null, message: 'Отсутствует манифест каталога.' });
    }
    return;
  }
  const entries = new Map((manifest.templates || []).map((entry) => [entry.templateId, entry]));
  for (const template of templates) {
    const entry = entries.get(template.templateId);
    if (!entry) {
      addIssue({
        code: 'MANIFEST_ENTRY_MISSING', path: `${templateFile(template)}#/${template.templateId}`,
        templateId: template.templateId, message: 'Шаблон отсутствует в манифесте.',
      });
      continue;
    }
    if (entry.sha256 !== sha256(template)) {
      addIssue({
        code: 'MANIFEST_HASH_MISMATCH', path: `${templateFile(template)}#/${template.templateId}`,
        templateId: template.templateId, message: 'SHA-256 содержимого не совпадает с манифестом.',
      });
    }
  }
  const ids = new Set(templates.map((template) => template.templateId));
  for (const entry of entries.values()) {
    if (!ids.has(entry.templateId)) {
      addIssue({
        code: 'MANIFEST_ORPHAN_ENTRY', path: `manifest.json#/${entry.templateId}`,
        templateId: entry.templateId, message: 'Манифест ссылается на отсутствующий шаблон.',
      });
    }
  }
}

export function analyzeCatalog({
  templates,
  sources = { sources: [] },
  manifest = null,
  requireManifest = false,
  requireMinimum = 240,
  requirePerCategory = 20,
}) {
  const issues = [];
  const addIssue = (issue) => issues.push(issue);
  const sourceIndex = new Map((sources.sources || []).map((source) => [source.sourceId, source]));
  const ids = new Map();
  for (const template of templates) {
    if (ids.has(template.templateId)) {
      addIssue({
        code: 'DUPLICATE_TEMPLATE_ID', path: `${templateFile(template)}#/${template.templateId}`,
        templateId: template.templateId, message: `Идентификатор уже используется в ${ids.get(template.templateId)}.`,
      });
    } else ids.set(template.templateId, templateFile(template));
    validateTemplate(template, sourceIndex, addIssue);
  }
  detectCascadeIssues(templates, addIssue);
  validateManifest(templates, manifest, requireManifest, addIssue);

  const invalidIds = new Set(issues.filter((issue) => issue.templateId).map((issue) => issue.templateId));
  const approved = templates.filter((template) => template.reviewStatus === 'APPROVED' && !invalidIds.has(template.templateId));
  const fingerprints = new Map();
  for (const template of approved) {
    const hash = mechanismFingerprint(template);
    if (!fingerprints.has(hash)) fingerprints.set(hash, []);
    fingerprints.get(hash).push(template);
  }
  const duplicateMechanisms = [];
  for (const [hash, group] of fingerprints) {
    if (group.length < 2) continue;
    const templateIds = group.map((template) => template.templateId).sort();
    duplicateMechanisms.push({ hash, templateIds });
    addIssue({
      code: 'DUPLICATE_MECHANISM',
      path: group.map((template) => `${templateFile(template)}#/${template.templateId}`).join(', '),
      templateId: null,
      message: `Один содержательный механизм используют записи: ${templateIds.join(', ')}.`,
    });
  }

  const requiredCategories = REQUIRED_CATEGORIES.map((category) => {
    const categoryTemplates = templates.filter((template) => template.category === category);
    const categoryApproved = approved.filter((template) => template.category === category);
    const distinct = new Set(categoryApproved.map((template) => mechanismFingerprint(template))).size;
    if (distinct < requirePerCategory) {
      addIssue({
        code: 'CATEGORY_MINIMUM', path: CATEGORY_FILES[category], templateId: null,
        message: `В категории ${category}: ${distinct} различных вместо ${requirePerCategory}.`,
      });
    }
    return {
      category,
      file: CATEGORY_FILES[category],
      total: categoryTemplates.length,
      approved: categoryApproved.length,
      approvedDistinct: distinct,
    };
  });
  if (approvedDistinctTotal(approved) < requireMinimum) {
    addIssue({
      code: 'CATALOG_MINIMUM', path: 'manifest.json', templateId: null,
      message: `В каталоге ${approvedDistinctTotal(approved)} различных вместо ${requireMinimum}.`,
    });
  }

  const rehearsals = templates.map((template) => ({
    templateId: template.templateId,
    file: templateFile(template),
    suitable: isObject(template.rehearsal?.suitableFacts)
      ? rehearseTemplate(template, template.rehearsal.suitableFacts)
      : { outcome: 'REJECTED', reasonCode: 'MISSING_REHEARSAL' },
    unsuitable: isObject(template.rehearsal?.unsuitableFacts)
      ? rehearseTemplate(template, template.rehearsal.unsuitableFacts)
      : { outcome: 'REJECTED', reasonCode: 'MISSING_REHEARSAL' },
  }));

  return {
    reportVersion: 1,
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: manifest?.catalogVersion || 'unmanifested',
    effectContractVersion: EFFECT_CONTRACT_VERSION,
    valid: issues.length === 0,
    requirements: { minimum: requireMinimum, perCategory: requirePerCategory },
    totalTemplates: templates.length,
    approvedTemplates: templates.filter((template) => template.reviewStatus === 'APPROVED').length,
    approvedDistinct: approvedDistinctTotal(approved),
    requiredCategories,
    duplicateMechanisms: duplicateMechanisms.sort((a, b) => a.hash.localeCompare(b.hash)),
    mechanismFingerprints: approved.map((template) => ({
      templateId: template.templateId,
      category: template.category,
      file: templateFile(template),
      hash: mechanismFingerprint(template),
    })).sort((a, b) => a.templateId.localeCompare(b.templateId)),
    rehearsals,
    issues,
  };
}

function approvedDistinctTotal(templates) {
  return new Set(templates.map((template) => mechanismFingerprint(template))).size;
}

export function buildManifest({ templates, rawFiles = {}, catalogVersion = '1.0.0' }) {
  const entries = templates.map((template) => ({
    templateId: template.templateId,
    version: template.version,
    category: template.category,
    file: templateFile(template),
    sha256: sha256(template),
    mechanismHash: mechanismFingerprint(template),
    reviewStatus: template.reviewStatus,
  })).sort((a, b) => a.templateId.localeCompare(b.templateId));
  return {
    schemaVersion: SCHEMA_VERSION,
    catalogId: 'kshvi-autonomous-events',
    catalogVersion,
    effectContractVersion: EFFECT_CONTRACT_VERSION,
    reviewStatus: 'APPROVED',
    sourcesFile: 'sources.json',
    categories: REQUIRED_CATEGORIES.map((category) => ({
      category,
      file: CATEGORY_FILES[category],
      count: templates.filter((template) => template.category === category).length,
      sha256: rawFiles[CATEGORY_FILES[category]] === undefined ? null : sha256(rawFiles[CATEGORY_FILES[category]]),
    })),
    totals: {
      templates: templates.length,
      approvedDistinct: approvedDistinctTotal(templates),
    },
    templates: entries,
  };
}

export async function loadCatalog(catalogDirectory) {
  const root = resolve(catalogDirectory);
  const templates = [];
  const rawFiles = {};
  for (const file of Object.values(CATEGORY_FILES)) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    const raw = await readFile(path, 'utf8');
    rawFiles[file] = raw;
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed) ? parsed : parsed.templates;
    if (!Array.isArray(records)) throw new Error(`В ${file} отсутствует массив templates.`);
    for (const template of records) templates.push({ ...template, _file: file });
  }
  const sourcesPath = resolve(root, 'sources.json');
  const sources = existsSync(sourcesPath)
    ? JSON.parse(await readFile(sourcesPath, 'utf8'))
    : { schemaVersion: SCHEMA_VERSION, sources: [] };
  const manifestPath = resolve(root, 'manifest.json');
  const manifest = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, 'utf8'))
    : null;
  return { root, templates, rawFiles, sources, manifest };
}

function parseArguments(argv) {
  const options = {
    catalog: 'packages/kshvi-events/data/catalog',
    requireMinimum: 240,
    requirePerCategory: 20,
    output: null,
    writeManifest: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--write-manifest') options.writeManifest = true;
    else if (argument === '--catalog') options.catalog = argv[++index];
    else if (argument === '--require-minimum') options.requireMinimum = Number(argv[++index]);
    else if (argument === '--require-per-category') options.requirePerCategory = Number(argv[++index]);
    else if (argument === '--output') options.output = argv[++index];
    else throw new Error(`Неизвестный аргумент: ${argument}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const loaded = await loadCatalog(options.catalog);
  if (options.writeManifest) {
    loaded.manifest = buildManifest(loaded);
    await writeFile(resolve(loaded.root, 'manifest.json'), `${JSON.stringify(loaded.manifest, null, 2)}\n`, 'utf8');
  }
  const report = analyzeCatalog({
    ...loaded,
    requireManifest: true,
    requireMinimum: options.requireMinimum,
    requirePerCategory: options.requirePerCategory,
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    const output = resolve(options.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serialized, 'utf8');
  } else process.stdout.write(serialized);
  const summary = {
    valid: report.valid,
    total: report.totalTemplates,
    approvedDistinct: report.approvedDistinct,
    categories: Object.fromEntries(report.requiredCategories.map((entry) => [entry.category, entry.approvedDistinct])),
    issues: report.issues.length,
  };
  process.stderr.write(`${JSON.stringify(summary)}\n`);
  if (!report.valid) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
