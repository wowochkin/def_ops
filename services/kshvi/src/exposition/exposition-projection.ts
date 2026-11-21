import {
  audienceLayers,
  createAudiencePolicy,
  type AudienceLayer,
  type AudiencePolicy,
} from '../../../../packages/kshvi/src/exposition/audience-policy';
import type {
  ExpositionPlayback,
  ExpositionSession,
} from '../../../../packages/kshvi/src/exposition/exposition-session';

export type ProjectorProfile = Readonly<{
  id: string;
  kind: 'AUDIENCE_PROJECTOR';
  allowedLayers: readonly AudienceLayer[];
}>;

export type AudienceMap = Readonly<{
  weather?: unknown;
  terrain?: unknown;
  logistics?: unknown;
  modernSymbols?: unknown;
  forces?: unknown;
  routes?: unknown;
}>;

export type AudienceProjection = Readonly<{
  sessionId: string;
  branchId: string;
  purpose: 'EXPOSITION';
  label: 'Экспозиция';
  source: 'ARCHIVE' | 'AUTONOMOUS';
  playback: ExpositionPlayback;
  projectorProfile: Readonly<{ id: string; kind: 'AUDIENCE_PROJECTOR' }>;
  program: Readonly<{
    id: string;
    title: string;
    chapters: ExpositionSession['program']['chapters'];
    frames: readonly Readonly<{ id: string; atMs: number; title: string; caption: string }>[];
    cameraRoute: ExpositionSession['program']['cameraRoute'];
    layers: readonly AudienceLayer[];
    tempo: number;
    pauseMs: number;
    captions: ExpositionSession['program']['captions'];
    explanations: ExpositionSession['program']['explanations'];
    branches: readonly Readonly<{ id: string; title: string; chapterIds: readonly string[] }>[];
  }>;
  map: AudienceMap;
  planFact: ExpositionSession['program']['planFact'];
  decision: Readonly<{ id: string; summary: string }> | null;
}>;

export function createProjectorProfile(input: Readonly<{
  id: string;
  allowedLayers: readonly AudienceLayer[];
  authorities?: readonly string[];
}>): ProjectorProfile {
  if (!input.id.trim()) throw new Error('Для проекторного профиля нужен идентификатор');
  if (input.authorities?.length) throw new Error('Проекторный профиль не принимает привилегии ведущего или истины');
  return { id: input.id, kind: 'AUDIENCE_PROJECTOR', allowedLayers: [...new Set(input.allowedLayers)] };
}

export function projectExpositionForAudience(input: Readonly<{
  session: ExpositionSession;
  policy: AudiencePolicy;
  projector: ProjectorProfile;
  presenterDecisionId?: string;
}>): AudienceProjection {
  const { session, projector } = input;
  if (session.purpose !== 'EXPOSITION' || session.label !== 'Экспозиция') throw new Error('Проектор принимает только экспозиционный сеанс');
  if (projector.kind !== 'AUDIENCE_PROJECTOR') throw new Error('Требуется отдельный проекторный профиль аудитории');
  const policy = createAudiencePolicy(input.policy);
  const layers = audienceLayers(policy, projector.allowedLayers);
  const map: Record<string, unknown> = {};
  const fields: Readonly<Partial<Record<AudienceLayer, string>>> = {
    weather: 'weather', terrain: 'terrain', logistics: 'logistics', 'modern-symbols': 'modernSymbols', forces: 'forces', routes: 'routes',
  };
  for (const layer of layers) {
    const target = fields[layer]!;
    const source = layer === 'modern-symbols' ? 'modernSymbols' : layer;
    if (session.map[source] !== undefined) map[target] = structuredClone(session.map[source]);
  }
  const publicDecision = input.presenterDecisionId && policy.publicDecisionIds.includes(input.presenterDecisionId)
    ? session.program.frames.find(frame => frame.decision?.id === input.presenterDecisionId)?.decision
    : undefined;
  return {
    sessionId: session.sessionId,
    branchId: session.branchId,
    purpose: 'EXPOSITION',
    label: 'Экспозиция',
    source: session.source,
    playback: { ...session.playback },
    projectorProfile: { id: projector.id, kind: 'AUDIENCE_PROJECTOR' },
    program: {
      id: session.program.id,
      title: session.program.title,
      chapters: structuredClone(session.program.chapters),
      frames: session.program.frames.map(frame => ({ id: frame.id, atMs: frame.atMs, title: frame.title, caption: frame.caption })),
      cameraRoute: structuredClone(session.program.cameraRoute),
      layers: [...layers],
      tempo: session.program.tempo,
      pauseMs: session.program.pauseMs,
      captions: structuredClone(session.program.captions.filter(caption => policy.publicCaptionIds.includes(caption.id))),
      explanations: policy.showExplanations
        ? structuredClone(session.program.explanations.filter(explanation => explanation.audience))
        : [],
      branches: session.program.branches.map(branch => ({ id: branch.id, title: branch.title, chapterIds: [...branch.chapterIds] })),
    },
    map,
    planFact: policy.showPlanFact ? structuredClone(session.program.planFact) : [],
    decision: publicDecision ? { id: publicDecision.id, summary: publicDecision.summary } : null,
  };
}
