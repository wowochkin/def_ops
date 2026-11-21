export type Calculation<T> = Readonly<{
  id: string;
  type: 'model' | 'manual';
  outcome: T;
  reason: string;
  authorId: string;
  createdAt: string;
  sourceCalculationId?: string;
}>;

export function makeManualDecision<T, A extends object>(
  original: Calculation<T>,
  input: Readonly<{ id: string; outcome: T; reason: string; authorId: string; createdAt: string }>,
  assessment: A = {} as A,
): Readonly<{
  original: Calculation<T>;
  manual: Calculation<T>;
  comparison: Readonly<{ original: Calculation<T>; manual: Calculation<T> }>;
  assessment: A;
  assessmentPolicy: 'UNCHANGED_BY_MANUAL_INTERVENTION';
}> {
  if (!input.reason.trim() || !input.authorId.trim()) throw new Error('Ручное решение требует основание и автора');
  if (!input.id.trim() || input.id === original.id) throw new Error('Ручной расчёт требует новый идентификатор');
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error('Некорректное время ручного решения');
  const manual: Calculation<T> = { ...structuredClone(input), type: 'manual', sourceCalculationId: original.id };
  const originalCopy = structuredClone(original);
  return {
    original: originalCopy,
    manual,
    comparison: { original: originalCopy, manual },
    assessment: structuredClone(assessment),
    assessmentPolicy: 'UNCHANGED_BY_MANUAL_INTERVENTION',
  };
}
