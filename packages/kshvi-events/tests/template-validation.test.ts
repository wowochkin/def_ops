import { describe, expect, it } from 'vitest';
import { validateEventTemplate } from '../src/validate-template';
import { validTemplate, validationContext } from './fixtures/valid-template';

function cloneTemplate(): typeof validTemplate {
  return structuredClone(validTemplate);
}

function issueCodes(value: unknown): string[] {
  return validateEventTemplate(value, validationContext).issues.map(issue => issue.code);
}

describe('строгий валидатор шаблона события', () => {
  it('принимает полный валидный шаблон', () => {
    expect(validateEventTemplate(validTemplate, validationContext)).toEqual({ valid: true, issues: [] });
  });

  it('отклоняет произвольную операцию и функцию в данных без её вызова', () => {
    const unknown = { ...cloneTemplate(), effects: [{ type: 'executeJavaScript', source: 'world = {}' }] };
    expect(validateEventTemplate(unknown).issues).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_EFFECT', path: '/effects/0/type', severity: 'ERROR' }),
    );

    let called = false;
    const withFunction = {
      ...cloneTemplate(),
      predicate: () => {
        called = true;
        return true;
      },
    };
    const result = validateEventTemplate(withFunction);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'NON_JSON_VALUE', path: '/predicate' }));
    expect(called).toBe(false);
  });

  it('отклоняет неизвестную единицу и несовместимость единиц параметра и эффекта', () => {
    const unknownUnit = cloneTemplate();
    (unknownUnit.parameters[0] as { unit: string }).unit = 'gallon';
    expect(issueCodes(unknownUnit)).toContain('UNKNOWN_UNIT');

    const mismatch = cloneTemplate();
    (mismatch.effects[0] as { unit: string }).unit = 'kg';
    const result = validateEventTemplate(mismatch, validationContext);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'UNIT_MISMATCH', path: '/effects/0/unit' }));
  });

  it('отклоняет обратные диапазоны параметров, географии и времени', () => {
    const parameter = cloneTemplate();
    parameter.parameters[0].range = { min: 11, max: 10 };
    expect(issueCodes(parameter)).toContain('REVERSED_RANGE');

    const geography = cloneTemplate();
    geography.applicability.geography.boundingBox = {
      minLatitude: 51,
      maxLatitude: 50,
      minLongitude: 30,
      maxLongitude: 31,
    };
    expect(validateEventTemplate(geography).issues).toContainEqual(
      expect.objectContaining({ code: 'REVERSED_RANGE', path: '/applicability/geography/boundingBox' }),
    );

    const time = cloneTemplate();
    time.applicability.operationalWindows[0] = { startMinute: 120, endMinute: 60 };
    expect(validateEventTemplate(time).issues).toContainEqual(
      expect.objectContaining({ code: 'REVERSED_TIME_WINDOW', path: '/applicability/operationalWindows/0' }),
    );
  });

  it('отклоняет отрицательный вес и некорректные ограничения', () => {
    const weight = cloneTemplate();
    weight.baseWeight = -1;
    expect(validateEventTemplate(weight).issues).toContainEqual(
      expect.objectContaining({ code: 'NEGATIVE_WEIGHT', path: '/baseWeight' }),
    );

    const cooldown = cloneTemplate();
    cooldown.limits.cooldownSeconds = -1;
    expect(validateEventTemplate(cooldown).issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_COOLDOWN', path: '/limits/cooldownSeconds' }),
    );

    const limits = cloneTemplate();
    limits.limits.maxOccurrences = 0;
    limits.limits.maxPerStage = 0;
    limits.cascade.maxDepth = 0;
    limits.cascade.maxEvents = 0;
    const codes = issueCodes(limits);
    expect(codes).toEqual(expect.arrayContaining(['INVALID_LIMIT', 'INVALID_CASCADE_BUDGET']));
  });

  it('проверяет ссылки на этапы, стороны и географические районы', () => {
    const value = cloneTemplate();
    value.applicability.stageIds = ['stage-missing'];
    value.applicability.sideIds = ['green'];
    value.applicability.geography.areaIds = ['area-missing'];
    const result = validateEventTemplate(value, validationContext);
    expect(result.issues.map(issue => issue.code)).toEqual(
      expect.arrayContaining(['UNKNOWN_STAGE', 'UNKNOWN_SIDE', 'UNKNOWN_AREA']),
    );
    for (const issue of result.issues.filter(issue => ['UNKNOWN_STAGE', 'UNKNOWN_SIDE', 'UNKNOWN_AREA'].includes(issue.code))) {
      expect(issue.path).toMatch(/^\//);
      expect(issue.message).toMatch(/[А-Яа-яЁё]/);
    }
  });

  it('требует источник либо явное учебное допущение', () => {
    const value = cloneTemplate() as unknown as Record<string, unknown>;
    delete value.provenance;
    expect(validateEventTemplate(value).issues).toContainEqual(
      expect.objectContaining({ code: 'PROVENANCE_REQUIRED', path: '/provenance' }),
    );
  });

  it('не считает UNKNOWN истиной в обязательном предусловии', () => {
    const value = cloneTemplate();
    (value.preconditions[0] as { onUnknown: string }).onUnknown = 'TRUE';
    expect(validateEventTemplate(value).issues).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_PRECONDITION', path: '/preconditions/0/onUnknown' }),
    );
  });

  it('отклоняет объект вместо скалярного значения предусловия', () => {
    const value = cloneTemplate();
    (value.preconditions[0] as { value: unknown }).value = { unexpected: true };
    expect(validateEventTemplate(value).issues).toContainEqual(
      expect.objectContaining({ code: 'SCHEMA_TYPE', path: '/preconditions/0/value' }),
    );
  });

  it('не допускает отрицательный диапазон параметра ресурсного эффекта', () => {
    const value = cloneTemplate();
    value.parameters[0].range.min = -5;
    expect(validateEventTemplate(value).issues).toContainEqual(
      expect.objectContaining({ code: 'NEGATIVE_RESOURCE_RANGE', path: '/parameters/0/range/min' }),
    );
  });

  it('сохраняет точный JSON path внутри выбранного варианта union', () => {
    const source = cloneTemplate();
    source.provenance = {
      type: 'SOURCE',
      locator: 'раздел 1',
      version: '1',
      approvedBy: 'Методист учения',
    } as unknown as typeof source.provenance;
    expect(validateEventTemplate(source).issues).toContainEqual(
      expect.objectContaining({ code: 'REQUIRED_FIELD', path: '/provenance/citation' }),
    );

    const effect = cloneTemplate();
    delete (effect.effects[0] as { resourceId?: string }).resourceId;
    expect(validateEventTemplate(effect).issues).toContainEqual(
      expect.objectContaining({ code: 'REQUIRED_FIELD', path: '/effects/0/resourceId' }),
    );
  });

  it('сохраняет ресурсы и проверяет их тип и владельца', () => {
    const negative = cloneTemplate();
    (negative.effects[0] as { amount: unknown }).amount = -5;
    expect(validateEventTemplate(negative).issues).toContainEqual(
      expect.objectContaining({ code: 'NEGATIVE_RESOURCE_AMOUNT', path: '/effects/0/amount' }),
    );

    const missing = cloneTemplate();
    (missing.effects[0] as { resourceId: string }).resourceId = 'ammunition';
    expect(validateEventTemplate(missing, validationContext).issues).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_RESOURCE', path: '/effects/0/resourceId' }),
    );

    const wrongOwner = cloneTemplate();
    (wrongOwner.effects[0] as { ownerSideId: string }).ownerSideId = 'red';
    expect(validateEventTemplate(wrongOwner, validationContext).issues).toContainEqual(
      expect.objectContaining({ code: 'RESOURCE_OWNER_MISMATCH', path: '/effects/0/ownerSideId' }),
    );
  });

  it('требует корректную компенсацию расхода ресурса', () => {
    const missing = cloneTemplate();
    missing.compensations = [];
    expect(validateEventTemplate(missing).issues).toContainEqual(
      expect.objectContaining({ code: 'COMPENSATION_REQUIRED', path: '/compensations' }),
    );

    const conflict = cloneTemplate();
    const compensation = conflict.compensations[0];
    if (compensation.type !== 'resource.restore') throw new Error('Фикстура должна содержать восстановление ресурса');
    conflict.compensations[0] = {
      ...compensation,
      resourceId: 'other-fuel',
    };
    expect(validateEventTemplate(conflict).issues).toContainEqual(
      expect.objectContaining({ code: 'COMPENSATION_CONFLICT', path: '/compensations/0/resourceId' }),
    );
  });

  it('обнаруживает цикл и взаимоисключение в разрешённом каскаде', () => {
    const second = cloneTemplate();
    second.templateId = 'logistics.fuel-restored';
    second.cascade.allowedTemplateIds = ['logistics.fuel-shortage'];

    const cycle = cloneTemplate();
    cycle.cascade.allowedTemplateIds = ['logistics.fuel-restored'];
    const cycleResult = validateEventTemplate(cycle, { ...validationContext, relatedTemplates: [second] });
    expect(cycleResult.issues).toContainEqual(
      expect.objectContaining({ code: 'CASCADE_CYCLE', path: '/cascade/allowedTemplateIds/0' }),
    );

    const exclusive = cloneTemplate();
    exclusive.cascade.allowedTemplateIds = ['logistics.fuel-restored'];
    const exclusiveResult = validateEventTemplate(exclusive, { ...validationContext, relatedTemplates: [second] });
    expect(exclusiveResult.issues).toContainEqual(
      expect.objectContaining({ code: 'MUTUAL_EXCLUSION_CONFLICT', path: '/cascade/allowedTemplateIds/0' }),
    );
  });

  it('запрещает участнику донесение без доступного источника наблюдения', () => {
    const value = cloneTemplate();
    value.observations[0].source = { kind: 'CONTROL', sourceId: 'control-only', sideId: 'blue' };
    expect(validateEventTemplate(value).issues).toContainEqual(
      expect.objectContaining({ code: 'OBSERVATION_SOURCE_UNAVAILABLE', path: '/observations/0/source/kind' }),
    );

    const report = cloneTemplate();
    report.reports[0].basedOnObservationId = 'missing-observation';
    expect(validateEventTemplate(report).issues).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_OBSERVATION', path: '/reports/0/basedOnObservationId' }),
    );
  });

  it('не допускает изменения целей и оценки обучаемого', () => {
    const value = { ...cloneTemplate(), effects: [{ type: 'assessment.set', learnerId: 'learner-1', score: 100 }] };
    expect(validateEventTemplate(value).issues).toContainEqual(
      expect.objectContaining({ code: 'TRAINING_DATA_PROTECTED', path: '/effects/0/type' }),
    );
  });

  it('возвращает блокирующие русские ошибки с JSON path', () => {
    const value = { ...cloneTemplate(), unexpected: true };
    const result = validateEventTemplate(value);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'ADDITIONAL_PROPERTY', path: '/unexpected', severity: 'ERROR' }),
    );
    for (const issue of result.issues) {
      expect(issue.path.startsWith('/')).toBe(true);
      expect(issue.message).toMatch(/[А-Яа-яЁё]/);
      expect(['ERROR', 'WARNING', 'INFO']).toContain(issue.severity);
    }
  });
});
