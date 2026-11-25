import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { StyleSpecification } from 'maplibre-gl';
import { REGIONAL_CLIMATE_PROFILE } from '../../../../../../packages/core/src/weather-climate-profile';
import { simulateWeather, validateWeatherScenario, weatherDuration, type WeatherDataset, type WeatherScenario } from '../../../../../../packages/core/src/weather';
import { weatherGrid } from '../../../../../../packages/core/src/weather-grid';
import { archiveWeatherCoverage, atlasCoversBounds, validateEnvironmentTime, type AtlasMeta, type Bounds, type EnvironmentSelection,
  type EnvironmentSnapshot, type EnvironmentTime, type EnvironmentWeather } from '../../../../../../packages/kshvi/src/environment/provider';
import type { EnvironmentImpact } from '../../../../../../services/kshvi/src/store/environment-revision';
import { DateTimeField } from '../../DateTimeField';
import type { KshviClient } from '../kshvi-api';
import { EnvironmentMapPreview, snapshotStyleUrls, type WeatherMapPoint } from './InitialMapCanvas';
import { loadEnvironmentStyles } from './snapshot-map-style';

const fields = [
  ['temperature', 'Температура, °C'], ['humidity', 'Влажность, %'], ['pressure', 'Давление, гПа'],
  ['windSpeed', 'Скорость ветра, м/с'], ['windDirection', 'Направление ветра, °'],
  ['cloud', 'Облачность, %'], ['precipitation', 'Осадки, мм/ч'], ['durationHours', 'Длительность, ч'],
  ['variability', 'Изменчивость (0–3)'], ['transitionHours', 'Переход, ч'],
] as const;
const confirmationNames: Record<EnvironmentImpact['confirmations'][number]['area'], string> = {
  CONCEPT: 'замысел', ENVIRONMENT_MAP: 'среда и карта', COMMAND_INTERMEDIARIES: 'управление и посредники',
  EQUIPMENT: 'оснащение', MORALE_READINESS: 'моральное состояние и готовность', LOGISTICS_FORMATION: 'построение и МТО',
  AUTONOMY_AGENTS: 'автономия и агенты', SYMBOL_LIBRARY: 'библиотека знаков', MODEL_PROFILE: 'профиль модели',
  COMMUNICATIONS: 'связь', DOCUMENTS: 'документы', ASSESSMENT: 'оценивание', TECHNICAL_READINESS: 'техническая готовность',
};
const atlasKind = { vector: 'Векторная карта', terrain: 'Рельеф', raster: 'Растровая карта' };

function purpose(atlas: AtlasMeta): string {
  if (atlas.kind === 'raster' && /worldcover|покров/i.test(`${atlas.source ?? ''} ${atlas.name}`)) return 'Наземный покров';
  return atlasKind[atlas.kind];
}

function newScenario(): WeatherScenario {
  return {
    version: 1, algorithmVersion: 2, climateProfileId: REGIONAL_CLIMATE_PROFILE.id, climateProfileSha256: REGIONAL_CLIMATE_PROFILE.sha256,
    temperatureMode: 'climate', manualFields: [], seed: 42, start: '', temperature: 15, humidity: 65,
    pressure: 1013, windSpeed: 4, windDirection: 270, cloud: 40, precipitation: 0, variability: 1, transitionHours: 3, durationHours: 24,
  };
}

function utcInput(value?: string | null): string {
  const stamp = Date.parse(value ?? '');
  return Number.isFinite(stamp) ? new Date(stamp).toISOString().slice(0, 16) : '';
}

function weatherPreview(weather: EnvironmentSelection['weather'], dataset: WeatherDataset | null, at: string, bounds: Bounds): {
  points: WeatherMapPoint[]; error?: string; warning?: string;
} {
  if (weather.mode === 'scenario') {
    const scenario = weather.scenario;
    if (Date.parse(at) < Date.parse(scenario.start) || Date.parse(at) > Date.parse(scenario.start) + weatherDuration(scenario) * 3600000) {
      return { points: [], error: 'Оперативный момент выходит за интервал погодного сценария.' };
    }
    const points = weatherGrid({ bounds: [...bounds], cols: 3, rows: 3 }).flatMap(([lon, lat]) => {
      const value = simulateWeather(scenario, lat, lon, at).temperature;
      return value == null ? [] : [{ lon, lat, value }];
    });
    return { points };
  }
  if (dataset?.id !== weather.datasetId) return { points: [], error: 'Подготовленный погодный набор недоступен.' };
  if (Date.parse(at) < Date.parse(dataset.rows[0]?.time ?? '') || Date.parse(at) > Date.parse(dataset.rows.at(-1)?.time ?? '')) {
    return { points: [], error: 'Оперативный момент выходит за интервал погодного набора.' };
  }
  const coverage = archiveWeatherCoverage(dataset, bounds, at);
  return {
    points: coverage.samples.flatMap(({ lon, lat, state }) => state.temperature == null ? [] : [{ lon, lat, value: state.temperature }]),
    error: coverage.error,
    warning: coverage.warning,
  };
}

type Props = {
  client: KshviClient;
  atlases: readonly AtlasMeta[];
  current: EnvironmentSnapshot | null;
  currentWeather: EnvironmentWeather | null;
  initialAt: string | null;
  initialTimeZone?: string;
  busy: boolean;
  locked: boolean;
  candidate: EnvironmentSnapshot | null;
  impact: EnvironmentImpact | null;
  onEdit(): void;
  onPrepare(selection: EnvironmentSelection): void;
  onFix(): void;
  onCartography?(): void;
};

export function EnvironmentSelectionEditor({
  client, atlases, current, currentWeather, initialAt, initialTimeZone, busy, locked, candidate, impact,
  onEdit, onPrepare, onFix, onCartography,
}: Props) {
  const defaultAtlas = atlases.find(atlas => atlas.kind === 'vector') ?? atlases[0];
  const [areaId, setAreaId] = useState(current ? 'saved' : defaultAtlas?.id ?? '');
  const [selectedIds, setSelectedIds] = useState(current?.atlases.map(atlas => atlas.id) ?? (defaultAtlas ? [defaultAtlas.id] : []));
  const [automaticAtlas, setAutomaticAtlas] = useState(current ? null : defaultAtlas?.id ?? null);
  const [operationalAt, setOperationalAt] = useState(utcInput(current?.operationalTime?.operationalAt ?? initialAt ?? currentWeather?.scenario?.start));
  const [timeZone, setTimeZone] = useState(current?.operationalTime?.timeZone ?? initialTimeZone ?? 'UTC');
  const [mode, setMode] = useState<EnvironmentSelection['weather']['mode']>(currentWeather?.mode ?? 'scenario');
  const [scenario, setScenario] = useState(currentWeather?.scenario ?? newScenario);
  const [datasetId, setDatasetId] = useState(currentWeather?.dataset?.id ?? '');
  const [weatherCatalog, setWeatherCatalog] = useState<Awaited<ReturnType<KshviClient['listEnvironmentWeather']>>>([]);
  const [dataset, setDataset] = useState<WeatherDataset | null>(currentWeather?.dataset ?? null);
  const [archiveError, setArchiveError] = useState('');
  const [weatherVisible, setWeatherVisible] = useState(true);
  const [focusChoices, setFocusChoices] = useState(false);
  const [styleResult, setStyleResult] = useState<{ key: string; style?: StyleSpecification; error?: string } | null>(null);
  const area = areaId === 'saved' ? current?.region : atlases.find(atlas => atlas.id === areaId);
  const live = useMemo(() => atlases.filter(atlas => selectedIds.includes(atlas.id)), [atlases, selectedIds]);
  const styleKey = live.map(atlas => atlas.id).join('|');
  const unavailable = selectedIds.filter(id => !atlases.some(atlas => atlas.id === id));
  const covered = area && live.every(atlas => atlasCoversBounds(atlas.bounds, area.bounds));

  useEffect(() => {
    if (!live.length) return;
    let active = true;
    void loadEnvironmentStyles(live, id => client.getEnvironmentAtlasStyle(id))
      .then(style => { if (active) setStyleResult({ key: styleKey, style: snapshotStyleUrls(style) }); })
      .catch(cause => { if (active) setStyleResult({ key: styleKey, error: cause.message }); });
    return () => { active = false; };
  }, [client, live, styleKey]);

  useEffect(() => {
    if (mode !== 'archive') return;
    let active = true;
    void client.listEnvironmentWeather().then(items => { if (active) setWeatherCatalog(items); })
      .catch(cause => { if (active) setArchiveError(cause.message); });
    return () => { active = false; };
  }, [client, mode]);

  useEffect(() => {
    if (mode !== 'archive' || !datasetId) return;
    if (currentWeather?.dataset?.id === datasetId) {
      setDataset(currentWeather.dataset);
      return;
    }
    let active = true;
    setArchiveError('');
    void client.getEnvironmentWeather(datasetId).then(result => { if (active) setDataset(result); })
      .catch(cause => { if (active) setArchiveError(cause.message); });
    return () => { active = false; };
  }, [client, mode, datasetId, currentWeather]);

  useLayoutEffect(() => {
    if (focusChoices) {
      document.getElementById('kshvi-environment-area')?.focus();
      setFocusChoices(false);
    }
  }, [focusChoices]);

  const evaluated = useMemo<ReturnType<typeof weatherPreview> & { time?: EnvironmentTime; weather?: EnvironmentSelection['weather'] }>(() => {
    if (!area || !operationalAt || (mode === 'archive' && !datasetId)) return { points: [] as WeatherMapPoint[] };
    try {
      const time = validateEnvironmentTime({ operationalAt: `${operationalAt}:00Z`, timeZone });
      const weather: EnvironmentSelection['weather'] = mode === 'scenario'
        ? { mode, scenario: validateWeatherScenario({ ...scenario, start: scenario.start || time.operationalAt }) }
        : { mode, datasetId };
      return { time, weather, ...weatherPreview(weather, dataset, time.operationalAt, area.bounds) };
    } catch (cause) {
      return { points: [] as WeatherMapPoint[], error: cause instanceof Error ? cause.message : 'Некорректная погода' };
    }
  }, [area, dataset, datasetId, mode, operationalAt, scenario, timeZone]);

  const style = styleResult?.key === styleKey ? styleResult.style : null;
  const styleError = styleResult?.key === styleKey ? styleResult.error : '';
  const noImpact = !impact || !impact.objects.length && !impact.confirmations.length;
  const valid = area && live.length && !unavailable.length && covered && style && evaluated.time && evaluated.weather
    && !evaluated.error && !archiveError;

  function toggle(id: string) {
    onEdit();
    setSelectedIds(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]);
    if (id === automaticAtlas) setAutomaticAtlas(null);
  }

  function chooseArea(id: string) {
    onEdit();
    setAreaId(id);
    const region = atlases.find(atlas => atlas.id === id);
    setSelectedIds(ids => [...new Set([...ids.filter(selected => selected !== automaticAtlas), ...(region ? [region.id] : [])])]);
    setAutomaticAtlas(region && !selectedIds.includes(region.id) ? region.id : null);
  }

  function updateWeatherNumber(field: typeof fields[number][0] | 'seed', value: number) {
    onEdit();
    setScenario(previous => ({
      ...previous, [field]: value,
      ...(previous.algorithmVersion === 2 && !['seed', 'durationHours', 'variability', 'transitionHours'].includes(field)
        ? { manualFields: [...new Set([...(previous.manualFields ?? []), field as NonNullable<WeatherScenario['manualFields']>[number]])] } : {}),
    }));
  }

  return <div className="kshvi-environment-editor">
    <div className="kshvi-environment-actions">
      <button type="button" disabled={busy || locked} onClick={() => setFocusChoices(true)}>Выбрать подготовленную область</button>
      {onCartography && <button type="button" disabled={busy} onClick={onCartography}>Изменить область в «Карте и погоде»</button>}
      <button type="button" disabled={locked || busy || !valid} onClick={() => {
        if (!valid || !evaluated.weather || !evaluated.time) return;
        onPrepare({
          region: { name: area.name, bounds: area.bounds },
          atlases: live.map(({ id }) => ({ id, exportRights: current?.atlases.find(atlas => atlas.id === id)?.exportRights ?? 'ALLOWED' })),
          weather: evaluated.weather, operationalTime: evaluated.time,
          elevation: current?.elevation ?? { adjustmentM: 0, algorithmVersion: 1 },
          algorithmVersions: { snapshot: current?.algorithmVersions.snapshot ?? 1, weather: evaluated.weather.mode === 'scenario'
            ? evaluated.weather.scenario.algorithmVersion ?? 1 : 1 },
        });
      }}>{busy && !candidate ? 'Проверяем данные на сервере…' : 'Сформировать новый снимок среды'}</button>
      {candidate && <button type="button" className="kshvi-primary" disabled={locked || busy || !valid}
        onClick={onFix}>{busy ? 'Сохраняем редакцию…' : 'Зафиксировать среду'}</button>}
    </div>
    <div className="kshvi-environment-columns">
      <div className="kshvi-environment-controls">
        <fieldset disabled={busy || locked}>
          <legend>Область и наборы</legend>
          <label htmlFor="kshvi-environment-area">Подготовленная область</label>
          <select id="kshvi-environment-area" value={areaId} onChange={event => chooseArea(event.target.value)}>
            {!area && <option value="">Выберите область из каталога</option>}
            {current && <option value="saved">{current.region.name} · текущая рамка</option>}
            {atlases.map(atlas => <option key={atlas.id} value={atlas.id}>{atlas.name}</option>)}
          </select>
          {area && <p className="kshvi-environment-bounds">Рамка WGS 84 · {area.bounds.map(value => value.toFixed(4)).join(' · ')}</p>}
          {!atlases.length && <p>Каталог пока пуст. Подготовьте нужный район в разделе «Карта и погода».</p>}
          <ul className="kshvi-atlas-options">
            {[...atlases].sort((left, right) => area
              ? Number(atlasCoversBounds(right.bounds, area.bounds)) - Number(atlasCoversBounds(left.bounds, area.bounds))
              : 0).map(atlas => {
              const complete = area && atlasCoversBounds(atlas.bounds, area.bounds);
              return <li key={atlas.id}><label>
                <input type="checkbox" data-atlas-id={atlas.id} aria-label={atlas.name} checked={selectedIds.includes(atlas.id)} onChange={() => toggle(atlas.id)} />
                <span><strong>{atlas.name}</strong>
                  <small>{purpose(atlas)} · z{atlas.minzoom}–{atlas.maxzoom} · {complete ? 'Рамка внутри покрытия каталога' : 'Рамка покрыта частично или вне набора'}</small>
                  <small>{atlas.attribution || 'Атрибуция в каталоге не указана'}</small>
                </span>
              </label></li>;
            })}
            {unavailable.map(id => <li key={id}>
              <span>{current?.atlases.find(atlas => atlas.id === id)?.meta.name ?? id} · набора больше нет в каталоге.</span>
              <button type="button" onClick={() => toggle(id)}>Исключить набор и выбрать замену</button>
            </li>)}
          </ul>
          {covered === false && <p role="alert">Один или несколько выбранных наборов не покрывают рамку. Смените область или наборы.</p>}
        </fieldset>
        <fieldset disabled={busy || locked}>
          <legend>Погода и время</legend>
          <DateTimeField id="kshvi-weather-start" label="Оперативный момент, UTC" value={operationalAt} onChange={value => { onEdit(); setOperationalAt(value); }} required />
          <label>Часовой пояс отображения
            <input value={timeZone} onChange={event => { onEdit(); setTimeZone(event.target.value); }} list="kshvi-timezones" />
          </label>
          <datalist id="kshvi-timezones"><option value="UTC" /><option value="Europe/Moscow" /><option value="Europe/Berlin" /></datalist>
          <label>Источник погоды
            <select value={mode} onChange={event => { onEdit(); setArchiveError(''); setMode(event.target.value === 'archive' ? 'archive' : 'scenario'); }}>
              <option value="scenario">Сценарная погода</option><option value="archive">Подготовленный погодный набор</option>
            </select>
          </label>
          {mode === 'archive' ? <label>Погодный набор
            <select value={datasetId} onChange={event => { onEdit(); setDatasetId(event.target.value); }}>
              <option value="">Выберите погодный набор</option>
              {currentWeather?.dataset && !weatherCatalog.some(item => item.id === currentWeather.dataset?.id)
                && <option value={currentWeather.dataset.id}>{currentWeather.dataset.name} · из снимка</option>}
              {weatherCatalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label> : <>
            <label>Зерно погодного сценария<input type="number" value={scenario.seed} onChange={event => updateWeatherNumber('seed', Number(event.target.value))} /></label>
            <details><summary>Параметры сценарной погоды</summary>
              <p>Алгоритм {scenario.algorithmVersion ?? 1}{scenario.algorithmVersion === 2 ? ' · региональные климатические нормы' : ''}</p>
              <DateTimeField id="kshvi-weather-scenario-start" label="Начало погодного сценария, UTC" value={utcInput(scenario.start)}
                onChange={value => { onEdit(); setScenario(previous => ({ ...previous, start: value ? `${value}:00Z` : '' })); }} />
              <div className="kshvi-weather-fields">{fields.map(([key, label]) => <label key={key}>{label}
                <input type="number" step="any"
                  value={scenario.algorithmVersion === 2 && !['durationHours', 'variability', 'transitionHours', 'precipitation'].includes(key)
                    && !scenario.manualFields?.includes(key as NonNullable<WeatherScenario['manualFields']>[number]) ? '' : (scenario[key] ?? 168)}
                  placeholder="Климатическая норма" onChange={event => updateWeatherNumber(key, Number(event.target.value))} />
              </label>)}</div>
            </details>
          </>}
          {archiveError && <p role="alert">{archiveError}</p>}
          {evaluated.error && <p role="alert">{evaluated.error}</p>}
          {evaluated.warning && <p role="status">{evaluated.warning}</p>}
        </fieldset>
      </div>
      <div className="kshvi-environment-preview">
        {styleError && <p role="alert">{styleError}</p>}
        {area && style && <>
          <EnvironmentMapPreview style={style} bounds={area.bounds} weatherPoints={weatherVisible ? evaluated.points : undefined} />
          <label className="kshvi-weather-toggle">
            <input type="checkbox" checked={weatherVisible} onChange={event => setWeatherVisible(event.target.checked)} />
            Температура на оперативный момент
          </label>
          {weatherVisible && evaluated.points.length > 0 && <div className="kshvi-weather-legend" aria-label="Легенда температуры">
            <span>−20 °C</span><span className="kshvi-weather-gradient" /><span>+40 °C</span>
          </div>}
          {weatherVisible && evaluated.time && !evaluated.points.length && !evaluated.error && <p>Температура в погодных данных не указана.</p>}
        </>}
      </div>
    </div>
    {impact && <section className="kshvi-environment-impact" aria-label="Последствия смены среды">
      <h3>Последствия смены среды</h3>
      {noImpact && <p>В редакции нет связанных объектов и подтверждений.</p>}
      {!!impact.objects.length && <ul>
        {impact.objects.map(item => <li key={`${item.kind}-${item.id}`} className={item.outside ? 'kshvi-error' : undefined}>
          {item.kind} «{item.id}»{item.outside ? ' · вне новой рамки, требуется решение автора' : ' · требуется проверка'}
        </li>)}
      </ul>}
      {!!impact.confirmations.length && <p>Устареют подтверждения: {impact.confirmations.map(item => confirmationNames[item.area]).join(', ')}.</p>}
      {!!impact.missingForceIds.length && <p role="alert">Для переноса исходной карты отсутствуют силы: {impact.missingForceIds.join(', ')}.</p>}
      {!!impact.missingInstanceIds.length && <p role="alert">Для переноса исходной карты не найдены экземпляры участников: {impact.missingInstanceIds.join(', ')}.</p>}
    </section>}
  </div>;
}
