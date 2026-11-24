export type AssumptionSource = Readonly<
  | { kind: 'SOURCE'; citation: string; applicability: string }
  | { kind: 'ASSUMPTION'; note: string; applicability: string }
>;
export type AssumptionPassport = Readonly<{
  purpose: string;
  limitations: readonly string[];
  source: AssumptionSource | null;
  knownErrors: readonly string[];
  examples: readonly Readonly<{ input: unknown; expected: unknown }>[];
  approvedBy: string;
  version: number;
}>;

export function validateAssumptionPassport(passport: AssumptionPassport): string[] {
  const issues: string[] = [];
  if (!passport.purpose.trim()) issues.push('Нужно назначение модели');
  if (passport.limitations.length === 0) issues.push('Нужны ограничения применимости');
  if (!passport.source) issues.push('Нужен источник или учебное допущение');
  if (passport.source?.kind === 'SOURCE' && (!passport.source.citation.trim() || !passport.source.applicability.trim())) issues.push('Источник и область применимости обязательны');
  if (passport.source?.kind === 'ASSUMPTION' && (!passport.source.note.trim() || !passport.source.applicability.trim())) issues.push('Допущение и область применимости обязательны');
  if (passport.examples.length === 0) issues.push('Нужен проверочный пример');
  if (!passport.approvedBy.trim()) issues.push('Нужно методическое утверждение');
  if (!Number.isSafeInteger(passport.version) || passport.version < 1) issues.push('Нужна положительная версия модели');
  return issues;
}
