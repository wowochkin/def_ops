export type ChainDecision = 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED';
export type DualChainStateName = 'IN_REVIEW' | 'CONFLICT' | 'APPROVED' | 'CHANGES_REQUESTED';

export type DualChainState = Readonly<{
  command: ChainDecision;
  service: ChainDecision;
  state?: DualChainStateName;
  finalApprover?: string;
  positions?: Readonly<{ command: string; service: string }>;
  resolution?: Readonly<{ actor: string; decision: 'APPROVED' | 'CHANGES_REQUESTED'; comment: string }>;
}>;

export type DualChainDecision = Readonly<{
  actor: string;
  branch?: 'command' | 'service';
  decision: 'APPROVED' | 'CHANGES_REQUESTED';
  comment?: string;
}>;

function derivedState(command: ChainDecision, service: ChainDecision): DualChainStateName {
  if ((command === 'APPROVED' && service === 'CHANGES_REQUESTED') || (command === 'CHANGES_REQUESTED' && service === 'APPROVED')) return 'CONFLICT';
  if (command === 'APPROVED' && service === 'APPROVED') return 'APPROVED';
  if (command === 'CHANGES_REQUESTED' && service === 'CHANGES_REQUESTED') return 'CHANGES_REQUESTED';
  return 'IN_REVIEW';
}

export function advanceApproval(state: DualChainState, decision: DualChainDecision): DualChainState {
  const finalApprover = state.finalApprover ?? 'designatedAuthority';
  const command = state.command;
  const service = state.service;
  const conflict = derivedState(command, service) === 'CONFLICT' || state.state === 'CONFLICT';
  if (conflict) return { ...state, command, service, state: 'CONFLICT', finalApprover };
  if (!decision.branch) throw new Error('Для решения нужно указать командную или функциональную ветвь');
  if (decision.decision === 'CHANGES_REQUESTED' && !decision.comment?.trim()) throw new Error('Замечание ветви обязательно');
  const positions = {
    command: decision.branch === 'command' ? decision.comment ?? '' : state.positions?.command ?? '',
    service: decision.branch === 'service' ? decision.comment ?? '' : state.positions?.service ?? '',
  };
  const nextCommand = decision.branch === 'command' ? decision.decision : command;
  const nextService = decision.branch === 'service' ? decision.decision : service;
  return {
    command: nextCommand,
    service: nextService,
    state: derivedState(nextCommand, nextService),
    finalApprover,
    positions,
  };
}

export function resolveDualConflict(
  state: DualChainState,
  decision: Readonly<{ actor: string; decision: 'APPROVED' | 'CHANGES_REQUESTED'; comment: string }>,
): DualChainState {
  const finalApprover = state.finalApprover ?? 'designatedAuthority';
  if (state.state !== 'CONFLICT' && derivedState(state.command, state.service) !== 'CONFLICT') throw new Error('Разрешение применяется только при конфликте ветвей');
  if (decision.actor !== finalApprover) throw new Error('Разрешение разногласия вне полномочия назначенной инстанции');
  if (!decision.comment.trim()) throw new Error('Разрешение разногласия требует обоснования');
  return {
    ...state,
    state: decision.decision === 'APPROVED' ? 'APPROVED' : 'CHANGES_REQUESTED',
    finalApprover,
    resolution: { ...decision },
  };
}
