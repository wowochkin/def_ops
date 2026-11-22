import { HttpError } from '@def-ops/service-kit';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { emptyWorld } from '../../../../packages/kshvi/src/model/world';
import { REPLAY_DOMAINS, restoreAt, type ReplayArchive, type ReplayEvent, type ReplayState } from '../../../../packages/kshvi/src/replay/replay-engine';
import { ReplayService, type ReplayParticipantFrame, type ProjectedReplayFrame } from '../replay/replay-service';
import { DebriefService } from '../assessment/debrief-service';
import { REQUIRED_DEBRIEF_SECTIONS } from '../../../../packages/kshvi/src/assessment/debrief';
import { approveAssessment, draftAssessment, type AssessmentSheet } from '../../../../packages/kshvi/src/assessment/assessment-sheet';
import { createArchiveManifest, type ArchiveBundle } from '../../../../packages/kshvi/src/archive/archive-manifest';
import { verifyArchive } from '../archive/integrity-check';
import { serializeArchive } from '../archive/archive-exporter';
import { createAudiencePolicy } from '../../../../packages/kshvi/src/exposition/audience-policy';
import { createExpositionProgram } from '../../../../packages/kshvi/src/exposition/exposition-program';
import { startArchiveShow, type ExpositionSession, type OfficialExpositionArchive } from '../../../../packages/kshvi/src/exposition/exposition-session';
import { createProjectorProfile, projectExpositionForAudience, type AudienceProjection } from '../exposition/exposition-projection';
import type { ParticipantContext } from '../auth/authorize';
import type { ExerciseCard, ExerciseSession, ExerciseStore, SessionCommand } from '../store/exercise-store';

export type SessionActor = Pick<ParticipantContext, 'userId' | 'organizationId' | 'activeRole' | 'sideId' | 'authorities'>;
export type SessionProjection = Readonly<{
  perspective: 'PARTICIPANT' | 'TRUTH';
  session: ExerciseSession;
  domains: Record<string, unknown>;
  reference: unknown;
}>;
export type ReplayFrameDto = Readonly<{
  sequence: number;
  maxSequence: number;
  operationalAt: string;
  wallClockAt: string;
  perspective: 'PARTICIPANT' | 'TRUTH';
  source: ProjectedReplayFrame['source'];
  stateHash: string | null;
  domains: Record<string, unknown>;
  events: readonly { eventId: string; type: string; sequence: number }[];
}>;
export type ArchiveRecord = Readonly<{
  archiveId: string;
  exerciseId: string;
  sessionId: string;
  manifestSha256: string;
  mode: 'AUTONOMOUS' | 'LIMITED_RESEARCH';
  missing: readonly string[];
}>;
export type ArchivePackage = Readonly<{ manifest: ArchiveBundle['manifest']; files: Record<string, string> }>;
export type ExpositionRecord = Readonly<{
  purpose: 'EXPOSITION';
  archive: ArchiveRecord;
  session: ExpositionSession;
  projection: AudienceProjection;
}>;

type SessionRecord = {
  organizationId: string;
  exerciseId: string;
  sessionId: string;
  archive: ReplayArchive;
  participantFrames: ReplayParticipantFrame[];
  reference: unknown;
  intent: string;
  card: ExerciseCard;
  assessment?: AssessmentSheet;
  assessmentKey?: string;
};
type StoredArchive = { record: ArchiveRecord; bundle: ArchiveBundle; organizationId: string };
type CompletedCommand = { request: string; session: ExerciseSession };

const initialDomains = (): Record<string, unknown> => Object.fromEntries(REPLAY_DOMAINS.map(domain => [domain,
  domain === 'EventFeed' ? { status: 'KNOWN', items: [] } : { status: 'UNKNOWN', reason: 'В сквозном сеансе данных домена не поступало' },
]));
const initialState = (): ReplayState => ({ domains: initialDomains(), appliedEventIds: [], eventCauses: {} });
const publicDomains = (state: ReplayState): Record<string, unknown> => structuredClone(state.domains);
const instant = (base: string, sequence: number): string => new Date(Date.parse(base) + sequence * 60_000).toISOString();
const payloadIntent = (card: ExerciseCard, revision: number): { intent: string; reference: unknown } => {
  const payload = card.revisions.find(item => item.revision === revision)?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { intent: 'Замысел не заполнен', reference: { status: 'UNKNOWN' } };
  const record = payload as Record<string, unknown>;
  return { intent: typeof record.intent === 'string' ? record.intent : 'Замысел не заполнен', reference: structuredClone(record) };
};

export class OfficialSessionService {
  private readonly records = new Map<string, SessionRecord>();
  private readonly commands = new Map<string, CompletedCommand>();
  private readonly archives = new Map<string, StoredArchive>();
  private readonly replay = new ReplayService();
  private readonly debrief = new DebriefService();
  private readonly now: () => Date;

  constructor(private readonly store: ExerciseStore, options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  private key(organizationId: string, sessionId: string): string { return `${organizationId}/${sessionId}`; }

  private async record(actor: Pick<SessionActor, 'organizationId' | 'sideId'>, exerciseId: string, sessionId: string): Promise<SessionRecord> {
    const key = this.key(actor.organizationId, sessionId);
    const existing = this.records.get(key);
    if (existing && existing.exerciseId === exerciseId) return existing;
    const [session, card, commandRecords] = await Promise.all([
      this.store.getSession(actor.organizationId, exerciseId, sessionId),
      this.store.get(actor.organizationId, exerciseId),
      this.store.listSessionCommands(actor.organizationId, exerciseId, sessionId),
    ]);
    if (!session || !card) throw new HttpError(404, 'not_found', 'Сеанс не найден');
    const revision = card.revisions.find(item => item.id === session.scenarioRevisionId) ?? card.revisions.find(item => item.revision === session.revision);
    if (!revision) throw new HttpError(409, 'revision_not_found', 'Редакция сценария сеанса не найдена');
    const scenario = payloadIntent(card, session.revision);
    const archiveId = `official-${sessionId}`;
    const branchId = `official-${sessionId}`;
    const state = initialState();
    const archive: ReplayArchive = {
      archiveId, organizationId: actor.organizationId, schemaVersion: 1, branchId,
      versions: {
        model: { id: revision.id, revision: revision.revision, sha256: revision.sha256 },
        environment: { id: 'environment-unset', revision: 1, sha256: hashCanonical({ status: 'UNKNOWN', reason: 'Снимок среды не связан с сеансом' }) },
        reducerVersion: 1,
      },
      snapshots: [{ snapshotId: `snapshot-${sessionId}-0`, branchId, sequence: 0, operationalAt: session.createdAt, wallClockAt: session.createdAt, reducerVersion: 1, state, stateHash: hashCanonical(state) }],
      events: [], controlPoints: [],
    };
    const record: SessionRecord = {
      organizationId: actor.organizationId, exerciseId, sessionId, archive, card,
      participantFrames: [{ participantId: 'server-projection', organizationId: actor.organizationId, sideId: actor.sideId ?? 'UNKNOWN', branchId, sequence: 0, policyRevision: 1, allowedEventIds: [], events: [], state: publicDomainsState(state) }],
      reference: scenario.reference, intent: scenario.intent,
    };
    for (const command of commandRecords) {
      const sequence = command.confirmedRevision;
      const payload = { command: command.command, state: command.state, confirmedRevision: command.confirmedRevision };
      const items = commandRecords.slice(0, sequence).map(item => ({ eventId: `${sessionId}-command-${item.confirmedRevision}`, type: 'time.change', payload: { command: item.command, state: item.state, confirmedRevision: item.confirmedRevision } }));
      const event: ReplayEvent = {
        eventId: `${sessionId}-command-${sequence}`, branchId, sequence, type: 'time.change',
        operationalAt: instant(session.createdAt, sequence), wallClockAt: command.createdAt, payload,
        changes: [{ domain: 'EventFeed', value: { status: 'KNOWN', items } }], reducerVersion: 1,
      };
      record.archive.events.push(event);
      const frame = restoreAt({ archive: record.archive, cursor: sequence });
      record.archive.controlPoints = [...(record.archive.controlPoints ?? []), { sequence, stateHash: frame.stateHash! }];
      record.participantFrames.push({
        participantId: 'server-projection', organizationId: actor.organizationId, sideId: actor.sideId ?? 'UNKNOWN', branchId, sequence, policyRevision: command.confirmedRevision,
        allowedEventIds: record.archive.events.map(item => item.eventId), events: structuredClone(record.archive.events), state: publicDomainsState(frame.state),
      });
    }
    this.records.set(key, record);
    return record;
  }

  async command(actor: SessionActor, exerciseId: string, sessionId: string, input: { command: SessionCommand; expectedRevision: number; idempotencyKey: string }): Promise<ExerciseSession> {
    if (!input.idempotencyKey?.trim()) throw new HttpError(422, 'invalid_command', 'Укажите идемпотентный ключ команды');
    const commandKey = `${this.key(actor.organizationId, sessionId)}/${input.idempotencyKey}`;
    const request = JSON.stringify({ exerciseId, command: input.command, expectedRevision: input.expectedRevision });
    const previous = this.commands.get(commandKey);
    if (previous) {
      if (previous.request !== request) throw new HttpError(409, 'idempotency_conflict', 'Ключ команды уже использован с другим содержимым');
      return structuredClone(previous.session);
    }
    const record = await this.record(actor, exerciseId, sessionId);
    const session = await this.store.transitionSession(actor, exerciseId, sessionId, { command: input.command, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey });
    if (session.confirmedRevision <= record.archive.events.length) {
      this.commands.set(commandKey, { request, session: structuredClone(session) });
      return session;
    }
    const sequence = record.archive.events.length + 1;
    const event: ReplayEvent = {
      eventId: `${sessionId}-command-${sequence}`, branchId: record.archive.branchId, sequence,
      type: 'time.change', operationalAt: instant(session.createdAt, sequence), wallClockAt: this.now().toISOString(),
      payload: { command: input.command, state: session.state, confirmedRevision: session.confirmedRevision },
      changes: [{ domain: 'EventFeed', value: { status: 'KNOWN', items: record.archive.events.map(item => ({ eventId: item.eventId, type: item.type, payload: item.payload })).concat({ eventId: `${sessionId}-command-${sequence}`, type: 'time.change', payload: { command: input.command, state: session.state, confirmedRevision: session.confirmedRevision } }) } }],
      reducerVersion: 1,
    };
    record.archive.events.push(event);
    const frame = restoreAt({ archive: record.archive, cursor: sequence });
    record.archive.controlPoints = [...(record.archive.controlPoints ?? []), { sequence, stateHash: frame.stateHash! }];
    record.participantFrames.push({
      participantId: 'server-projection', organizationId: actor.organizationId, sideId: actor.sideId ?? 'UNKNOWN', branchId: record.archive.branchId, sequence, policyRevision: session.confirmedRevision,
      allowedEventIds: record.archive.events.map(item => item.eventId), events: structuredClone(record.archive.events), state: publicDomainsState(frame.state),
    });
    this.commands.set(commandKey, { request, session: structuredClone(session) });
    return session;
  }

  async projection(actor: SessionActor, exerciseId: string, sessionId: string, perspective: 'PARTICIPANT' | 'TRUTH'): Promise<SessionProjection> {
    const [record, session] = await Promise.all([this.record(actor, exerciseId, sessionId), this.store.getSession(actor.organizationId, exerciseId, sessionId)]);
    if (!session) throw new HttpError(404, 'not_found', 'Сеанс не найден');
    const truth = perspective === 'TRUTH';
    const state = restoreAt({ archive: record.archive, cursor: record.archive.events.length }).state;
    return {
      perspective, session,
      domains: truth ? publicDomains(state) : publicDomains(record.participantFrames.at(-1)!.state),
      reference: truth ? structuredClone(record.reference) : { status: 'UNKNOWN', reason: 'Эталон доступен только служебной проекции' },
    };
  }

  async replayFrame(actor: SessionActor, exerciseId: string, sessionId: string, cursor: number, perspective: 'PARTICIPANT' | 'TRUTH'): Promise<ReplayFrameDto> {
    const record = await this.record(actor, exerciseId, sessionId);
    const participantFrames = record.participantFrames.map(frame => ({ ...frame, participantId: actor.userId }));
    const projected = this.replay.project({
      archive: record.archive, cursor, participantId: actor.userId, participantFrames,
      actor: { organizationId: actor.organizationId, userId: actor.userId, sideId: actor.sideId ?? undefined, role: actor.activeRole ?? '', authorities: actor.authorities }, perspective,
    });
    return {
      sequence: projected.sequence, maxSequence: record.archive.events.length,
      operationalAt: projected.clock.operationalAt, wallClockAt: projected.clock.wallClockAt,
      perspective: projected.perspective, source: projected.source, stateHash: projected.stateHash,
      domains: Object.fromEntries(Object.entries(projected.panels).map(([domain, panel]) => [domain, structuredClone(panel.value)])),
      events: projected.events.map(event => ({ eventId: event.eventId, type: event.type, sequence: event.sequence })),
    };
  }

  async buildDebrief(actor: SessionActor, exerciseId: string, sessionId: string, scope: 'GENERAL' | 'PRIVATE') {
    const record = await this.record(actor, exerciseId, sessionId);
    const sideId = actor.sideId ?? 'UNKNOWN';
    const allowedSideIds = scope === 'GENERAL' ? ['blue', 'red', 'UNKNOWN'] : [sideId];
    const materialSide = allowedSideIds[0];
    const audience = scope === 'GENERAL' ? 'GENERAL' : actor.userId;
    const built = this.debrief.build({
      scope, instanceId: sessionId, trainingQuestions: ['official-lifecycle'], audience, allowedSideIds,
      materials: REQUIRED_DEBRIEF_SECTIONS.map((section, index) => ({
        id: `${sessionId}-${section}`, section, instanceId: sessionId, sideId: materialSide,
        trainingQuestions: ['official-lifecycle'], audience: [audience],
        payload: section === 'TIMELINE'
          ? { status: 'KNOWN', events: record.archive.events.map(event => ({ eventId: event.eventId, sequence: event.sequence, type: event.type, payload: event.payload })) }
          : section === 'GOALS_STAGES' ? { status: 'KNOWN', intent: record.intent }
            : { status: 'UNKNOWN', reason: 'В журнале сеанса нет данных раздела', sourceSequence: index },
      })),
      referenceIntent: { text: record.intent }, deviations: [],
    });
    return { scope, revision: record.card.revisions.find(revision => revision.id === record.archive.versions.model.id)?.revision ?? 1, audience: [audience], referenceIntent: record.intent, package: built };
  }

  async approveDebriefAssessment(actor: SessionActor, exerciseId: string, sessionId: string, input: { finalAssessment: string; comment: string; idempotencyKey: string }): Promise<AssessmentSheet> {
    if (actor.activeRole !== 'LEADER' && actor.activeRole !== 'DIRECTOR') throw new HttpError(403, 'forbidden', 'Итоговую оценку подтверждает руководитель учения');
    if (!input.idempotencyKey?.trim()) throw new HttpError(422, 'invalid_assessment', 'Укажите идемпотентный ключ оценки');
    const record = await this.record(actor, exerciseId, sessionId);
    if (record.assessment) {
      if (record.assessmentKey !== input.idempotencyKey) throw new HttpError(409, 'assessment_exists', 'Итоговая оценка уже подтверждена');
      return structuredClone(record.assessment);
    }
    const session = await this.store.getSession(actor.organizationId, exerciseId, sessionId);
    if (session?.state !== 'COMPLETED') throw new HttpError(409, 'session_not_completed', 'Оценка подтверждается после завершения сеанса');
    const draft = draftAssessment({
      scope: 'COLLECTIVE', subjectId: sessionId, criteria: ['official-lifecycle'], scale: ['Зачёт', 'Зачёт с разбором', 'Незачёт'],
      observations: record.archive.events.map(event => ({ eventId: event.eventId, text: `${String(event.payload.command)} → ${String(event.payload.state)}` })),
      positiveFacts: [], negativeFacts: [], comment: input.comment,
      assessor: { id: actor.userId, role: actor.activeRole === 'DIRECTOR' ? 'LEADER' : actor.activeRole! },
    });
    record.assessment = approveAssessment(draft, {
      finalAssessment: input.finalAssessment, comment: input.comment,
      confirmedBy: { id: actor.userId, role: 'LEADER' }, confirmedAt: this.now().toISOString(),
    });
    record.assessmentKey = input.idempotencyKey;
    return structuredClone(record.assessment);
  }

  async createArchive(actor: SessionActor, exerciseId: string, sessionId: string): Promise<ArchiveRecord> {
    const record = await this.record(actor, exerciseId, sessionId);
    const session = await this.store.getSession(actor.organizationId, exerciseId, sessionId);
    if (!session) throw new HttpError(404, 'not_found', 'Сеанс не найден');
    if (session.state !== 'COMPLETED') throw new HttpError(409, 'session_not_completed', 'Архив создаётся после завершения официального сеанса');
    const existing = [...this.archives.values()].find(item => item.organizationId === actor.organizationId && item.record.exerciseId === exerciseId && item.record.sessionId === sessionId);
    if (existing) return structuredClone(existing.record);
    const archiveId = `archive-${sessionId}`;
    const initial = record.archive.snapshots[0];
    const final = restoreAt({ archive: record.archive, cursor: record.archive.events.length });
    const components = {
      'exercise.card': { data: JSON.stringify(record.card) },
      'scenario.revisions': { data: JSON.stringify(record.card.revisions) },
      'snapshots.initial': { data: JSON.stringify(initial) },
      'snapshots.final': { data: JSON.stringify(final) },
      'journal.events': { data: JSON.stringify(record.archive.events) },
      'replay.archive': { data: JSON.stringify(record.archive) },
      'replay.control-points': { data: JSON.stringify(record.archive.controlPoints ?? []) },
      'debriefs.materials': { data: JSON.stringify(await this.buildDebrief({ ...actor, activeRole: 'LEADER', authorities: ['TRUTH_READ'] }, exerciseId, sessionId, 'GENERAL')) },
      ...(record.assessment ? { 'assessments.sheets': { data: JSON.stringify([record.assessment]) } } : {}),
    };
    const bundle: ArchiveBundle = {
      manifest: createArchiveManifest({
        archiveId, kind: 'OFFICIAL', organizationId: actor.organizationId, createdAt: this.now().toISOString(), schemaVersion: 1,
        versions: record.archive.versions, components,
      }),
      files: Object.fromEntries(Object.entries(components).map(([id, component]) => {
        const paths: Record<string, string> = {
          'exercise.card': 'exercise/card.json', 'scenario.revisions': 'scenario/revisions.json', 'snapshots.initial': 'snapshots/initial.json',
          'snapshots.final': 'snapshots/final.json', 'journal.events': 'journal/events.json', 'replay.archive': 'replay/archive.json',
          'replay.control-points': 'replay/control-points.json', 'debriefs.materials': 'debriefs/materials.json',
          'assessments.sheets': 'assessments/sheets.json',
        };
        return [paths[id], new TextEncoder().encode(component.data)];
      })),
    };
    const verification = verifyArchive(bundle);
    if (verification.mode === 'REJECTED') throw new HttpError(409, 'archive_rejected', `Архив отклонён: ${verification.errors.join('; ')}`);
    const result: ArchiveRecord = {
      archiveId, exerciseId, sessionId, manifestSha256: bundle.manifest.manifestSha256,
      mode: verification.autonomous ? 'AUTONOMOUS' : 'LIMITED_RESEARCH', missing: verification.missing,
    };
    this.archives.set(archiveId, { record: result, bundle, organizationId: actor.organizationId });
    return structuredClone(result);
  }

  archivePackage(actor: SessionActor, archiveId: string): ArchivePackage {
    const stored = this.archives.get(archiveId);
    if (!stored || stored.organizationId !== actor.organizationId) throw new HttpError(404, 'not_found', 'Архив не найден');
    return JSON.parse(serializeArchive(stored.bundle)) as ArchivePackage;
  }

  async exposition(actor: SessionActor, archiveId: string): Promise<ExpositionRecord> {
    const stored = this.archives.get(archiveId);
    if (!stored || stored.organizationId !== actor.organizationId) throw new HttpError(404, 'not_found', 'Архив не найден');
    const record = await this.record(actor, stored.record.exerciseId, stored.record.sessionId);
    const world = emptyWorld(record.exerciseId);
    world.state.ScenarioState = { scenarioId: record.exerciseId, status: 'COMPLETED' };
    world.state.Time = { operationalAt: record.archive.events.at(-1)?.operationalAt ?? record.card.createdAt, wallClockAt: record.archive.events.at(-1)?.wallClockAt ?? record.card.createdAt };
    world.appliedEventIds = record.archive.events.map(event => event.eventId);
    world.eventCauses = Object.fromEntries(record.archive.events.map(event => [event.eventId, event.causeIds ?? []]));
    const sourceArchive: OfficialExpositionArchive = {
      archiveId, branchId: record.archive.branchId, manifestHash: stored.record.manifestSha256,
      journal: record.archive.events.map(event => ({ eventId: event.eventId, sequence: event.sequence, atMs: event.sequence * 1000, type: event.type, payload: structuredClone(event.payload), causeIds: event.causeIds })),
      checkpoints: [{ id: `checkpoint-${record.sessionId}-final`, atMs: record.archive.events.length * 1000, journalCursor: record.archive.events.length, world }],
      officialAssessments: record.assessment ? [structuredClone(record.assessment)] : [],
      map: {
        weather: record.archive.snapshots[0].state.domains.Weather,
        terrain: record.archive.snapshots[0].state.domains.Map,
        logistics: record.archive.snapshots[0].state.domains.Resources,
        modernSymbols: [],
      },
      demonstration: {
        scenarioId: record.exerciseId, initialWorld: world, catalog: { id: 'official-lifecycle', version: '1' }, systemSides: [],
        rules: { reducerVersion: 1, profileVersion: 'full-simulation-archive-lifecycle' }, events: [],
      },
    };
    const duration = Math.max(1000, record.archive.events.length * 1000);
    const program = createExpositionProgram({
      id: `program-${archiveId}`, title: `Показ: ${record.card.title}`,
      chapters: [{ id: 'chapter-official', title: 'Официальный журнал', startMs: 0, endMs: duration, frameIds: record.archive.events.map(event => `frame-${event.eventId}`), pauseAfterMs: 0 }],
      frames: record.archive.events.length ? record.archive.events.map(event => ({ id: `frame-${event.eventId}`, atMs: event.sequence * 1000, title: `Команда ${event.sequence}`, caption: String(event.payload.command) })) : [{ id: 'frame-initial', atMs: 0, title: 'Исходный снимок', caption: 'Событий не зафиксировано' }],
      cameraRoute: { keyframes: [{ id: 'camera-official', atMs: 0, center: [30, 50] as [number, number], zoom: 6, heading: 0 }] },
      layers: ['weather', 'terrain', 'logistics', 'modern-symbols'], tempo: 1, pauseMs: 0,
      captions: [{ id: 'caption-official', atMs: 0, text: `Официальный архив ${archiveId}` }], explanations: [], branches: [], allowedCheckpointIds: [],
      planFact: record.archive.events.map(event => ({ id: `plan-fact-${event.eventId}`, atMs: event.sequence * 1000, plan: record.intent, fact: `${String(event.payload.command)} → ${String(event.payload.state)}` })),
    });
    const session = startArchiveShow({ sourceArchive, program, sessionId: `exposition-${archiveId}`, branchId: `exposition-${archiveId}` });
    const projection = projectExpositionForAudience({
      session,
      policy: createAudiencePolicy({ id: `policy-${archiveId}`, allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols'], showPlanFact: true, showExplanations: false, publicCaptionIds: ['caption-official'], publicDecisionIds: [] }),
      projector: createProjectorProfile({ id: `projector-${archiveId}`, allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols'] }),
    });
    return { purpose: 'EXPOSITION', archive: stored.record, session, projection };
  }
}

function publicDomainsState(state: ReplayState): ReplayState {
  return { domains: publicDomains(state), appliedEventIds: [...state.appliedEventIds], eventCauses: structuredClone(state.eventCauses) };
}
