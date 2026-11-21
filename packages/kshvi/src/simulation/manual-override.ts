export type CalculationReference = Readonly<{ id: string; state: string; result: unknown }>;

export function overrideCalculation<Original extends CalculationReference>(original: Original, input: {
  id: string;
  author: string;
  reason: string;
  result: unknown;
  createdAt: string;
}) {
  if (!input.author.trim()) throw new Error('Ручное решение требует автора');
  if (!input.reason.trim()) throw new Error('Ручное решение требует основание');
  if (!input.id.trim()) throw new Error('Ручное решение требует новый идентификатор');
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error('Нужно время ручного решения');
  if (original.state === 'SUPERSEDED') throw new Error('Заменённый расчёт нельзя заменить повторно без новой исходной записи');
  const source = structuredClone(original);
  const supersededCalculation = { ...structuredClone(original), state: 'SUPERSEDED' as const } as Omit<Original, 'state'> & { state: 'SUPERSEDED' };
  return {
    ...source,
    id: input.id,
    state: 'CALCULATED' as const,
    mode: 'MANUAL' as const,
    reason: input.reason,
    createdAt: input.createdAt,
    createdBy: input.author,
    result: structuredClone(input.result),
    supersedes: original.id,
    originalResult: structuredClone(original.result),
    supersededCalculation,
    evaluationEffect: 'UNCHANGED' as const,
    manualAuthor: input.author,
    manualReason: input.reason,
    approvedBy: null,
    appliedEventIds: [] as string[],
    randomKeys: [] as const,
    intermediateResults: {},
    warnings: [] as string[],
  };
}
