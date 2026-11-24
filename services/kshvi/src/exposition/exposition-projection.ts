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
  handoffGeneration: number;
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

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function coordinates(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.map(coordinates).filter(item => item !== undefined);
  return undefined;
}
function geometry(value: unknown): unknown {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (!['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon'].includes(String(candidate.type))) return undefined;
  const points = coordinates(candidate.coordinates);
  return points === undefined ? undefined : { type: candidate.type, coordinates: points };
}
function feature(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { type?: unknown; id?: unknown; properties?: unknown; geometry?: unknown };
  if (candidate.type !== 'Feature') return undefined;
  const source = candidate.properties && typeof candidate.properties === 'object' ? candidate.properties : {};
  const properties: Record<string, unknown> = {};
  for (const key of ['name', 'kind', 'side', 'label'] as const) {
    const item = (source as Record<string, unknown>)[key];
    if (typeof item === 'string') properties[key] = item;
  }
  const shape = geometry(candidate.geometry);
  if (shape === undefined) return undefined;
  return {
    type: 'Feature',
    ...(typeof candidate.id === 'string' || typeof candidate.id === 'number' ? { id: candidate.id } : {}),
    properties,
    geometry: shape,
  };
}
function geojson(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { type?: unknown; features?: unknown };
  if (candidate.type !== 'FeatureCollection' || !Array.isArray(candidate.features)) return undefined;
  return {
    type: 'FeatureCollection',
    features: candidate.features.map(feature).filter(item => item !== undefined),
  };
}
function symbols(value: unknown): unknown {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as { id?: unknown; label?: unknown; side?: unknown; position?: unknown };
    if (typeof candidate.id !== 'string' || typeof candidate.label !== 'string') return [];
    const position = Array.isArray(candidate.position) && candidate.position.length === 2
      && candidate.position.every(part => typeof part === 'number' && Number.isFinite(part))
      ? [...candidate.position] : undefined;
    return [{
      id: candidate.id,
      label: candidate.label,
      ...(typeof candidate.side === 'string' ? { side: candidate.side } : {}),
      ...(position ? { position } : {}),
    }];
  });
}

/** Единственная схема публикации: неизвестные поля не имеют audience-представления. */
export function publicMapValue(layer: AudienceLayer, value: unknown): unknown {
  if (layer === 'modern-symbols') return symbols(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as { summary?: unknown; geojson?: unknown };
  const result: Record<string, unknown> = {};
  const summary = text(candidate.summary);
  if (summary !== undefined) result.summary = summary;
  if (layer !== 'weather') {
    const data = geojson(candidate.geojson);
    if (data !== undefined) result.geojson = data;
  }
  return Object.keys(result).length ? result : undefined;
}

export function projectAudienceMap(
  source: Readonly<Record<string, unknown>>,
  layers: readonly AudienceLayer[],
): AudienceMap {
  const map: Record<string, unknown> = {};
  const fields: Readonly<Partial<Record<AudienceLayer, string>>> = {
    weather: 'weather', terrain: 'terrain', logistics: 'logistics', 'modern-symbols': 'modernSymbols', forces: 'forces', routes: 'routes',
  };
  for (const layer of layers) {
    const target = fields[layer]!;
    const sourceField = layer === 'modern-symbols' ? 'modernSymbols' : layer;
    const value = publicMapValue(layer, source[sourceField]);
    if (value !== undefined) map[target] = value;
  }
  return map;
}

export function projectExpositionForAudience(input: Readonly<{
  session: ExpositionSession;
  policy: AudiencePolicy;
  projector: ProjectorProfile;
  presenterDecisionId?: string;
  handoffGeneration?: number;
}>): AudienceProjection {
  const { session, projector } = input;
  if (session.purpose !== 'EXPOSITION' || session.label !== 'Экспозиция') throw new Error('Проектор принимает только экспозиционный сеанс');
  if (projector.kind !== 'AUDIENCE_PROJECTOR') throw new Error('Требуется отдельный проекторный профиль аудитории');
  const policy = createAudiencePolicy(input.policy);
  const enabled = new Set(session.program.layers);
  const layers = audienceLayers(policy, projector.allowedLayers).filter(layer => enabled.has(layer));
  const publicDecision = input.presenterDecisionId && policy.publicDecisionIds.includes(input.presenterDecisionId)
    ? session.program.frames.find(frame => frame.decision?.id === input.presenterDecisionId)?.decision
    : undefined;
  return {
    sessionId: session.sessionId,
    branchId: session.branchId,
    handoffGeneration: input.handoffGeneration ?? 0,
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
        ? structuredClone(session.program.explanations.filter(explanation => explanation.audience && policy.publicExplanationIds.includes(explanation.id)))
        : [],
      branches: session.program.branches.map(branch => ({ id: branch.id, title: branch.title, chapterIds: [...branch.chapterIds] })),
    },
    map: projectAudienceMap(session.map, layers),
    planFact: policy.showPlanFact ? structuredClone(session.program.planFact) : [],
    decision: publicDecision ? { id: publicDecision.id, summary: publicDecision.summary } : null,
  };
}
