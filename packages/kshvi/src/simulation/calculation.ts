import { createHash } from 'node:crypto';
import { canonicalJson } from '../events/canonical';
import { validateAssumptionPassport, type AssumptionPassport } from '../model/assumptions';
import { aggregateEpisode, type EpisodeInput } from './aggregate';
import { chooseStochasticOutcome, type StochasticOutcome, type StoredRandomKey } from './stochastic';
import type { RandomKey } from '../events/random';

export const CALCULATION_MODES = ['MANUAL', 'DETERMINISTIC', 'STOCHASTIC', 'HYBRID'] as const;
export type CalculationMode = typeof CALCULATION_MODES[number];
export type CalculationState = 'CALCULATED' | 'APPROVED' | 'APPLIED' | 'REQUIRES_REVIEW' | 'SUPERSEDED';
export type CalculateOptions = {
  id: string;
  mode: CalculationMode;
  reason: string;
  createdAt: string;
  inputSnapshot: unknown;
  inputs: Record<string, unknown> & { episode?: EpisodeInput };
  requiredInputs: readonly string[];
  units: Record<string, string>;
  modelVersion: string;
  profileVersions: Record<string, string>;
  modelPassport: AssumptionPassport;
  stochastic?: { key: RandomKey; outcomes: readonly StochasticOutcome[] };
  hybridReviewParameters?: readonly string[];
  manual?: { author: string; reason: string; result: unknown };
};
export type Calculation = Readonly<{
  id: string;
  state: CalculationState;
  mode: CalculationMode;
  reason: string;
  createdAt: string;
  createdBy: string | null;
  inputSnapshot: unknown;
  inputHash: string;
  inputs: Record<string, unknown>;
  units: Record<string, string>;
  unknown: readonly string[];
  modelVersion: string;
  profileVersions: Record<string, string>;
  modelPassport: AssumptionPassport;
  randomKeys: readonly StoredRandomKey[];
  intermediateResults: Record<string, unknown>;
  warnings: readonly string[];
  result: unknown;
  reviewParameters: readonly string[];
  approvedBy: string | null;
  appliedEventIds: readonly string[];
  supersedes: string | null;
  hybridReview?: Readonly<{ reviewedBy: string; reviewedParameters: Readonly<Record<string, unknown>> }>;
}>;

function episodeOf(options: CalculateOptions): EpisodeInput {
  if (!options.inputs.episode) throw new Error('Для расчёта эпизода нужны полные входы episode');
  return options.inputs.episode;
}
function assertMetadata(options: CalculateOptions): void {
  if (!options.id.trim() || !options.reason.trim()) throw new Error('Расчёт требует идентификатор и причину');
  if (!Number.isFinite(Date.parse(options.createdAt))) throw new Error('Нужно корректное время создания расчёта');
  if (!options.modelVersion.trim()) throw new Error('Нужна версия модели расчёта');
  const issues = validateAssumptionPassport(options.modelPassport);
  if (issues.length) throw new Error(`Паспорт модели не принят: ${issues.join('; ')}`);
}

export function calculate(options: CalculateOptions): Calculation {
  assertMetadata(options);
  const unknown = options.requiredInputs.filter(name => options.inputs[name] === null || options.inputs[name] === undefined);
  let result: unknown = null;
  let intermediateResults: Record<string, unknown> = {};
  let randomKeys: readonly StoredRandomKey[] = [];
  const warnings: string[] = unknown.map(name => `Обязательный вход ${name} неизвестен; расчёт требует рассмотрения`);
  let state: CalculationState = unknown.length ? 'REQUIRES_REVIEW' : 'CALCULATED';
  const reviewParameters = [...(options.hybridReviewParameters ?? [])];

  if (!unknown.length) {
    if (options.mode === 'MANUAL') {
      if (!options.manual?.author.trim() || !options.manual.reason.trim()) throw new Error('Ручной расчёт требует автора и основание');
      result = structuredClone(options.manual.result);
    } else {
      let episodeResult: ReturnType<typeof aggregateEpisode>;
      if (options.mode === 'STOCHASTIC') {
        if (!options.stochastic) throw new Error('Стохастический расчёт требует ключ и распределение');
        const selected = chooseStochasticOutcome(options.stochastic.outcomes, options.stochastic.key);
        randomKeys = [selected.randomKey];
        episodeResult = aggregateEpisode(episodeOf(options), selected.outcome.effects);
        intermediateResults = { ...episodeResult.intermediate, selectedOutcomeId: selected.outcome.id };
      } else {
        episodeResult = aggregateEpisode(episodeOf(options));
        intermediateResults = { ...episodeResult.intermediate };
      }
      result = episodeResult.result;
      if (options.mode === 'HYBRID') {
        if (reviewParameters.length === 0) throw new Error('Гибридный расчёт требует перечень параметров рассмотрения');
        state = 'REQUIRES_REVIEW';
        warnings.push(`Требуется рассмотрение параметров: ${reviewParameters.join(', ')}`);
      }
    }
  }

  return Object.freeze({
    id: options.id, state, mode: options.mode, reason: options.reason, createdAt: options.createdAt,
    createdBy: options.mode === 'MANUAL' ? options.manual?.author ?? null : null,
    inputSnapshot: structuredClone(options.inputSnapshot),
    inputHash: createHash('sha256').update(canonicalJson(options.inputSnapshot)).digest('hex'),
    inputs: structuredClone(options.inputs), units: { ...options.units }, unknown,
    modelVersion: options.modelVersion, profileVersions: { ...options.profileVersions }, modelPassport: structuredClone(options.modelPassport),
    randomKeys, intermediateResults, warnings, result, reviewParameters,
    approvedBy: null, appliedEventIds: Object.freeze([]), supersedes: null,
  });
}

export function approveCalculation(calculation: Calculation, input: {
  author: string;
  authorized: boolean;
  reviewedParameters?: Readonly<Record<string, unknown>>;
}): Calculation {
  if (!input.authorized) throw new Error('403: Утверждение расчёта недоступно');
  if (!input.author.trim()) throw new Error('Нужен автор утверждения');
  if (calculation.state === 'REQUIRES_REVIEW') {
    if (calculation.unknown.length > 0 || calculation.mode !== 'HYBRID') throw new Error('Сначала устраните неизвестные входы новым расчётом');
    const reviewed = input.reviewedParameters ?? {};
    const missing = calculation.reviewParameters.filter(name => !(name in reviewed));
    if (missing.length) throw new Error(`Не рассмотрены параметры: ${missing.join(', ')}`);
    return Object.freeze({ ...calculation, state: 'APPROVED' as const, approvedBy: input.author, hybridReview: { reviewedBy: input.author, reviewedParameters: structuredClone(reviewed) } });
  }
  if (calculation.state !== 'CALCULATED') throw new Error('Утвердить можно только расчёт в состоянии CALCULATED');
  return Object.freeze({ ...calculation, state: 'APPROVED' as const, approvedBy: input.author });
}

export function applyCalculation(calculation: Calculation, input: { authorized: boolean; appliedEventIds: readonly string[] }): Calculation {
  if (!input.authorized) throw new Error('403: Применение расчёта недоступно');
  if (calculation.state !== 'APPROVED') throw new Error('Применить можно только расчёт в состоянии APPROVED');
  if (input.appliedEventIds.length === 0 || input.appliedEventIds.some(id => !id.trim())) throw new Error('Применение требует идентификаторы созданных событий');
  return Object.freeze({ ...calculation, state: 'APPLIED' as const, appliedEventIds: Object.freeze([...input.appliedEventIds]) });
}
