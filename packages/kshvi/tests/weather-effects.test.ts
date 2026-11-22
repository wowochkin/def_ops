import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyWeatherEffects, validateWeatherEffectProfile, type WeatherEffectProfile } from '../src/environment/weather-effects';

const source = { kind: 'ASSUMPTION', note: 'Учебное допущение для парного теста', applicability: 'Дорога, колёсная и гусеничная техника' } as const;
const approvedProfile = {
  id: 'weather-test', version: 7, status: 'APPROVED', approvedBy: 'Методист теста',
  movementRequires: ['precipitation'], requiredTargets: ['movement'],
  rules: [
    { id: 'dry', target: 'movement', input: 'precipitation', unit: 'mm/h', range: [0, 50], condition: { min: 0, max: 5 }, factor: 0.85, movementClasses: ['FOOT', 'WHEELED', 'TRACKED'], outside: 'REQUIRES_REVIEW', source },
    { id: 'wet', target: 'movement', input: 'precipitation', unit: 'mm/h', range: [0, 50], condition: { min: 5, max: 50 }, factor: 0.45, movementClasses: ['FOOT', 'WHEELED', 'TRACKED'], outside: 'REQUIRES_REVIEW', source },
  ],
} as const;

const context = { movementClass: 'WHEELED', terrain: 'ROAD' } as const;

describe('профили погодного влияния', () => {
  it('не подставляет коэффициент 1 при обязательном пробеле', () => {
    const result = applyWeatherEffects({ precipitation: null, snowDepth: 0 }, { movementRequires: ['precipitation'], rules: [] });
    expect(result.status).toBe('REQUIRES_REVIEW');
    expect(result.unknown).toEqual(['precipitation']);
    expect(result.factors).toEqual({});
    expect(JSON.stringify(result)).not.toContain('"movement":1');
  });

  it('SIM-24: парный сценарий меняет только дождь и получает разную подвижность', () => {
    const dry = applyWeatherEffects({ precipitation: 0 }, approvedProfile, context);
    const wet = applyWeatherEffects({ precipitation: 20 }, approvedProfile, context);
    expect(dry.status).toBe('CALCULATED');
    expect(wet.status).toBe('CALCULATED');
    expect(dry.factors.movement).toBe(0.85);
    expect(wet.factors.movement).toBe(0.45);
    expect(wet.factors.movement).not.toBe(dry.factors.movement);
    expect(dry.profileVersion).toBe(7);
    expect(wet.explanation.join(' ')).toContain('wet');
    expect(applyWeatherEffects({ precipitation: 20 }, approvedProfile, context)).toEqual(wet);
  });

  it('возвращает REVIEW вне области применимости и без подходящего класса', () => {
    const outside = applyWeatherEffects({ precipitation: 51 }, approvedProfile, context);
    expect(outside.status).toBe('REQUIRES_REVIEW');
    expect(outside.outOfRange).toEqual(['precipitation']);
    expect(outside.factors).toEqual({});
    const wrongClass = applyWeatherEffects({ precipitation: 2 }, approvedProfile, { ...context, movementClass: 'COLUMN' });
    expect(wrongClass.status).toBe('REQUIRES_REVIEW');
    expect(wrongClass.factors).toEqual({});
  });

  it('до утверждения разрешает только явно названный режим без учёта влияния', () => {
    const draft = { ...approvedProfile, status: 'DRAFT' } as const;
    expect(applyWeatherEffects({ precipitation: 2 }, draft, context).status).toBe('REQUIRES_REVIEW');
    const without = applyWeatherEffects({ precipitation: null }, {
      ...draft,
      mode: 'WITHOUT_WEATHER_EFFECTS',
      assumptionPassport: { limitation: 'Погодное влияние не учитывается', approvedBy: 'Методист теста' },
    }, context);
    expect(without.status).toBe('WITHOUT_WEATHER_EFFECTS');
    expect(without.factors).toEqual({});
    expect(without.limitations).toContain('Погодное влияние не учитывается');
  });

  it('проверяет единицы, диапазоны, источники, классы и версию поставленного профиля', () => {
    expect(validateWeatherEffectProfile(approvedProfile)).toEqual([]);
    expect(validateWeatherEffectProfile({ ...approvedProfile, rules: [{ ...approvedProfile.rules[0], unit: '' }] })).toContain('rule dry: нужна единица измерения');
    expect(validateWeatherEffectProfile({ ...approvedProfile, rules: [{ ...approvedProfile.rules[0], source: null }] } as unknown as WeatherEffectProfile)).toContain('rule dry: нужен источник или учебное допущение');
    const stored = JSON.parse(readFileSync(new URL('../data/profiles/weather-effects.json', import.meta.url), 'utf8')) as WeatherEffectProfile;
    expect(validateWeatherEffectProfile(stored)).toEqual([]);
    expect(stored.weatherEffectProfileVersion).toBe(1);
    const result = applyWeatherEffects({ precipitation: 12, visibility: 500, soilTemperature: -5 }, stored, context);
    expect(result.status).toBe('CALCULATED');
    expect(result.factors.movement).not.toBe(1);
  });

  it('не рассчитывает по формально APPROVED, но невалидному профилю', () => {
    const missingApproval = applyWeatherEffects({ precipitation: 2 }, { ...approvedProfile, id: '', approvedBy: '' }, context);
    expect(missingApproval.status).toBe('REQUIRES_REVIEW');
    expect(missingApproval.unknown).toContain('profile:invalid');
    expect(missingApproval.factors).toEqual({});
    const brokenRule = applyWeatherEffects({ precipitation: 2 }, {
      ...approvedProfile,
      rules: [{ ...approvedProfile.rules[0], factor: Number.NaN }],
    }, context);
    expect(brokenRule.status).toBe('REQUIRES_REVIEW');
    expect(brokenRule.unknown).toContain('profile:invalid');
  });
});
