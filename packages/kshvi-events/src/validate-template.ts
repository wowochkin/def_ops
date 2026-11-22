import { CATALOG_EFFECT_OPERATIONS, EVENT_EFFECT_TYPES, EVENT_UNITS, type EventUnit } from './model/event-effect';
import type { EventTemplate, ValidationIssue, ValidationResult } from './model/event-template';
import { validateTemplateAgainstSchema } from './template-schema';

export type ResourceValidationReference = {
  resourceId: string;
  ownerSideId: string;
  unit: EventUnit;
};

export type TemplateValidationContext = {
  stageIds?: readonly string[];
  sideIds?: readonly string[];
  areaIds?: readonly string[];
  templateIds?: readonly string[];
  resources?: readonly ResourceValidationReference[];
  relatedTemplates?: readonly EventTemplate[];
};

type ObjectValue = Record<string, unknown>;
type ParameterReference = { unit: string; min: number; max: number; path: string };

function isObject(value: unknown): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function add(issues: ValidationIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path: path || '/', message, severity: 'ERROR' });
}

function scanNonJson(value: unknown, path: string, issues: ValidationIssue[], seen: WeakSet<object>): void {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    add(issues, 'NON_JSON_VALUE', path, 'Число должно быть конечным JSON-значением.');
    return;
  }
  if (['function', 'undefined', 'bigint', 'symbol'].includes(typeof value)) {
    add(issues, 'NON_JSON_VALUE', path, 'Шаблон допускает только JSON-данные; функции и исполняемые значения запрещены.');
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) {
    add(issues, 'NON_JSON_VALUE', path, 'Циклическая ссылка не является сериализуемым JSON-значением.');
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanNonJson(item, `${path}/${index}`, issues, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      const escaped = key.replaceAll('~', '~0').replaceAll('/', '~1');
      scanNonJson(item, `${path}/${escaped}`, issues, seen);
    }
  }
  seen.delete(value);
}

function validateApplicability(value: ObjectValue, context: TemplateValidationContext, issues: ValidationIssue[]): void {
  if (!isObject(value.applicability)) return;
  const applicability = value.applicability;
  const knownStages = context.stageIds ? new Set(context.stageIds) : null;
  strings(applicability.stageIds).forEach((stageId, index) => {
    if (knownStages && !knownStages.has(stageId)) {
      add(issues, 'UNKNOWN_STAGE', `/applicability/stageIds/${index}`, `Этап «${stageId}» отсутствует в сценарии.`);
    }
  });

  const knownSides = context.sideIds ? new Set(context.sideIds) : null;
  strings(applicability.sideIds).forEach((sideId, index) => {
    if (knownSides && !knownSides.has(sideId)) {
      add(issues, 'UNKNOWN_SIDE', `/applicability/sideIds/${index}`, `Сторона «${sideId}» отсутствует в сценарии.`);
    }
  });

  if (isObject(applicability.geography)) {
    const geography = applicability.geography;
    const knownAreas = context.areaIds ? new Set(context.areaIds) : null;
    strings(geography.areaIds).forEach((areaId, index) => {
      if (knownAreas && !knownAreas.has(areaId)) {
        add(issues, 'UNKNOWN_AREA', `/applicability/geography/areaIds/${index}`, `Район «${areaId}» отсутствует в снимке среды.`);
      }
    });
    if (isObject(geography.boundingBox)) {
      const box = geography.boundingBox;
      if (typeof box.minLatitude === 'number' && typeof box.maxLatitude === 'number' && box.minLatitude > box.maxLatitude) {
        add(issues, 'REVERSED_RANGE', '/applicability/geography/boundingBox', 'Минимальная широта больше максимальной.');
      }
      if (typeof box.minLongitude === 'number' && typeof box.maxLongitude === 'number' && box.minLongitude > box.maxLongitude) {
        add(issues, 'REVERSED_RANGE', '/applicability/geography/boundingBox', 'Минимальная долгота больше максимальной.');
      }
    }
  }

  items(applicability.operationalWindows).forEach((windowValue, index) => {
    if (!isObject(windowValue)) return;
    if (
      typeof windowValue.startMinute === 'number'
      && typeof windowValue.endMinute === 'number'
      && windowValue.startMinute >= windowValue.endMinute
    ) {
      add(
        issues,
        'REVERSED_TIME_WINDOW',
        `/applicability/operationalWindows/${index}`,
        'Начало оперативного окна должно быть раньше его окончания.',
      );
    }
  });
}

function validateParameters(value: ObjectValue, issues: ValidationIssue[]): Map<string, ParameterReference> {
  const parameters = new Map<string, ParameterReference>();
  items(value.parameters).forEach((parameterValue, index) => {
    if (!isObject(parameterValue)) return;
    const base = `/parameters/${index}`;
    const parameterId = parameterValue.parameterId;
    const unit = parameterValue.unit;
    if (typeof unit === 'string' && !EVENT_UNITS.includes(unit as EventUnit)) {
      add(issues, 'UNKNOWN_UNIT', `${base}/unit`, `Единица «${unit}» не входит в реестр базовых единиц.`);
    }
    if (typeof parameterId === 'string') {
      if (parameters.has(parameterId)) {
        add(issues, 'DUPLICATE_PARAMETER', `${base}/parameterId`, `Параметр «${parameterId}» объявлен повторно.`);
      }
      if (isObject(parameterValue.range) && typeof parameterValue.range.min === 'number' && typeof parameterValue.range.max === 'number') {
        parameters.set(parameterId, { unit: String(unit), min: parameterValue.range.min, max: parameterValue.range.max, path: base });
      }
    }
    if (isObject(parameterValue.range)) {
      const { min, max } = parameterValue.range;
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        add(issues, 'REVERSED_RANGE', `${base}/range`, 'Нижняя граница параметра больше верхней.');
      }
      if (typeof parameterValue.defaultValue === 'number' && typeof min === 'number' && typeof max === 'number') {
        if (parameterValue.defaultValue < min || parameterValue.defaultValue > max) {
          add(issues, 'PARAMETER_OUT_OF_RANGE', `${base}/defaultValue`, 'Значение по умолчанию выходит за разрешённый диапазон.');
        }
      }
    }
  });
  return parameters;
}

function validateAmount(
  amount: unknown,
  unit: unknown,
  path: string,
  parameters: Map<string, ParameterReference>,
  issues: ValidationIssue[],
): void {
  if (typeof amount === 'number') {
    if (amount < 0) add(issues, 'NEGATIVE_RESOURCE_AMOUNT', path, 'Количество ресурса не может быть отрицательным.');
    return;
  }
  if (!isObject(amount) || typeof amount.parameterId !== 'string') return;
  const parameter = parameters.get(amount.parameterId);
  if (!parameter) {
    add(issues, 'UNKNOWN_PARAMETER', `${path}/parameterId`, `Параметр «${amount.parameterId}» не объявлен в шаблоне.`);
    return;
  }
  if (parameter.min < 0) {
    add(issues, 'NEGATIVE_RESOURCE_RANGE', `${parameter.path}/range/min`, 'Параметр ресурсного эффекта допускает отрицательное количество.');
  }
  if (typeof unit === 'string' && parameter.unit !== unit) {
    add(issues, 'UNIT_MISMATCH', `${path.replace(/\/amount$/, '')}/unit`, 'Единица эффекта не совпадает с единицей параметра количества.');
  }
}

function findResource(
  context: TemplateValidationContext,
  resourceId: string,
  ownerSideId?: string,
): ResourceValidationReference | undefined {
  return context.resources?.find(resource => resource.resourceId === resourceId && (!ownerSideId || resource.ownerSideId === ownerSideId));
}

function validateResourceReference(
  effect: ObjectValue,
  base: string,
  ownerKey: 'ownerSideId' | 'fromSideId' | 'toSideId',
  context: TemplateValidationContext,
  issues: ValidationIssue[],
): void {
  const resourceId = effect.resourceId;
  const ownerSideId = effect[ownerKey];
  const unit = effect.unit;
  if (typeof unit === 'string' && !EVENT_UNITS.includes(unit as EventUnit)) {
    add(issues, 'UNKNOWN_UNIT', `${base}/unit`, `Единица «${unit}» не входит в реестр базовых единиц.`);
  }
  if (context.resources && typeof resourceId === 'string') {
    const byId = context.resources.filter(resource => resource.resourceId === resourceId);
    const resource = findResource(context, resourceId);
    if (byId.length === 0) {
      add(issues, 'UNKNOWN_RESOURCE', `${base}/resourceId`, `Ресурс «${resourceId}» отсутствует в сценарном реестре.`);
    } else if (resource && typeof unit === 'string' && resource.unit !== unit) {
      add(issues, 'UNIT_MISMATCH', `${base}/unit`, 'Единица эффекта не совпадает с единицей ресурса в реестре.');
    }
    if (typeof ownerSideId === 'string' && byId.length > 0 && !byId.some(item => item.ownerSideId === ownerSideId)) {
      add(issues, 'RESOURCE_OWNER_MISMATCH', `${base}/${ownerKey}`, 'Указанная сторона не владеет этим ресурсом.');
    }
  }
  if (typeof ownerSideId === 'string' && context.sideIds && !context.sideIds.includes(ownerSideId)) {
    add(issues, 'UNKNOWN_SIDE', `${base}/${ownerKey}`, `Сторона «${ownerSideId}» отсутствует в сценарии.`);
  }
}

function validateEffects(
  value: ObjectValue,
  context: TemplateValidationContext,
  parameters: Map<string, ParameterReference>,
  issues: ValidationIssue[],
): void {
  const scopeSides = isObject(value.applicability) ? new Set(strings(value.applicability.sideIds)) : new Set<string>();
  items(value.effects).forEach((effectValue, index) => {
    if (!isObject(effectValue)) return;
    const base = `/effects/${index}`;
    const type = effectValue.type;
    if (typeof type !== 'string' || !EVENT_EFFECT_TYPES.includes(type as (typeof EVENT_EFFECT_TYPES)[number])) {
      const protectedType = typeof type === 'string' && /(?:assessment|evaluation|score|training[._-]?goal|learning[._-]?(?:goal|objective)|^goal[._-]?)/i.test(type);
      add(
        issues,
        protectedType ? 'TRAINING_DATA_PROTECTED' : 'UNKNOWN_EFFECT',
        `${base}/type`,
        protectedType
          ? 'Вероятностное событие не может изменять цели или оценку обучаемого.'
          : 'Неизвестная операция: разрешены только типизированные доменные эффекты.',
      );
      return;
    }

    if (type === 'resource.adjust' || type === 'resource.transfer') {
      validateAmount(effectValue.amount, effectValue.unit, `${base}/amount`, parameters, issues);
      if (type === 'resource.adjust') {
        validateResourceReference(effectValue, base, 'ownerSideId', context, issues);
        if (typeof effectValue.ownerSideId === 'string' && scopeSides.size > 0 && !scopeSides.has(effectValue.ownerSideId)) {
          add(issues, 'SIDE_OUT_OF_SCOPE', `${base}/ownerSideId`, 'Владелец ресурса не входит в допустимые стороны шаблона.');
        }
      } else {
        validateResourceReference(effectValue, base, 'fromSideId', context, issues);
        validateResourceReference(effectValue, base, 'toSideId', context, issues);
        if (effectValue.fromSideId === effectValue.toSideId) {
          add(issues, 'RESOURCE_TRANSFER_CONFLICT', `${base}/toSideId`, 'Передача ресурса требует разных сторон отправителя и получателя.');
        }
      }
    }
    if (type === 'catalog.effect') {
      if (!CATALOG_EFFECT_OPERATIONS.includes(effectValue.operation as (typeof CATALOG_EFFECT_OPERATIONS)[number])) {
        add(issues, 'UNKNOWN_OPERATION', `${base}/operation`, 'Операция отсутствует в версионном контракте каталога.');
      }
      if (!isObject(effectValue.target) || typeof effectValue.target.domain !== 'string' || typeof effectValue.target.ref !== 'string' || !effectValue.target.domain || !effectValue.target.ref) {
        add(issues, 'TARGET_REQUIRED', `${base}/target`, 'Типизированная операция требует домен и ссылку на объект.');
      } else if (/(?:assessment|goals?|score)/i.test(effectValue.target.domain)) {
        add(issues, 'TRAINING_DATA_PROTECTED', `${base}/target/domain`, 'Вероятностное событие не может изменять цели или оценку обучаемого.');
      }
      if (typeof effectValue.mechanism !== 'string' || !effectValue.mechanism.trim()) add(issues, 'REQUIRED_TEXT', `${base}/mechanism`, 'Нужен механизм последствий.');
      if (typeof effectValue.reason !== 'string' || !effectValue.reason.trim()) add(issues, 'REQUIRED_TEXT', `${base}/reason`, 'Нужно основание последствий.');
    }
    if (type === 'terrain.state' && typeof effectValue.areaId === 'string' && context.areaIds && !context.areaIds.includes(effectValue.areaId)) {
      add(issues, 'UNKNOWN_AREA', `${base}/areaId`, `Район «${effectValue.areaId}» отсутствует в снимке среды.`);
    }
  });
}

function validateCompensations(
  value: ObjectValue,
  context: TemplateValidationContext,
  parameters: Map<string, ParameterReference>,
  issues: ValidationIssue[],
): void {
  const effects = items(value.effects);
  const compensations = items(value.compensations);
  const compensatedEffects = new Set<number>();

  effects.forEach((effectValue, index) => {
    if (!isObject(effectValue)) return;
    const consumes = effectValue.type === 'resource.adjust' && effectValue.operation === 'CONSUME';
    const transfers = effectValue.type === 'resource.transfer';
    if (!consumes && !transfers) return;
    const found = compensations.some(compensation => (
      isObject(compensation)
      && compensation.type === 'resource.restore'
      && compensation.effectIndex === index
    ));
    if (!found) {
      add(issues, 'COMPENSATION_REQUIRED', '/compensations', 'Расход или передача ресурса требует правила его восстановления.');
    }
  });

  compensations.forEach((compensationValue, index) => {
    if (!isObject(compensationValue)) return;
    const base = `/compensations/${index}`;
    const effectIndex = compensationValue.effectIndex;
    if (typeof effectIndex !== 'number' || !Number.isSafeInteger(effectIndex)) return;
    if (compensatedEffects.has(effectIndex)) {
      add(issues, 'COMPENSATION_CONFLICT', `${base}/effectIndex`, 'Для одного эффекта задано несколько конфликтующих компенсаций.');
    }
    compensatedEffects.add(effectIndex);
    const effectValue = effects[effectIndex];
    if (!isObject(effectValue)) {
      add(issues, 'COMPENSATION_CONFLICT', `${base}/effectIndex`, 'Компенсация ссылается на отсутствующий эффект.');
      return;
    }
    if (compensationValue.type === 'resource.restore') {
      validateAmount(compensationValue.amount, compensationValue.unit, `${base}/amount`, parameters, issues);
      validateResourceReference(compensationValue, base, 'ownerSideId', context, issues);
      const expectedOwner = effectValue.type === 'resource.transfer' ? effectValue.fromSideId : effectValue.ownerSideId;
      const comparisons = [
        ['resourceId', effectValue.resourceId],
        ['ownerSideId', expectedOwner],
        ['unit', effectValue.unit],
        ['amount', effectValue.amount],
      ] as const;
      for (const [key, expected] of comparisons) {
        if (JSON.stringify(compensationValue[key]) !== JSON.stringify(expected)) {
          add(issues, 'COMPENSATION_CONFLICT', `${base}/${key}`, 'Компенсация не соответствует ресурсу, владельцу, единице или количеству исходного эффекта.');
        }
      }
      if (effectValue.type !== 'resource.adjust' && effectValue.type !== 'resource.transfer') {
        add(issues, 'COMPENSATION_CONFLICT', `${base}/effectIndex`, 'Восстановление ресурса допустимо только для ресурсного эффекта.');
      }
    }
  });
}

function cascadeReferences(value: unknown): string[] {
  return isObject(value) && isObject(value.cascade) ? strings(value.cascade.allowedTemplateIds) : [];
}

function mutualGroups(value: unknown): Set<string> {
  return isObject(value) && isObject(value.limits) ? new Set(strings(value.limits.mutuallyExclusiveGroupIds)) : new Set<string>();
}

function reachesTemplate(
  start: string,
  target: string,
  graph: Map<string, unknown>,
  visited = new Set<string>(),
): boolean {
  if (start === target) return true;
  if (visited.has(start)) return false;
  visited.add(start);
  const next = graph.get(start);
  return cascadeReferences(next).some(candidate => reachesTemplate(candidate, target, graph, visited));
}

function validateCascade(value: ObjectValue, context: TemplateValidationContext, issues: ValidationIssue[]): void {
  if (!isObject(value.cascade)) return;
  const cascade = value.cascade;
  if (typeof cascade.maxDepth === 'number' && (!Number.isSafeInteger(cascade.maxDepth) || cascade.maxDepth < 1)) {
    add(issues, 'INVALID_CASCADE_BUDGET', '/cascade/maxDepth', 'Глубина каскада должна быть положительным целым числом.');
  }
  if (typeof cascade.maxEvents === 'number' && (!Number.isSafeInteger(cascade.maxEvents) || cascade.maxEvents < 1)) {
    add(issues, 'INVALID_CASCADE_BUDGET', '/cascade/maxEvents', 'Общий лимит каскадных событий должен быть положительным целым числом.');
  }

  const templateId = value.templateId;
  const graph = new Map<string, unknown>();
  for (const related of context.relatedTemplates ?? []) graph.set(related.templateId, related);
  if (typeof templateId === 'string') graph.set(templateId, value);
  const knownIds = new Set([...context.templateIds ?? [], ...graph.keys()]);
  const shouldCheckReferences = Boolean(context.templateIds || context.relatedTemplates);
  const ownGroups = mutualGroups(value);

  strings(cascade.allowedTemplateIds).forEach((allowedId, index) => {
    const path = `/cascade/allowedTemplateIds/${index}`;
    if (shouldCheckReferences && !knownIds.has(allowedId)) {
      add(issues, 'UNKNOWN_TEMPLATE', path, `Последующий шаблон «${allowedId}» отсутствует в версии каталога.`);
    }
    if (typeof templateId === 'string' && reachesTemplate(allowedId, templateId, graph)) {
      add(issues, 'CASCADE_CYCLE', path, 'Разрешённые последующие события образуют цикл каскада.');
    }
    const target = graph.get(allowedId);
    if (target) {
      const shared = [...mutualGroups(target)].filter(group => ownGroups.has(group));
      if (shared.length > 0) {
        add(issues, 'MUTUAL_EXCLUSION_CONFLICT', path, `Каскад объединяет взаимоисключающую группу «${shared[0]}».`);
      }
    }
  });
}

function validateVisibility(value: ObjectValue, context: TemplateValidationContext, issues: ValidationIssue[]): void {
  const observations = items(value.observations);
  const observationIds = new Set<string>();
  const observationValues = new Map<string, ObjectValue>();
  observations.forEach((observationValue, index) => {
    if (!isObject(observationValue)) return;
    const base = `/observations/${index}`;
    const observationId = observationValue.observationId;
    if (typeof observationId === 'string') {
      if (observationIds.has(observationId)) add(issues, 'DUPLICATE_OBSERVATION', `${base}/observationId`, 'Идентификатор наблюдения должен быть уникальным.');
      observationIds.add(observationId);
      observationValues.set(observationId, observationValue);
    }
    const recipients = strings(observationValue.recipientSideIds);
    if (observationValue.visibility === 'PARTICIPANT' && recipients.length === 0) {
      add(issues, 'OBSERVATION_RECIPIENT_REQUIRED', `${base}/recipientSideIds`, 'Для наблюдения участника нужен хотя бы один получатель.');
    }
    if (observationValue.visibility === 'CONTROL' && recipients.length > 0) {
      add(issues, 'VISIBILITY_CONFLICT', `${base}/recipientSideIds`, 'Служебное наблюдение не может иметь получателей среди сторон.');
    }
    if (isObject(observationValue.source)) {
      if (observationValue.visibility === 'PARTICIPANT' && recipients.length > 0 && observationValue.source.kind === 'CONTROL') {
        add(issues, 'OBSERVATION_SOURCE_UNAVAILABLE', `${base}/source/kind`, 'Участнику недоступен служебный источник без наблюдаемого канала.');
      }
      const sourceSide = observationValue.source.sideId;
      if (typeof sourceSide === 'string' && context.sideIds && !context.sideIds.includes(sourceSide)) {
        add(issues, 'UNKNOWN_SIDE', `${base}/source/sideId`, `Сторона источника «${sourceSide}» отсутствует в сценарии.`);
      }
    }
    recipients.forEach((sideId, recipientIndex) => {
      if (context.sideIds && !context.sideIds.includes(sideId)) {
        add(issues, 'UNKNOWN_SIDE', `${base}/recipientSideIds/${recipientIndex}`, `Сторона получателя «${sideId}» отсутствует в сценарии.`);
      }
    });
    if (isObject(observationValue.delaySeconds)) {
      const { min, max } = observationValue.delaySeconds;
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        add(issues, 'REVERSED_RANGE', `${base}/delaySeconds`, 'Минимальная задержка наблюдения больше максимальной.');
      }
    }
  });

  items(value.reports).forEach((reportValue, index) => {
    if (!isObject(reportValue)) return;
    const base = `/reports/${index}`;
    const observationId = reportValue.basedOnObservationId;
    if (typeof observationId !== 'string' || !observationIds.has(observationId)) {
      add(issues, 'UNKNOWN_OBSERVATION', `${base}/basedOnObservationId`, 'Донесение должно ссылаться на объявленное наблюдение.');
      return;
    }
    const observation = observationValues.get(observationId);
    const observableSides = new Set(observation ? strings(observation.recipientSideIds) : []);
    strings(reportValue.recipientSideIds).forEach((sideId, recipientIndex) => {
      if (!observableSides.has(sideId)) {
        add(issues, 'VISIBILITY_CONFLICT', `${base}/recipientSideIds/${recipientIndex}`, 'Донесение раскрывает наблюдение стороне, которой оно недоступно.');
      }
    });
  });
}

function validateLimits(value: ObjectValue, issues: ValidationIssue[]): void {
  if (typeof value.baseWeight === 'number' && value.baseWeight < 0) {
    add(issues, 'NEGATIVE_WEIGHT', '/baseWeight', 'Базовый вес события не может быть отрицательным.');
  }
  if (isObject(value.severity) && typeof value.severity.cost === 'number') {
    if (!Number.isSafeInteger(value.severity.cost) || value.severity.cost < 1) {
      add(issues, 'INVALID_LIMIT', '/severity/cost', 'Стоимость тяжести должна быть положительным целым числом.');
    }
  }
  if (!isObject(value.limits)) return;
  if (typeof value.limits.cooldownSeconds === 'number' && value.limits.cooldownSeconds < 0) {
    add(issues, 'INVALID_COOLDOWN', '/limits/cooldownSeconds', 'Cooldown не может быть отрицательным.');
  }
  for (const key of ['maxOccurrences', 'maxPerStage'] as const) {
    const limit = value.limits[key];
    if (typeof limit === 'number' && (!Number.isSafeInteger(limit) || limit < 1)) {
      add(issues, 'INVALID_LIMIT', `/limits/${key}`, 'Лимит срабатываний должен быть положительным целым числом.');
    }
  }
}

export function validateEventTemplate(value: unknown, context: TemplateValidationContext = {}): ValidationResult {
  const issues = validateTemplateAgainstSchema(value);
  scanNonJson(value, '', issues, new WeakSet<object>());
  if (!isObject(value)) return { valid: false, issues };

  if (!isObject(value.provenance) || !['SOURCE', 'TRAINING_ASSUMPTION'].includes(String(value.provenance.type))) {
    add(issues, 'PROVENANCE_REQUIRED', '/provenance', 'Укажите источник либо явное учебное допущение с утверждающим.');
  }

  validateApplicability(value, context, issues);
  const parameters = validateParameters(value, issues);
  items(value.preconditions).forEach((preconditionValue, index) => {
    if (!isObject(preconditionValue)) return;
    if (preconditionValue.required === true && preconditionValue.onUnknown !== 'NOT_TRUE') {
      add(
        issues,
        'UNKNOWN_PRECONDITION',
        `/preconditions/${index}/onUnknown`,
        'UNKNOWN обязательного предусловия обязан означать NOT_TRUE, а не истину.',
      );
    }
  });
  validateLimits(value, issues);
  validateEffects(value, context, parameters, issues);
  validateCompensations(value, context, parameters, issues);
  validateCascade(value, context, issues);
  validateVisibility(value, context, issues);

  return { valid: !issues.some(issue => issue.severity === 'ERROR'), issues };
}
