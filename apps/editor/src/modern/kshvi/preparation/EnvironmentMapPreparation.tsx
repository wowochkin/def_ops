import { useEffect, useState, type FormEvent } from 'react';
import { validateWeatherScenario, type WeatherScenario } from '../../../../../../packages/core/src/weather';
import type { AtlasMeta, EnvironmentSnapshot } from '../../../../../../packages/kshvi/src/environment/provider';
import { approveInitialMap, createInitialSituationMap, type ApprovedInitialMap, type InitialSituationMap } from '../../../../../../packages/kshvi/src/scenario/initial-map';
import { hashCanonical } from '../../../../../../packages/kshvi/src/scenario/initial-map-hash';
import type { SymbolSet } from '../../../../../../packages/tactical-symbols/src/model';
import { isExerciseAccessLost, type ExerciseCard, type JsonValue, type KshviClient, type KshviHttpError } from '../kshvi-api';
import { InitialMapStep, type InitialMapSymbolOption } from './InitialMapStep';
import { initialMapAudiences } from './initial-map-audiences';
import { InitialMapCanvas } from './InitialMapCanvas';
import { DateTimeField } from '../../DateTimeField';

const numericFields = [
  ['temperature', 'Температура, °C'], ['humidity', 'Влажность, %'], ['pressure', 'Давление, hPa'],
  ['windSpeed', 'Ветер, m/s'], ['windDirection', 'Направление ветра, °'], ['cloud', 'Облачность, %'], ['precipitation', 'Осадки, mm/h'],
] as const;

function initialScenario(): WeatherScenario {
  return {
    version: 1, temperatureMode: 'manual', seed: 42, start: `${new Date().toISOString().slice(0, 10)}T00:00:00Z`,
    temperature: 15, humidity: 65, pressure: 1013, windSpeed: 4, windDirection: 270, cloud: 40,
    precipitation: 0, variability: 1, transitionHours: 3, durationHours: 24,
  };
}

function symbolOptions(set: SymbolSet): InitialMapSymbolOption[] {
  return set.symbols.map(symbol => ({
    id: symbol.id, version: symbol.version, sideId: 'UNKNOWN', status: symbol.status,
    sourceDocument: symbol.source.sourceDocument, sourcePage: symbol.source.page ?? 0,
    nameRu: symbol.name, purpose: symbol.purpose, objectType: symbol.objectType, kind: symbol.kind,
  }));
}

export function EnvironmentMapPreparation({ client, exerciseId, revision, authorId, truthRole, onRevision, onAccessLost, acceptsCardResponse }: {
  client: KshviClient;
  exerciseId: string;
  revision: number;
  authorId: string;
  truthRole: string;
  onRevision(card: ExerciseCard): void;
  onAccessLost?(cause: KshviHttpError): void;
  acceptsCardResponse?(): boolean;
}) {
  const [atlases, setAtlases] = useState<readonly AtlasMeta[]>([]);
  const [symbols, setSymbols] = useState<SymbolSet | null>(null);
  const [atlasId, setAtlasId] = useState('');
  const [scenario, setScenario] = useState<WeatherScenario>(initialScenario);
  const [snapshot, setSnapshot] = useState<EnvironmentSnapshot | null>(null);
  const [map, setMap] = useState<InitialSituationMap | null>(null);
  const [currentRevision, setCurrentRevision] = useState(revision);
  const [busy, setBusy] = useState(false);
  const [environmentLoading, setEnvironmentLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setEnvironmentLoading(true);
    setError('');
    void Promise.all([client.listEnvironmentAtlases(), client.symbolCatalog()]).then(([atlasList, catalog]) => {
      if (!active) return;
      setAtlases(atlasList);
      setAtlasId(current => current || atlasList[0]?.id || '');
      setSymbols(catalog.set);
      setEnvironmentLoading(false);
    }).catch(cause => {
      if (active) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить среду'); setEnvironmentLoading(false); }
    });
    return () => { active = false; };
  }, [client]);

  function patch<K extends keyof WeatherScenario>(key: K, value: WeatherScenario[K]): void {
    setScenario(current => ({ ...current, [key]: value }));
  }

  async function freeze(event: FormEvent): Promise<void> {
    event.preventDefault();
    const atlas = atlases.find(item => item.id === atlasId);
    if (!atlas || !symbols || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const weather = validateWeatherScenario(scenario);
      const card = await client.getCard(exerciseId).catch(cause => {
        if (isExerciseAccessLost(cause)) onAccessLost?.(cause);
        throw cause;
      });
      if (acceptsCardResponse?.() === false) return;
      if (card.payloadAccess !== 'FULL') {
        onRevision(card);
        return;
      }
      if (card.revision !== revision) {
        onRevision(card);
        throw new Error('Редакция изменилась. Проверьте актуальные данные и повторите выбор среды.');
      }
      const fixed = await client.createEnvironmentSnapshot({
        region: { name: atlas.name, bounds: atlas.bounds },
        atlases: [{ id: atlas.id, exportRights: 'ALLOWED', elevationPoints: [] }],
        weather: { mode: 'scenario', scenario: weather },
        elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 },
      });
      if (acceptsCardResponse?.() === false) return;
      const source = card.revisions.find(item => item.revision === card.revision);
      if (!source) throw new Error('Сервер не вернул текущую редакцию учения');
      const payload = source.payload && typeof source.payload === 'object' && !Array.isArray(source.payload)
        ? source.payload as Record<string, JsonValue> : {};
      const revised = await client.createRevision(exerciseId, {
        expectedRevision: card.revision,
        payload: { ...payload, environmentSnapshotId: fixed.id },
      });
      if (acceptsCardResponse?.() === false) return;
      const initialMap = createInitialSituationMap({
        id: `map-${exerciseId}`, revision: revised.revision,
        environment: { snapshotId: fixed.id, manifestSha256: fixed.manifestSha256, bounds: fixed.region.bounds },
        initialOperationalAt: weather.start, timeZone: 'UTC',
        weatherFrameRef: fixed.weather.contentRef?.path ?? fixed.weather.sourceId,
        terrainStateRef: fixed.atlases.find(atlas => atlas.elevations.contentRef)?.elevations.contentRef?.path ?? 'UNKNOWN: высотный кадр не зафиксирован',
        symbolSet: { id: symbols.id, revision: 1, sha256: hashCanonical(symbols) },
        attribution: [...fixed.atlases.map(atlas => atlas.attribution), fixed.weather.attribution],
      });
      setSnapshot(fixed);
      setMap(initialMap);
      setCurrentRevision(revised.revision);
      onRevision(revised);
      setNotice('Снимок среды сохранён на сервере и связан с новой редакцией учения');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось зафиксировать среду');
    } finally {
      setBusy(false);
    }
  }

  async function approveOnServer(current: InitialSituationMap): Promise<ApprovedInitialMap> {
    const result = await client.approveInitialMap(exerciseId, { expectedRevision: currentRevision, map: current });
    const approved = approveInitialMap(current);
    if (approved.sha256 !== result.sha256) throw new Error('Хеш карты клиента и сервера не совпадает');
    return approved;
  }

  return <section className="kshvi-environment-preparation" aria-labelledby="environment-preparation-title">
    <h2 id="environment-preparation-title">Карта и погода исходной обстановки</h2>
    {!map && <form className="kshvi-environment-form" onSubmit={freeze}>
      <p>Выберите подготовленный атлас из соседнего раздела «Карта и погода». Снимок сохраняется на сервере отдельно от текущих настроек этого раздела.</p>
      {environmentLoading && <p role="status">Загружаем доступные атласы…</p>}
      {!environmentLoading && !atlases.length && !error && <p role="status">Подготовленных атласов нет. Сначала откройте «Карта и погода» и подготовьте район; затем вернитесь к этому учению.</p>}
      <label htmlFor="kshvi-environment-atlas">Атлас района
        <select id="kshvi-environment-atlas" value={atlasId} onChange={event => setAtlasId(event.target.value)} required>
          <option value="" disabled>Выберите атлас</option>
          {atlases.map(atlas => <option key={atlas.id} value={atlas.id}>{atlas.name}</option>)}
        </select>
      </label>
      <DateTimeField id="kshvi-weather-start" label="Начало сценария, UTC" value={scenario.start.slice(0, 16)} onChange={value => { if (value) patch('start', `${value}:00Z`); }} required />
      <label htmlFor="kshvi-weather-seed">Зерно погодного сценария
        <input id="kshvi-weather-seed" type="number" value={scenario.seed} onChange={event => patch('seed', Number(event.target.value))} required />
      </label>
      <details>
        <summary>Расширенные параметры погоды</summary>
        <div>
          {numericFields.map(([key, label]) => <label key={key}>{label}<input type="number" step="any" value={scenario[key]} onChange={event => patch(key, Number(event.target.value))} required /></label>)}
          <label>Длительность, ч<input type="number" min={1} step="any" value={scenario.durationHours ?? 24} onChange={event => patch('durationHours', Number(event.target.value))} required /></label>
          <label>Изменчивость (0–3)<input type="number" min={0} max={3} step="any" value={scenario.variability} onChange={event => patch('variability', Number(event.target.value))} required /></label>
          <label>Переход, ч<input type="number" min={0.25} step="any" value={scenario.transitionHours} onChange={event => patch('transitionHours', Number(event.target.value))} required /></label>
        </div>
      </details>
      <button className="kshvi-primary" type="submit" disabled={environmentLoading || !atlasId || !symbols || busy}>{busy ? 'Фиксируем среду на сервере…' : 'Зафиксировать среду и открыть карту'}</button>
    </form>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="kshvi-error">{error}</p>}
    {map && snapshot && symbols && <>
      <p>Снимок: <code title={snapshot.id}>{snapshot.id.slice(0, 12)}…</code> · автор редакции: {authorId}</p>
      {symbols.status !== 'APPROVED' && <p role="alert">Набор знаков не утверждён методистом. Для официального нанесения нужны утверждённые знаки.</p>}
      <InitialMapCanvas snapshot={snapshot} map={map} />
      <InitialMapStep map={map} onChange={setMap} audiences={initialMapAudiences(map.markers)} availableSymbols={symbolOptions(symbols)} truthRole={truthRole} onApprove={approveOnServer} />
    </>}
  </section>;
}
