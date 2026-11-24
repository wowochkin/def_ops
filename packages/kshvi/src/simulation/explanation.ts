import type { Calculation } from './calculation';

export function explainCalculation(calculation: Calculation) {
  const contributions = calculation.intermediateResults.numericContributions;
  const numeric = Array.isArray(contributions)
    ? contributions.filter((item): item is { name: string; value: number; direction: 'INCREASE' | 'DECREASE' } => Boolean(item && typeof item === 'object' && typeof (item as { value?: unknown }).value === 'number'))
    : [];
  const factors: { name: string; direction: 'INCREASE' | 'DECREASE' | 'CONTEXT'; value: number | null; note?: string }[] = numeric.map(item => ({ ...item }));
  if (!numeric.length) {
    if (calculation.intermediateResults.potentialBySide) factors.push({ name: 'potentialBySide', direction: 'CONTEXT', value: null, note: 'Сопоставление потенциалов не является вероятностью победы' });
    const transition = calculation.intermediateResults.resourceTransition as { deficit?: unknown } | undefined;
    if (typeof transition?.deficit === 'number' && transition.deficit > 0) {
      factors.push({ name: 'resourceDeficit', direction: 'DECREASE', value: null, note: 'Дефицит ограничивает исполнение; числовой вклад отдельно не вычисляется' });
    }
  }
  return {
    basis: calculation.reason,
    inputs: structuredClone(calculation.inputs),
    assumptions: structuredClone(calculation.modelPassport.source),
    versions: { model: calculation.modelVersion, profiles: { ...calculation.profileVersions } },
    factors,
    unknown: [...calculation.unknown],
    warnings: [...calculation.warnings],
    randomKeys: structuredClone(calculation.randomKeys),
    events: calculation.appliedEventIds.length
      ? calculation.appliedEventIds.map(eventId => ({ status: 'applied' as const, eventId }))
      : [{ status: 'draft' as const, calculationId: calculation.id }],
    approvedBy: calculation.approvedBy,
    supersedes: calculation.supersedes,
  };
}
