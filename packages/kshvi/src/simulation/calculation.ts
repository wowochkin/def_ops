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
  sideId?: string;
  nodeId?: string;
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
  sideId: string | null;
  nodeId: string | null;
  inputSnapshot: unknown;
  inputHash: string;
  inputs: Record<string, unknown>;
  requiredInputs: readonly string[];
  units: Record<string, string>;
  unknown: readonly string[];
  modelVersion: string;
  profileVersions: Record<string, string>;
  modelPassport: AssumptionPassport;
  stochasticOutcomes: readonly StochasticOutcome[];
  randomKeys: readonly StoredRandomKey[];
  intermediateResults: Record<string, unknown>;
  warnings: readonly string[];
  result: unknown;
  reviewParameters: readonly string[];
  approvedBy: string | null;
  appliedEventIds: readonly string[];
  supersedes: string | null;
  recomputedFrom?: Readonly<{ calculationId: string; inputHash: string }>;
  hybridReview?: Readonly<{ reviewedBy: string; reviewedParameters: Readonly<Record<string, unknown>>; effectiveInputHash: string }>;
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
function inputHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
function optionsFromCalculation(calculation: Calculation, inputs: Record<string, unknown>, stochastic?: CalculateOptions['stochastic']): CalculateOptions {
  return {
    id: calculation.id, mode: calculation.mode, reason: calculation.reason, createdAt: calculation.createdAt,
    inputSnapshot: structuredClone(calculation.inputSnapshot), inputs, requiredInputs: calculation.requiredInputs,
    units: { ...calculation.units }, modelVersion: calculation.modelVersion, profileVersions: { ...calculation.profileVersions },
    modelPassport: structuredClone(calculation.modelPassport), sideId: calculation.sideId ?? undefined, nodeId: calculation.nodeId ?? undefined,
    hybridReviewParameters: calculation.reviewParameters, stochastic,
  };
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
    sideId: options.sideId ?? null, nodeId: options.nodeId ?? null,
    inputSnapshot: structuredClone(options.inputSnapshot), inputHash: inputHash(options.inputSnapshot),
    inputs: structuredClone(options.inputs), requiredInputs: Object.freeze([...options.requiredInputs]), units: { ...options.units }, unknown,
    modelVersion: options.modelVersion, profileVersions: { ...options.profileVersions }, modelPassport: structuredClone(options.modelPassport),
    stochasticOutcomes: Object.freeze(structuredClone(options.stochastic?.outcomes ?? [])),
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
    const mergedInputs = { ...structuredClone(calculation.inputs), ...structuredClone(reviewed) };
    const recomputed = calculate(optionsFromCalculation(calculation, mergedInputs));
    if (recomputed.unknown.length) throw new Error(`Рассмотренные входы оставили неизвестные значения: ${recomputed.unknown.join(', ')}`);
    return Object.freeze({
      ...calculation,
      inputs: recomputed.inputs,
      result: recomputed.result,
      intermediateResults: recomputed.intermediateResults,
      randomKeys: recomputed.randomKeys,
      warnings: recomputed.warnings,
      state: 'APPROVED' as const,
      approvedBy: input.author,
      recomputedFrom: { calculationId: calculation.id, inputHash: calculation.inputHash },
      hybridReview: { reviewedBy: input.author, reviewedParameters: structuredClone(reviewed), effectiveInputHash: inputHash(mergedInputs) },
    });
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

export function replayCalculation(calculation: Calculation): Calculation {
  if (calculation.mode !== 'STOCHASTIC') throw new Error('Повтор по сохранённому случайному ключу доступен только стохастическому расчёту');
  const stored = calculation.randomKeys[0];
  if (!stored || calculation.stochasticOutcomes.length === 0) throw new Error('Сохранённый случайный ключ или распределение отсутствует');
  const seedText = stored.seed.replace(/n$/, '');
  if (!/^\d+$/.test(seedText)) throw new Error('Сохранённый случайный ключ имеет некорректное зерно');
  const key: RandomKey = {
    seed: BigInt(seedText), exerciseId: stored.exerciseId, branchId: stored.branchId, purpose: stored.purpose,
    ordinal: stored.ordinal, algorithmVersion: stored.algorithmVersion,
  };
  const replay = calculate(optionsFromCalculation(calculation, structuredClone(calculation.inputs), { key, outcomes: structuredClone(calculation.stochasticOutcomes) }));
  const actual = replay.randomKeys[0];
  if (actual.digest !== stored.digest || actual.value !== stored.value) throw new Error('Сохранённый случайный ключ не совпадает с результатом генератора');
  if (replay.intermediateResults.selectedOutcomeId !== calculation.intermediateResults.selectedOutcomeId) throw new Error('Повтор по сохранённому ключу выбрал другой исход');
  return replay;
}
