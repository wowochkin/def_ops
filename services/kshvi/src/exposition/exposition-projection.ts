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

const FORBIDDEN_MAP_KEYS = new Set([
  'serviceintent', 'hiddenrationale', 'officialassessments', 'officialassessment', 'sourcearchive',
  'journal', 'checkpoints', 'seed', 'rng', 'rngstate', 'hidden truth', 'hiddentruth', 'secret',
  'secrets', 'private', 'internal', 'presenter', 'servicedata', 'classification',
]);

function forbiddenMapKey(key: string): boolean {
  const normalized = key.replace(/[-_\s]/g, '').toLowerCase();
  return key === '__proto__' || key === 'prototype' || key === 'constructor'
    || FORBIDDEN_MAP_KEYS.has(normalized)
    || normalized.includes('serviceintent')
    || normalized.includes('hiddenrationale')
    || normalized.includes('officialassessment')
    || normalized.includes('secret');
}

/** Проектор получает публичную геометрию, но не неизвестные вложенные служебные объекты. */
export function publicMapValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicMapValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !forbiddenMapKey(key))
      .map(([key, item]) => [key, publicMapValue(item)]));
  }
  return value;
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
  const enabled = new Set(session.program.layers);
  const layers = audienceLayers(policy, projector.allowedLayers).filter(layer => enabled.has(layer));
  const map: Record<string, unknown> = {};
  const fields: Readonly<Partial<Record<AudienceLayer, string>>> = {
    weather: 'weather', terrain: 'terrain', logistics: 'logistics', 'modern-symbols': 'modernSymbols', forces: 'forces', routes: 'routes',
  };
  for (const layer of layers) {
    const target = fields[layer]!;
    const source = layer === 'modern-symbols' ? 'modernSymbols' : layer;
    if (session.map[source] !== undefined) map[target] = publicMapValue(session.map[source]);
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
