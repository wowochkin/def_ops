export type PlaybookRule = Readonly<{
  id?: string;
  when: string;
  command: string;
  mandatory?: boolean;
}>;
export type Playbook = Readonly<{
  id?: string;
  version?: number;
  rules: readonly PlaybookRule[];
  agent?: Readonly<{ allowedCommands: readonly string[] }>;
}>;
export type PlaybookCondition = Readonly<{ kind: string }>;
export type PlaybookResult =
  | Readonly<{ kind: 'COMMAND'; command: string; ruleId: string; playbookVersion: number }>
  | Readonly<{ kind: 'AGENT'; allowedCommands: readonly string[]; reason: 'NO_MANDATORY_RULE' }>
  | Readonly<{ kind: 'ESCALATE'; reason: 'NO_RULE' }>;

export function evaluatePlaybook(playbook: Playbook, condition: PlaybookCondition): PlaybookResult {
  if (!condition.kind.trim() || condition.kind === 'unknown') return { kind: 'ESCALATE', reason: 'NO_RULE' };
  const rule = playbook.rules.find(candidate => candidate.when === condition.kind);
  if (rule) return {
    kind: 'COMMAND', command: rule.command, ruleId: rule.id ?? `${playbook.id ?? 'playbook'}:${rule.when}`,
    playbookVersion: playbook.version ?? 1,
  };
  if (playbook.agent) return { kind: 'AGENT', allowedCommands: [...playbook.agent.allowedCommands], reason: 'NO_MANDATORY_RULE' };
  return { kind: 'ESCALATE', reason: 'NO_RULE' };
}

export function assignStageCalculationProfile<State>(
  current: Readonly<{ stageId: string; calculationProfileId: string; state: State }>,
  next: Readonly<{ stageId: string; calculationProfileId?: string }>,
): Readonly<{ stageId: string; calculationProfileId: string; state: State }> {
  if (!next.stageId.trim()) throw new Error('Нужен идентификатор нового этапа');
  if (!next.calculationProfileId?.trim()) throw new Error('Новому этапу нужен явно назначенный расчётный профиль');
  return Object.freeze({ stageId: next.stageId, calculationProfileId: next.calculationProfileId, state: structuredClone(current.state) });
}
