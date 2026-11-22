import { HttpError } from '@def-ops/service-kit';
import { validateWeatherDataset, validateWeatherScenario, type WeatherDataset, type WeatherState } from '@def-ops/core';
import {
  weatherAtOperational as resolveWeather,
  type AtlasMeta,
  type EnvironmentProvider,
  type EnvironmentSelection,
  type EnvironmentSnapshot,
  type OperationalWeather,
  type SnapshotAtlas,
  type SnapshotResource,
  type WeatherQuery,
} from '../../../../packages/kshvi/src/environment/provider';
import { canonicalJson } from '../../../../packages/kshvi/src/events/canonical';
import { EnvironmentSnapshotStore, emptyArtifact, prepareContent, type PreparedContent, type SnapshotDraft } from './snapshot-store';
import { readSnapshotTile } from './snapshot-tiles';

export type CartographyEnvironmentOptions = Readonly<{
  baseUrl: string;
  store: EnvironmentSnapshotStore;
  fetch?: typeof fetch;
  tenant?: string;
  requestId?: string;
}>;

const jsonHeaders = { 'content-type': 'application/json' } as const;
const glyphRanges = Array.from({ length: 256 }, (_, index) => `${index * 256}-${index * 256 + 255}`);

function fontStacks(style: unknown): string[] {
  const fonts = new Set<string>();
  const visit = (value: unknown, key = ''): void => {
    if (key === 'text-font' && typeof value === 'string') fonts.add(value);
    if (Array.isArray(value)) for (const child of value) visit(child, key);
    else if (value && typeof value === 'object') for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
  };
  visit(style);
  return [...fonts].sort();
}

export class CartographyEnvironmentProvider implements EnvironmentProvider {
  readonly #baseUrl: string;
  readonly #store: EnvironmentSnapshotStore;
  readonly #fetch: typeof fetch;
  readonly #headers: Record<string, string>;
  readonly #snapshots = new Map<string, Promise<EnvironmentSnapshot>>();

  constructor(options: CartographyEnvironmentOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, '');
    this.#store = options.store;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#headers = {
      ...(options.tenant ? { 'x-tenant-id': options.tenant } : {}),
      ...(options.requestId ? { 'x-request-id': options.requestId } : {}),
    };
  }

  async #request(pathname: string, init?: RequestInit): Promise<Response> {
    const response = await this.#fetch(/^https?:\/\//.test(pathname) ? pathname : `${this.#baseUrl}${pathname}`, {
      ...init,
      headers: { ...this.#headers, ...jsonHeaders, ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      const body = await response.text();
      let message = `Картография ответила ${response.status}`;
      try { message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? message; } catch { /* ответ не JSON */ }
      throw new HttpError(response.status, 'cartography_upstream', message);
    }
    return response;
  }

  async #json<T>(pathname: string, init?: RequestInit): Promise<T> {
    return (await (await this.#request(pathname, init)).json()) as T;
  }

  listAtlases(): Promise<readonly AtlasMeta[]> {
    return this.#json<AtlasMeta[]>('/atlas');
  }

  async getAtlas(id: string): Promise<AtlasMeta> {
    const atlas = (await this.listAtlases()).find(value => value.id === id);
    if (!atlas) throw new HttpError(404, 'atlas_not_found', 'Набор карты не найден');
    return atlas;
  }

  async coverage(id: string, bounds: readonly [number, number, number, number]): Promise<Readonly<{ covered: boolean; reason: string | null }>> {
    const atlas = await this.getAtlas(id);
    const covered = bounds[0] >= atlas.bounds[0] && bounds[1] >= atlas.bounds[1] && bounds[2] <= atlas.bounds[2] && bounds[3] <= atlas.bounds[3];
    return { covered, reason: covered ? null : 'Выбранная область выходит за покрытие атласа' };
  }

  elevations(id: string, points: readonly (readonly [number, number])[]): Promise<unknown> {
    return this.#json(`/atlas/${encodeURIComponent(id)}/elevations`, { method: 'POST', body: JSON.stringify({ points }) });
  }

  weatherDataset(id: string): Promise<WeatherDataset> {
    return this.#json<WeatherDataset>(`/environment/weather/${encodeURIComponent(id)}`);
  }

  async #snapshotResources(style: unknown): Promise<{ contents: PreparedContent[]; resources: SnapshotResource[] }> {
    const contents: PreparedContent[] = [];
    const resources: SnapshotResource[] = [];
    const source = style && typeof style === 'object' && !Array.isArray(style) ? style as Record<string, unknown> : {};
    const add = async (logicalPath: SnapshotResource['path'], sourceUrl: string): Promise<void> => {
      const url = new URL(sourceUrl, `${this.#baseUrl}/`);
      if (url.origin !== new URL(this.#baseUrl).origin || !['http:', 'https:'].includes(url.protocol)) {
        throw new HttpError(422, 'environment_resource_origin', 'Ресурс стиля должен принадлежать серверу картографии');
      }
      const bytes = Buffer.from(await (await this.#request(url.href)).arrayBuffer());
      const prepared = prepareContent(bytes, '.bin');
      contents.push(prepared.content);
      resources.push({ path: logicalPath, artifact: prepared.artifact });
    };
    if (typeof source.glyphs === 'string') {
      const stacks = fontStacks(style);
      if (!stacks.length) throw new HttpError(422, 'environment_glyphs_incomplete', 'В стиле есть glyphs, но не определены text-font');
      for (const stack of stacks) for (const range of glyphRanges) {
        const url = source.glyphs.replace('{fontstack}', encodeURIComponent(stack)).replace('{range}', range);
        await add(`glyphs/${stack}/${range}.pbf`, url);
      }
    }
    if (typeof source.sprite === 'string') {
      for (const suffix of ['.json', '.png', '@2x.json', '@2x.png']) {
        const url = new URL(source.sprite, `${this.#baseUrl}/`);
        url.pathname = `${url.pathname}${suffix}`;
        await add(`sprites/ohm${suffix}` as SnapshotResource['path'], url.href);
      }
    }
    return { contents, resources };
  }

  #snapshotStyle(style: unknown, atlasId: string): unknown {
    const sourcePrefixes = [
      `${this.#baseUrl}/atlas/${atlasId}/tiles`,
      `/api/cartography/atlas/${atlasId}/tiles`,
      `/cartography/atlas/${atlasId}/tiles`,
    ];
    const target = `/kshvi/environment/snapshots/{snapshotId}/atlas/${atlasId}/tiles`;
    const rewrite = (value: unknown, key = ''): unknown => {
      if (typeof value === 'string') {
        if (key === 'glyphs') return '/kshvi/environment/snapshots/{snapshotId}/resources/glyphs/{fontstack}/{range}.pbf';
        if (key === 'sprite') return '/kshvi/environment/snapshots/{snapshotId}/resources/sprites/ohm';
        let result = value;
        for (const prefix of sourcePrefixes) result = result.split(prefix).join(target);
        return result;
      }
      if (Array.isArray(value)) return value.map(child => rewrite(child, key));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, rewrite(child, childKey)]));
      return value;
    };
    return rewrite(style);
  }

  async snapshot(selection: EnvironmentSelection): Promise<EnvironmentSnapshot> {
    const key = canonicalJson(selection);
    const existing = this.#snapshots.get(key);
    if (existing) return existing;
    const pending = this.#createSnapshot(selection);
    this.#snapshots.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      this.#snapshots.delete(key);
      throw error;
    }
  }

  async #createSnapshot(selection: EnvironmentSelection): Promise<EnvironmentSnapshot> {
    if (!selection.atlases.length) throw new HttpError(422, 'environment_atlas_required', 'Выберите хотя бы один набор карты');
    const contents: PreparedContent[] = [];
    const limitations: string[] = [];
    const atlases: SnapshotAtlas[] = [];
    const resources: SnapshotResource[] = [];
    for (const chosen of selection.atlases) {
      const meta = await this.getAtlas(chosen.id);
      const coverage = await this.coverage(chosen.id, selection.region.bounds);
      if (!coverage.covered) throw new HttpError(422, 'environment_coverage_missing', coverage.reason ?? 'Область не покрыта атласом');
      const exportRights = chosen.exportRights ?? 'ALLOWED';
      const license = chosen.license ?? meta.license ?? 'Лицензия указана в атрибуции источника';
      const sourceStyle = await this.#json(`/atlas/${encodeURIComponent(chosen.id)}/style`);
      const captured = await this.#snapshotResources(sourceStyle);
      contents.push(...captured.contents);
      for (const resource of captured.resources) {
        const existing = resources.find(item => item.path === resource.path);
        if (existing && existing.artifact.sha256 !== resource.artifact.sha256) throw new HttpError(422, 'environment_resource_conflict', `Конфликт ресурса ${resource.path}`);
        if (!existing) resources.push(resource);
      }
      const style = prepareContent(canonicalJson(this.#snapshotStyle(sourceStyle, chosen.id)), '.json');
      contents.push(style.content);
      let exportArtifact = emptyArtifact();
      let elevationArtifact = emptyArtifact();
      if (exportRights === 'ALLOWED') {
        const exportBytes = Buffer.from(await (await this.#request(`/atlas/${encodeURIComponent(chosen.id)}/export`)).arrayBuffer());
        const exported = prepareContent(exportBytes, '.mbtiles');
        contents.push(exported.content);
        exportArtifact = exported.artifact;
        const elevationPoints = chosen.elevationPoints ?? [];
        const rawElevations = elevationPoints.length
          ? await this.elevations(chosen.id, elevationPoints)
          : { source: chosen.id, values: [] };
        const elevationDocument = {
          algorithmVersion: selection.elevation.algorithmVersion,
          adjustmentM: selection.elevation.adjustmentM,
          ...(applyElevationAdjustment(rawElevations, selection.elevation.adjustmentM) as Record<string, unknown>),
        };
        const elevations = prepareContent(canonicalJson(elevationDocument), '.json');
        contents.push(elevations.content);
        elevationArtifact = elevations.artifact;
      } else {
        limitations.push(`Атлас ${chosen.id}: лицензия разрешает только ссылку/стиль, автономный экспорт и высоты не включены`);
      }
      atlases.push({
        meta, id: meta.id, sha256: meta.sha256 ?? exportArtifact.sha256 ?? '', attribution: meta.attribution,
        license, exportRights, style: style.artifact, export: exportArtifact, elevations: elevationArtifact,
      });
    }

    let weatherDocument: unknown;
    let sourceId: string;
    let attribution: string;
    let license: string;
    if (selection.weather.mode === 'scenario') {
      const validatedScenario = validateWeatherScenario(selection.weather.scenario);
      weatherDocument = validatedScenario;
      sourceId = `scenario:${validatedScenario.seed}:${validatedScenario.start}`;
      attribution = 'Сценарная погода КШВИ';
      license = 'Сценарные данные учения';
    } else {
      const dataset = validateWeatherDataset(await this.#json(`/environment/weather/${encodeURIComponent(selection.weather.datasetId)}/export`));
      weatherDocument = dataset;
      sourceId = dataset.id;
      attribution = dataset.source.title;
      license = dataset.source.license;
    }
    const weather = prepareContent(canonicalJson(weatherDocument), '.json');
    contents.push(weather.content);
    const draft: SnapshotDraft = {
      schemaVersion: 1,
      region: selection.region,
      atlases,
      resources,
      weather: {
        mode: selection.weather.mode,
        contentRef: weather.artifact.contentRef,
        sourceId, attribution, license,
      },
      elevation: selection.elevation,
      algorithmVersions: selection.algorithmVersions,
      autonomy: limitations.length ? 'INCOMPLETE' : 'COMPLETE',
      limitations,
    };
    return this.#store.create(draft, contents);
  }

  loadSnapshot(id: string): Promise<EnvironmentSnapshot> {
    return this.#store.load(id);
  }

  async weatherAtOperational(snapshot: EnvironmentSnapshot, at: WeatherQuery): Promise<OperationalWeather> {
    if (!snapshot.weather.contentRef) return resolveWeather({ ...snapshot.weather }, at);
    const document = await this.#store.readJson<unknown>(snapshot.weather.contentRef, snapshot.id);
    const weather = snapshot.weather.mode === 'scenario'
      ? { ...snapshot.weather, scenario: validateWeatherScenario(document as Parameters<typeof validateWeatherScenario>[0]) }
      : { ...snapshot.weather, dataset: validateWeatherDataset(document) };
    return resolveWeather(weather, at);
  }

  async weatherAt(snapshot: EnvironmentSnapshot, at: WeatherQuery): Promise<WeatherState | null> {
    return (await this.weatherAtOperational(snapshot, at)).state;
  }

  snapshotTile(snapshot: EnvironmentSnapshot, atlasId: string, z: number, x: number, y: number) {
    return readSnapshotTile(this.#store, snapshot, atlasId, z, x, y);
  }

  async snapshotResource(snapshot: EnvironmentSnapshot, resourcePath: string): Promise<Buffer> {
    const resource = snapshot.resources.find(item => item.path === resourcePath);
    if (!resource?.artifact.contentRef) throw new HttpError(404, 'snapshot_content_not_found', 'Ресурс снимка не найден');
    return this.#store.read(resource.artifact.contentRef, snapshot.id);
  }

  async snapshotArtifact(snapshot: EnvironmentSnapshot, atlasId: string, kind: 'style' | 'export' | 'elevations'): Promise<Buffer | object> {
    const atlas = snapshot.atlases.find(value => value.id === atlasId);
    const ref = atlas?.[kind].contentRef;
    if (!atlas || !ref) throw new HttpError(404, 'snapshot_content_not_found', 'Содержимое снимка не найдено или запрещено лицензией');
    if (kind === 'export') return this.#store.read(ref, snapshot.id);
    const document = await this.#store.readJson<unknown>(ref, snapshot.id);
    if (kind === 'style') return JSON.parse(JSON.stringify(document).split('{snapshotId}').join(snapshot.id)) as object;
    return document as object;
  }
}

function applyElevationAdjustment(input: unknown, adjustmentM: number): unknown {
  if (!Number.isFinite(adjustmentM)) throw new HttpError(422, 'invalid_elevation_adjustment', 'Высотная поправка должна быть конечным числом');
  if (!input || typeof input !== 'object') throw new Error('Картография вернула некорректные высоты');
  const value = input as { values?: unknown };
  if (!Array.isArray(value.values)) throw new Error('Картография вернула некорректные высоты');
  return {
    ...input,
    values: value.values.map(item => {
      if (!item || typeof item !== 'object') throw new Error('Некорректная точка высоты');
      const point = item as Record<string, unknown>;
      return {
        ...point,
        elevationM: point.elevationM === null || point.elevationM === undefined ? null : Number(point.elevationM) + adjustmentM,
      };
    }),
  };
}

export function createSnapshot(provider: CartographyEnvironmentProvider, selection: EnvironmentSelection): Promise<EnvironmentSnapshot> {
  return provider.snapshot(selection);
}
