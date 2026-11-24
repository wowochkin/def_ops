export type StopState = { status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABORTED'; reason?: string };
export type StopMode = { kind: 'PAUSE' | 'RESUME' | 'ABORT'; reason?: string };

export function applyStopMode(state: StopState, mode: StopMode): StopState {
  if (state.status === 'ABORTED') throw new Error('ABORTED сохраняет журнал и не возобновляется обычной командой');
  if (mode.kind === 'ABORT') return { status: 'ABORTED', reason: mode.reason };
  if (mode.kind === 'PAUSE') return { ...state, status: 'PAUSED' };
  return { ...state, status: 'ACTIVE' };
}
