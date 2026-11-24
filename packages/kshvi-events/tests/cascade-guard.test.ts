import { describe, expect, it } from 'vitest';
import { guardCandidate } from '../src/scheduler/cascade-guard';
import { scheduleInterval } from '../src/scheduler/interval-scheduler';
import { blueNorthTarget, makeProfile, makeScheduleInput, makeState, makeTemplate } from './fixtures/autonomy';

function guardInput(template = makeTemplate(), state = makeState()) {
  return {
    template,
    parameters: { amount: 10 },
    target: blueNorthTarget,
    state,
    profile: makeProfile(),
    operationalSecond: 3600,
    cascade: { causeEventIds: [], depth: 0, events: 0 },
  };
}

describe('Каскадная и доменная защита', () => {
  it('соблюдает cooldown, повторы, этапный лимит и взаимоисключения', () => {
    const cooldownTemplate = makeTemplate({ limits: { ...makeTemplate().limits, cooldownSeconds: 3600 } });
    const occurrence = {
      eventId: 'old-event', templateId: cooldownTemplate.templateId, category: 'logistics' as const,
      stageId: 'stage-main', sideId: 'blue', areaId: 'area-north', operationalSecond: 1000,
      mutuallyExclusiveGroupIds: [], cascadeDepth: 0, causeEventIds: [],
    };
    expect(guardCandidate(guardInput(cooldownTemplate, makeState({ occurrences: [occurrence] }))).reasons).toContain('COOLDOWN');

    const once = makeTemplate({ limits: { ...makeTemplate().limits, maxOccurrences: 1, maxPerStage: 1 } });
    expect(guardCandidate(guardInput(once, makeState({ occurrences: [{ ...occurrence, operationalSecond: 0 }] }))).reasons).toEqual(expect.arrayContaining(['MAX_OCCURRENCES', 'MAX_PER_STAGE']));

    const exclusive = makeTemplate({ limits: { ...makeTemplate().limits, mutuallyExclusiveGroupIds: ['fuel-disruption'] } });
    const other = { ...occurrence, templateId: 'other-template', mutuallyExclusiveGroupIds: ['fuel-disruption'] };
    expect(guardCandidate(guardInput(exclusive, makeState({ occurrences: [other] }))).reasons).toContain('MUTUALLY_EXCLUDED');
  });

  it('проверяет географию, наблюдение и тяжесть', () => {
    const outside = { ...blueNorthTarget, areaId: 'area-south' };
    expect(guardCandidate({ ...guardInput(), target: outside }).reasons).toEqual(expect.arrayContaining(['AREA_NOT_APPLICABLE', 'ENVIRONMENT_COVERAGE_MISSING']));

    const noSource = makeState({ availableObservationSourceIds: [] });
    expect(guardCandidate(guardInput(makeTemplate(), noSource)).reasons).toContain('OBSERVATION_SOURCE_UNAVAILABLE');

    const lowSeverity = makeProfile('CUSTOM', { maxSeverityCost: 1 });
    expect(guardCandidate({ ...guardInput(), profile: lowSeverity }).reasons).toContain('SEVERITY_LIMIT');
  });

  it('запрещает разрыв причинности, превышение глубины и бюджета каскада', () => {
    const child = makeTemplate({ templateId: 'child' });
    const parent = makeTemplate({ templateId: 'parent', cascade: { allowedTemplateIds: ['child'], maxDepth: 1, maxEvents: 1 } });
    const base = { ...guardInput(child), parentTemplate: parent };
    expect(guardCandidate({ ...base, cascade: { causeEventIds: [], depth: 1, events: 0 } }).reasons).toContain('CAUSALITY_REQUIRED');
    expect(guardCandidate({ ...base, cascade: { causeEventIds: ['parent-event'], depth: 2, events: 0 } }).reasons).toContain('CASCADE_DEPTH_EXCEEDED');
    expect(guardCandidate({ ...base, cascade: { causeEventIds: ['parent-event'], depth: 1, events: 1 } }).reasons).toContain('CASCADE_BUDGET_EXCEEDED');
    expect(guardCandidate({ ...base, cascade: { causeEventIds: ['parent-event'], depth: 1, events: 0 } }).reasons).not.toContain('CASCADE_NOT_ALLOWED');

    const forbiddenParent = makeTemplate({ templateId: 'forbidden-parent', cascade: { allowedTemplateIds: [], maxDepth: 2, maxEvents: 2 } });
    expect(guardCandidate({ ...base, parentTemplate: forbiddenParent, cascade: { causeEventIds: ['parent-event'], depth: 1, events: 0 } }).reasons).toContain('CASCADE_NOT_ALLOWED');
  });

  it('не допускает отрицательный ресурс и изменение целей или оценки', () => {
    const poor = makeState({ resources: [{ resourceId: 'fuel', ownerSideId: 'blue', unit: 'L', onHand: 5 }] });
    expect(guardCandidate(guardInput(makeTemplate(), poor)).reasons).toContain('RESOURCE_INSUFFICIENT');

    const protectedTemplate = makeTemplate({
      effects: [{
        type: 'catalog.effect', operation: 'updateTask', target: { domain: 'training.assessment', ref: 'trainee-score' },
        mechanism: 'FORBIDDEN_TEST', reason: 'FORBIDDEN_TEST',
      }],
    });
    expect(guardCandidate(guardInput(protectedTemplate)).reasons).toContain('PROTECTED_TRAINING_DATA');
  });

  it('исчерпание лимита не вызывает бесконечных повторных попыток', () => {
    const profile = makeProfile('CUSTOM', {
      attemptsPerOperationalHour: 60,
      maxEventsPerInterval: 2,
      maxEventsPerStage: 100,
      severityBudgetPerStage: 100,
    });
    const result = scheduleInterval(makeScheduleInput({ profile }));
    expect(result.attempts).toBeGreaterThan(2);
    expect(result.createdEvents).toHaveLength(2);
    expect(result.traces).toHaveLength(result.attempts);
    expect(result.traces.slice(2).every(trace => trace.rejection === 'EVENT_INTERVAL_LIMIT')).toBe(true);
  });

  it('после применения ресурсный баланс остаётся неотрицательным', () => {
    const result = scheduleInterval(makeScheduleInput({ profile: makeProfile('CUSTOM', { manualApprovalShare: 0 }) }));
    expect(result.createdEvents.length).toBeGreaterThan(0);
    expect(result.state.resources.every(resource => resource.onHand >= 0)).toBe(true);
    expect(result.state.stageSeverityCost).toBeGreaterThan(0);
  });
});
