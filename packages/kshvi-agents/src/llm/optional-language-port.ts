export type LanguageFactValue = string | number | boolean | null;

export type GuardedLanguageRequest = Readonly<{
  kind: 'DOCUMENT' | 'ROLE_DIALOGUE' | 'EXPLANATION' | 'LEADER_REPORT';
  assignmentId: string;
  projectionHash: string;
  instruction: string;
  facts: Readonly<Record<string, LanguageFactValue>>;
}>;

export type LanguageClaim = Readonly<{
  factId: string;
  value: LanguageFactValue;
}>;

export type OptionalLanguageResponse = Readonly<{
  text: string;
  claims: readonly LanguageClaim[];
  model?: string;
}>;

export type OptionalLanguagePort = Readonly<{
  formulate(request: GuardedLanguageRequest): Promise<OptionalLanguageResponse>;
}>;
