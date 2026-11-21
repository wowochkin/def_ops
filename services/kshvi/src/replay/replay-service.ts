import {
  assertPerspectiveAccess,
  perspectiveLabel,
} from '../../../../packages/kshvi/src/replay/perspective';
import { replayClockAt } from '../../../../packages/kshvi/src/replay/replay-clock';
import {
  replayStateHash,
  restoreAt,
  type ReplayActor,
  type ReplayArchive,
  type ReplayEvent,
  type ReplayFrame,
  type ReplayPanel,
  type ReplayPerspective,
  type ReplayState,
} from '../../../../packages/kshvi/src/replay/replay-engine';

export type ReplayParticipantFrame = {
  participantId: string;
  branchId: string;
  sequence: number;
  policyRevision: number;
  allowedEventIds: readonly string[];
  events: readonly ReplayEvent[];
  state: ReplayState;
};
export type ProjectReplayInput = {
  archive: ReplayArchive;
  cursor: number;
  participantId: string;
  participantFrames: readonly ReplayParticipantFrame[];
  actor: ReplayActor;
  perspective: ReplayPerspective;
};
export type ProjectedReplayFrame = Omit<ReplayFrame, 'perspective' | 'source' | 'label' | 'panels'> & {
  perspective: ReplayPerspective;
  source: 'TRUTH' | 'RECORDED_PARTICIPANT_PROJECTION';
  label: string;
  panels: Record<string, ReplayPanel>;
  policyRevision?: number;
};

function participantPanels(state: ReplayState, sequence: number): Record<string, ReplayPanel> {
  return Object.fromEntries(Object.entries(state.domains).map(([domain, value]) => [domain, {
    sequence, source: 'PARTICIPANT' as const, value: structuredClone(value),
  }]));
}

export class ReplayService {
  project(input: ProjectReplayInput): ProjectedReplayFrame {
    assertPerspectiveAccess(input.actor, input.perspective);
    if (input.perspective === 'TRUTH') {
      return restoreAt({ archive: input.archive, cursor: input.cursor });
    }
    const recorded = input.participantFrames
      .filter(frame => frame.participantId === input.participantId
        && frame.branchId === input.archive.branchId
        && frame.sequence <= input.cursor)
      .sort((left, right) => right.sequence - left.sequence)[0];
    if (!recorded) throw new Error('Сохранённая серверная проекция участника на этот момент отсутствует');
    const allowed = new Set(recorded.allowedEventIds);
    const events: ReplayEvent[] = recorded.events
      .filter(event => event.sequence <= input.cursor && allowed.has(event.eventId))
      .map(event => structuredClone(event));
    const state = structuredClone(recorded.state);
    return {
      archiveId: input.archive.archiveId,
      branchId: recorded.branchId,
      requestedSequence: input.cursor,
      sequence: recorded.sequence,
      snapshotId: null,
      appliedEventIds: [],
      state,
      stateHash: replayStateHash(state),
      identityClaimed: true,
      compatibility: 'REPRODUCIBLE',
      perspective: 'PARTICIPANT',
      source: 'RECORDED_PARTICIPANT_PROJECTION',
      label: perspectiveLabel('PARTICIPANT'),
      clock: replayClockAt(input.archive, input.cursor),
      panels: participantPanels(state, recorded.sequence),
      events,
      traces: [],
      policyRevision: recorded.policyRevision,
    };
  }
}
