import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACTION_TAXONOMY,
  MODEL_ENTITY_NAMES,
  knownQuantity,
  operationalAt,
  unknownQuantity,
  validateExerciseAxes,
  versionRef,
  wallClockAt,
} from '../src/index';

describe('карточка КШВИ', () => {
  it('не выводит масштаб учения из масштаба карты или числа ступеней', () => {
    expect(validateExerciseAxes({ scale: 'strategic', mapZoom: 8, trainedLevels: 1 })).toEqual([]);
    expect(validateExerciseAxes({ scale: 'tactical', mapZoom: 8, trainedLevels: 9 })).toEqual([]);
  });

  it('проверяет только собственные значения независимых осей', () => {
    expect(validateExerciseAxes({ scale: 'unknown', mapZoom: 8, trainedLevels: 1 })).toContain('Неизвестный масштаб задач');
    expect(validateExerciseAxes({ scale: 'strategic', mapZoom: 8, trainedLevels: 0 })).toContain('Нужна хотя бы одна обучаемая ступень');
    expect(validateExerciseAxes({ scale: 'custom', mapZoom: 8, trainedLevels: 1 })).toContain('Для пользовательского масштаба нужен профиль');
  });
});

describe('версии, величины и время', () => {
  it('запрещает ссылку на текущую редакцию', () => {
    expect(() => versionRef({ id: 'model-1', revision: 'current' })).toThrow('версионная ссылка');
    expect(() => versionRef({ id: 'model-1', revision: 1 })).toThrow('версионная ссылка');
    expect(() => versionRef({ id: 'model-1', revision: 1, sha256: 'bad' })).toThrow('SHA-256');
  });

  it('создаёт неизменяемую ссылку с редакцией и SHA-256', () => {
    const sha256 = 'a'.repeat(64);
    expect(versionRef({ id: 'model-1', revision: 3, sha256 })).toEqual({ id: 'model-1', revision: 3, sha256 });
  });

  it('не подменяет неизвестное нулём или единицей', () => {
    expect(unknownQuantity('kg')).toEqual({ value: null, unit: 'kg', status: 'UNKNOWN' });
    expect(knownQuantity(0, 'kg')).toEqual({ value: 0, unit: 'kg', status: 'KNOWN' });
    expect(() => knownQuantity(Number.NaN, 'kg')).toThrow('конечным числом');
  });

  it('различает астрономическое и оперативное время', () => {
    expect(wallClockAt('2026-11-21T22:01:00+03:00')).toBe('2026-11-21T19:01:00.000Z');
    expect(operationalAt('2026-11-21T22:01:00+03:00', 'Europe/Moscow')).toEqual({
      normalizedAt: '2026-11-21T19:01:00.000Z',
      originalAt: '2026-11-21T22:01:00+03:00',
      zone: 'Europe/Moscow',
      offset: '+03:00',
    });
  });
});

describe('каноническая доменная модель', () => {
  it('содержит все основные сущности спецификации', () => {
    expect(MODEL_ENTITY_NAMES).toHaveLength(37);
    expect(MODEL_ENTITY_NAMES).toContain('Exercise');
    expect(MODEL_ENTITY_NAMES).toContain('ElectronicIntermediaryAssignment');
    expect(MODEL_ENTITY_NAMES).toContain('ExpositionProgram');
    const schema = JSON.parse(readFileSync(new URL('../schemas/model.schema.json', import.meta.url), 'utf8')) as { definitions: Record<string, unknown> };
    for (const name of MODEL_ENTITY_NAMES) expect(schema.definitions[name], name).toBeDefined();
  });

  it('поддерживает требуемые классы сценарных действий и пользовательские переходы', () => {
    const categories = DEFAULT_ACTION_TAXONOMY.categories.map(category => category.id);
    expect(categories).toEqual(expect.arrayContaining(['combat', 'special', 'forceManeuver', 'fireManeuver', 'resourceManeuver', 'support', 'strategicDeployment', 'deterrence', 'mobilization', 'information', 'reserve', 'interaction', 'custom']));
    expect(DEFAULT_ACTION_TAXONOMY.version).toBeGreaterThan(0);
  });
});
