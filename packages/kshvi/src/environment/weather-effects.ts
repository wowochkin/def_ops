import type { AssumptionSource } from '../model/assumptions';

export type WeatherValueState = Readonly<Record<string, number | null | undefined>>;
export type WeatherEffectTarget = 'movement' | 'visibility' | 'condition';
export type WeatherMovementClass = 'FOOT' | 'WHEELED' | 'TRACKED' | 'UNIT' | 'COLUMN';

export type WeatherEffectRule = Readonly<{
  id: string;
  target: WeatherEffectTarget;
  input: string;
  unit: string;
  range: readonly [number, number];
  condition: Readonly<{ min: number; max: number }>;
  factor: number;
  movementClasses: readonly WeatherMovementClass[];
  outside: 'REQUIRES_REVIEW';
  source: AssumptionSource;
}>;

export type WeatherEffectProfile = Readonly<{
  id: string;
  version: number;
  weatherEffectProfileVersion?: number;
  status: 'APPROVED' | 'DRAFT';
  approvedBy?: string;
  movementRequires: readonly string[];
  requiredTargets: readonly WeatherEffectTarget[];
  rules: readonly WeatherEffectRule[];
  mode?: 'WITHOUT_WEATHER_EFFECTS';
  assumptionPassport?: Readonly<{ limitation: string; approvedBy: string }>;
}>;

export type WeatherEffectContext = Readonly<{
  movementClass: WeatherMovementClass;
  terrain: string;
}>;

export type EffectResult = Readonly<{
  status: 'CALCULATED' | 'REQUIRES_REVIEW' | 'WITHOUT_WEATHER_EFFECTS';
  unknown: readonly string[];
  outOfRange: readonly string[];
  factors: Readonly<Partial<Record<WeatherEffectTarget, number>>>;
  profileVersion: number | null;
  explanation: readonly string[];
  limitations: readonly string[];
}>;

type ProfileInput = Readonly<{
  id?: string;
  version?: number;
  weatherEffectProfileVersion?: number;
  status?: 'APPROVED' | 'DRAFT';
  approvedBy?: string;
  movementRequires: readonly string[];
  requiredTargets?: readonly WeatherEffectTarget[];
  rules: readonly WeatherEffectRule[];
  mode?: 'WITHOUT_WEATHER_EFFECTS';
  assumptionPassport?: Readonly<{ limitation: string; approvedBy: string }>;
}>;

const result = (value: Partial<EffectResult> & Pick<EffectResult, 'status'>): EffectResult => ({
  unknown: [], outOfRange: [], factors: {}, profileVersion: null, explanation: [], limitations: [], ...value,
});

export function validateWeatherEffectProfile(profile: ProfileInput): string[] {
  const issues: string[] = [];
  if (!profile.id?.trim()) issues.push('Нужен идентификатор профиля');
  if (!Number.isSafeInteger(profile.version) || (profile.version ?? 0) < 1) issues.push('Нужна положительная версия профиля');
  if (profile.status === 'APPROVED' && !profile.approvedBy?.trim()) issues.push('Нужно методическое утверждение профиля');
  if (profile.mode === 'WITHOUT_WEATHER_EFFECTS' && (!profile.assumptionPassport?.limitation.trim() || !profile.assumptionPassport.approvedBy.trim())) {
    issues.push('Режим без учёта погодного влияния требует записи в паспорте допущений');
  }
  for (const rule of profile.rules) {
    if (!rule.id.trim()) issues.push('Правилу нужен идентификатор');
    if (!rule.unit.trim()) issues.push(`rule ${rule.id}: нужна единица измерения`);
    if (!Array.isArray(rule.range) || rule.range.length !== 2 || !rule.range.every(Number.isFinite) || rule.range[0] >= rule.range[1]) {
      issues.push(`rule ${rule.id}: некорректный диапазон применимости`);
    }
    if (!Number.isFinite(rule.condition?.min) || !Number.isFinite(rule.condition?.max) || rule.condition.min >= rule.condition.max || rule.condition.min < rule.range[0] || rule.condition.max > rule.range[1]) {
      issues.push(`rule ${rule.id}: условие выходит за диапазон применимости`);
    }
    if (!Number.isFinite(rule.factor) || rule.factor <= 0) issues.push(`rule ${rule.id}: коэффициент должен быть положительным конечным числом`);
    if (!rule.movementClasses.length) issues.push(`rule ${rule.id}: нужен класс движения`);
    if (rule.outside !== 'REQUIRES_REVIEW') issues.push(`rule ${rule.id}: поведение вне области должно требовать проверки`);
    const source = rule.source;
    if (!source) issues.push(`rule ${rule.id}: нужен источник или учебное допущение`);
    else if (source.kind === 'SOURCE' && (!source.citation.trim() || !source.applicability.trim())) issues.push(`rule ${rule.id}: источник и область применимости обязательны`);
    else if (source.kind === 'ASSUMPTION' && (!source.note.trim() || !source.applicability.trim())) issues.push(`rule ${rule.id}: допущение и область применимости обязательны`);
  }
  return issues;
}

function contains(rule: WeatherEffectRule, value: number): boolean {
  return value >= rule.condition.min && (value < rule.condition.max || value === rule.condition.max && value === rule.range[1]);
}

/** Чистое преобразование погоды: отсутствующий вход никогда не становится нулём или коэффициентом 1. */
export function applyWeatherEffects(
  state: WeatherValueState,
  profile: ProfileInput,
  context: WeatherEffectContext = { movementClass: 'WHEELED', terrain: 'ROAD' },
): EffectResult {
  const profileVersion = profile.version ?? profile.weatherEffectProfileVersion ?? null;
  const requiredUnknown = profile.movementRequires.filter(key => state[key] === null || state[key] === undefined);
  if (requiredUnknown.length && profile.mode !== 'WITHOUT_WEATHER_EFFECTS') return result({ status: 'REQUIRES_REVIEW', unknown: requiredUnknown, profileVersion, explanation: ['Обязательные погодные показатели отсутствуют'] });
  if (profile.status !== 'APPROVED') {
    if (profile.mode === 'WITHOUT_WEATHER_EFFECTS' && profile.assumptionPassport?.limitation.trim() && profile.assumptionPassport.approvedBy.trim()) {
      return result({ status: 'WITHOUT_WEATHER_EFFECTS', profileVersion, limitations: [profile.assumptionPassport.limitation], explanation: ['Погодное влияние явно исключено паспортом допущений'] });
    }
    return result({ status: 'REQUIRES_REVIEW', unknown: ['profile:notApproved'], profileVersion, explanation: ['Профиль погодного влияния не утверждён'] });
  }

  const targets = profile.requiredTargets ?? ['movement'];
  const relevantRules = profile.rules.filter(rule => targets.includes(rule.target) && rule.movementClasses.includes(context.movementClass));
  const required = [...new Set([...profile.movementRequires, ...relevantRules.map(rule => rule.input)])];
  const unknown = required.filter(key => state[key] === null || state[key] === undefined);
  if (unknown.length) return result({ status: 'REQUIRES_REVIEW', unknown, profileVersion, explanation: ['Обязательные погодные показатели отсутствуют'] });

  const outOfRange = [...new Set(relevantRules.filter(rule => {
    const value = state[rule.input]!;
    return value < rule.range[0] || value > rule.range[1];
  }).map(rule => rule.input))];
  if (outOfRange.length) return result({ status: 'REQUIRES_REVIEW', outOfRange, profileVersion, explanation: ['Погодный показатель вне области применимости профиля'] });

  const factors: Partial<Record<WeatherEffectTarget, number>> = {};
  const explanation: string[] = [];
  for (const target of targets) {
    const candidates = relevantRules.filter(rule => rule.target === target);
    if (!candidates.length) return result({ status: 'REQUIRES_REVIEW', unknown: [`rule:${target}`], profileVersion, explanation: [`Нет правила ${target} для класса ${context.movementClass}`] });
    let product: number | null = null;
    for (const input of [...new Set(candidates.map(rule => rule.input))]) {
      const matching = candidates.filter(rule => rule.input === input && contains(rule, state[input]!));
      if (!matching.length) return result({ status: 'REQUIRES_REVIEW', unknown: [`rule:${target}`], profileVersion, explanation: [`Нет применимого правила ${target}`] });
      for (const rule of matching) {
        product = Number(((product ?? rule.factor) * (product === null ? 1 : rule.factor)).toFixed(12));
        explanation.push(`${rule.id}: ${input}=${state[input]} ${rule.unit} → ${target}=${rule.factor}`);
      }
    }
    if (product === null) return result({ status: 'REQUIRES_REVIEW', unknown: [`rule:${target}`], profileVersion });
    factors[target] = product;
  }
  return result({ status: 'CALCULATED', factors, profileVersion, explanation });
}
