export async function appendCommittedCommand<Input, Result>(store: {
  appendCommand(input: Input): Promise<Result>;
}, input: Input, hooks: { afterCommit?: (result: Result) => void | Promise<void> } = {}): Promise<Result> {
  const result = await store.appendCommand(input);
  await hooks.afterCommit?.(result);
  return result;
}

export type ConnectionRecoveryResult<Event, Snapshot> = {
  outage: { disconnectedAt: string; reconnectedAt: string; durationMs: number };
  policyRevision: number;
  scopeKey: string;
} & ({
  kind: 'EVENTS';
  fromSequence: number;
  events: Event[];
} | {
  kind: 'SNAPSHOT';
  reason: 'POLICY_CHANGED' | 'SEQUENCE_GAP';
  snapshot: Snapshot;
});

export async function recoverConnection<Event, Snapshot>(input: {
  lastSequence: number;
  projectionRevision: number;
  disconnectedAt: string;
  reconnectedAt: string;
}, state: { minAvailableSequence: number }, ports: {
  reauthorize: () => Promise<{ policyRevision: number; scopeKey: string }>;
  clearCache: () => void | Promise<void>;
  loadEvents: (fromSequence: number, scopeKey: string) => Promise<Event[]>;
  loadSnapshot: (fromSequence: number, scopeKey: string) => Promise<Snapshot>;
}): Promise<ConnectionRecoveryResult<Event, Snapshot>> {
  const rights = await ports.reauthorize();
  await ports.clearCache();
  const outage = {
    disconnectedAt: input.disconnectedAt,
    reconnectedAt: input.reconnectedAt,
    durationMs: Math.max(0, Date.parse(input.reconnectedAt) - Date.parse(input.disconnectedAt)),
  };
  const common = { outage, policyRevision: rights.policyRevision, scopeKey: rights.scopeKey };
  const reason = rights.policyRevision !== input.projectionRevision
    ? 'POLICY_CHANGED' as const
    : state.minAvailableSequence > input.lastSequence + 1 ? 'SEQUENCE_GAP' as const : null;
  if (reason) return { ...common, kind: 'SNAPSHOT', reason, snapshot: await ports.loadSnapshot(input.lastSequence + 1, rights.scopeKey) };
  const fromSequence = input.lastSequence + 1;
  return { ...common, kind: 'EVENTS', fromSequence, events: await ports.loadEvents(fromSequence, rights.scopeKey) };
}
