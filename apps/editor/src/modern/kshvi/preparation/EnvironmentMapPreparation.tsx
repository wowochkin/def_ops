import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AtlasMeta, EnvironmentSelection, EnvironmentSnapshot, EnvironmentWeather } from '../../../../../../packages/kshvi/src/environment/provider';
import { approveInitialMap, createInitialSituationMap, type ApprovedInitialMap, type InitialSituationMap } from '../../../../../../packages/kshvi/src/scenario/initial-map';
import { hashCanonical } from '../../../../../../packages/kshvi/src/scenario/initial-map-hash';
import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { SymbolSet } from '../../../../../../packages/tactical-symbols/src/model';
import type { EnvironmentImpact } from '../../../../../../services/kshvi/src/store/environment-revision';
import { isExerciseAccessLost, KshviHttpError, type ExerciseCard, type KshviClient } from '../kshvi-api';
import { InitialMapStep, type InitialMapSymbolOption } from './InitialMapStep';
import { initialMapAudiences } from './initial-map-audiences';
import { InitialMapCanvas } from './InitialMapCanvas';
import { EnvironmentSelectionEditor } from './EnvironmentSelectionEditor';

function symbolOptions(set: SymbolSet): InitialMapSymbolOption[] {
  return set.symbols.map(symbol => ({
    id: symbol.id, version: symbol.version, sideId: 'UNKNOWN', status: symbol.status,
    sourceDocument: symbol.source.sourceDocument, sourcePage: symbol.source.page ?? 0,
    nameRu: symbol.name, purpose: symbol.purpose, objectType: symbol.objectType, kind: symbol.kind,
  }));
}

function makeInitialMap(exerciseId: string, revision: number, snapshot: EnvironmentSnapshot, weather: EnvironmentWeather,
  symbols: SymbolSet, startsAt: string | null): InitialSituationMap | null {
  const at = snapshot.operationalTime?.operationalAt ?? weather.scenario?.start ?? startsAt;
  if (!at) return null;
  return createInitialSituationMap({
    id: `map-${exerciseId}`, revision,
    environment: { snapshotId: snapshot.id, manifestSha256: snapshot.manifestSha256, bounds: snapshot.region.bounds },
    initialOperationalAt: at, timeZone: snapshot.operationalTime?.timeZone ?? 'UTC',
    weatherFrameRef: snapshot.weather.contentRef?.path ?? snapshot.weather.sourceId,
    terrainStateRef: snapshot.atlases.find(atlas => atlas.elevations.contentRef)?.elevations.contentRef?.path ?? 'UNKNOWN: высотный кадр не зафиксирован',
    symbolSet: { id: symbols.id, revision: 1, sha256: hashCanonical(symbols) },
    attribution: [...snapshot.atlases.map(atlas => atlas.attribution), snapshot.weather.attribution],
  });
}

type Props = {
  client: KshviClient;
  card: ExerciseCard;
  draft: PreparationDraft;
  revision: number;
  legacySnapshotId?: string | null;
  truthRole: string;
  canEdit: boolean;
  locked: boolean;
  savePreparation(draft: PreparationDraft): Promise<ExerciseCard>;
  onRevision(card: ExerciseCard): void;
  onConflict(reason: string): void;
  onAccessLost(cause: KshviHttpError): void;
  onPendingChange(dirty: boolean, busy: boolean): void;
  onMapChange(map: InitialSituationMap): void;
  onCartography?(): void;
  acceptsCardResponse?(): boolean;
};

export function EnvironmentMapPreparation({
  client, card, draft, revision, legacySnapshotId, truthRole, canEdit, locked, savePreparation, onRevision,
  onAccessLost, onConflict, onPendingChange, onCartography, acceptsCardResponse, onMapChange,
}: Props) {
  const [atlases, setAtlases] = useState<readonly AtlasMeta[] | null>(null);
  const [symbols, setSymbols] = useState<SymbolSet | null>(null);
  const [snapshotRef, setSnapshotRef] = useState<{ snapshot: EnvironmentSnapshot; weather: EnvironmentWeather } | null>(null);
  const [loadsError, setLoadsError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapEdit, setMapEdit] = useState<InitialSituationMap | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const alive = useRef(true);
  const [candidate, setCandidate] = useState<EnvironmentSnapshot | null>(null);
  const [impact, setImpact] = useState<EnvironmentImpact | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const snapshotId = draft.environmentSnapshotId ?? legacySnapshotId ?? null;
  const current = snapshotRef?.snapshot.id === snapshotId ? snapshotRef : null;

  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useLayoutEffect(() => { onPendingChange(dirty, busy); }, [onPendingChange, dirty, busy]);
  useLayoutEffect(() => () => onPendingChange(false, false), [onPendingChange]);

  useEffect(() => {
    if (!canEdit) return;
    let active = true;
    void client.listEnvironmentAtlases().then(value => { if (active) setAtlases(value); })
      .catch(cause => { if (active) setLoadsError(cause.message); });
    return () => { active = false; };
  }, [client, canEdit]);

  useEffect(() => {
    if (!mapOpen) return;
    let active = true;
    void client.symbolCatalog().then(value => { if (active) setSymbols(value.set); })
      .catch(cause => { if (active) setLoadsError(cause.message); });
    return () => { active = false; };
  }, [client, mapOpen]);

  useEffect(() => {
    if (!snapshotId) return;
    let active = true;
    const loadWeather = (snapshot: EnvironmentSnapshot): Promise<EnvironmentWeather> =>
      snapshot.weather.contentRef && !snapshot.weather.scenario && !snapshot.weather.dataset
        ? client.getEnvironmentSnapshotWeather(snapshot.id) : Promise.resolve(snapshot.weather);
    void client.getEnvironmentSnapshot(snapshotId).then(async snapshot => ({ snapshot, weather: await loadWeather(snapshot) }))
      .then(value => { if (active) setSnapshotRef(value); })
      .catch(cause => { if (active) setLoadsError(cause.message); });
    return () => { active = false; };
  }, [client, snapshotId]);

  function onEdit() {
    setDirty(true);
    setCandidate(null);
    setImpact(null);
    setError('');
    setNotice('');
  }

  function canApply() { return alive.current && acceptsCardResponse?.() !== false; }

  async function run(action: () => Promise<void>) {
    if (operation.current || locked || !canEdit) return;
    operation.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await action(); } catch (cause) {
      if (!canApply()) return;
      if (isExerciseAccessLost(cause)) onAccessLost(cause);
      else if (cause instanceof KshviHttpError && cause.status === 409) onConflict(cause.message);
      else setError(cause instanceof Error ? cause.message : 'Не удалось сохранить среду');
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function prepare(selection: EnvironmentSelection) {
    await run(async () => {
      setDirty(true);
      setCandidate(null);
      setImpact(null);
      const latest = await client.getCard(card.id);
      if (!canApply()) return;
      if (latest.payloadAccess !== 'FULL') { onRevision(latest); return; }
      if (latest.revision !== revision || latest.state !== card.state) {
        throw new KshviHttpError(409, 'Редакция изменилась. Проверьте актуальные данные и повторите выбор среды.');
      }
      if (snapshotId || draft.initialMap || card.state === 'SEALED') {
        const result = await client.environmentImpact(card.id, { expectedRevision: revision, bounds: selection.region.bounds });
        if (!canApply()) return;
        setImpact(result);
        if (result.missingForceIds.length) return;
      }
      // Сервер проверяет наличие атласов, покрытие и погоду до привязки снимка к редакции.
      const snapshot = await client.createEnvironmentSnapshot(selection).catch(cause => {
        if (cause instanceof KshviHttpError && cause.status === 404) throw new Error(cause.message);
        throw cause;
      });
      if (!canApply()) return;
      if (snapshot.id === snapshotId) throw new Error('Этот снимок уже связан с текущей редакцией. Измените область, наборы или погоду.');
      setCandidate(snapshot);
    });
  }

  async function fix() {
    if (!candidate) return;
    await run(async () => {
      const revised = snapshotId || draft.initialMap || card.state === 'SEALED'
        ? await client.replaceEnvironment(card.id, { expectedRevision: revision, snapshotId: candidate.id })
        : await savePreparation({ ...draft, environmentSnapshotId: candidate.id });
      if (!canApply()) return;
      onRevision(revised);
      setCandidate(null);
      setImpact(null);
      setDirty(false);
      setEditOpen(false);
      setMapOpen(false);
      setMapEdit(null);
      setNotice('Снимок среды сохранён и связан с новой редакцией учения.');
    });
  }

  async function approveOnServer(map: InitialSituationMap): Promise<ApprovedInitialMap> {
    const result = await client.approveInitialMap(card.id, { expectedRevision: revision, map });
    const approved = approveInitialMap(map);
    if (approved.sha256 !== result.sha256) throw new Error('Хеш карты клиента и сервера не совпадает');
    return approved;
  }

  const sealedMap = card.revisions.find(item => item.revision === revision)?.sealedArtifact?.initialMap;
  const savedMap = draft.initialMap ?? (sealedMap?.environment.snapshotId === snapshotId ? sealedMap : undefined);
  const map = mapEdit?.environment.snapshotId === current?.snapshot.id ? mapEdit
    : savedMap ?? (mapOpen && current && symbols ? makeInitialMap(card.id, revision, current.snapshot, current.weather, symbols, card.startsAt) : null);
  const editing = (canEdit || dirty || busy) && (!snapshotId || editOpen);
  return <section className="kshvi-environment-preparation" aria-labelledby="environment-preparation-title">
    <h2 id="environment-preparation-title">Карта и погода исходной обстановки</h2>
    {snapshotId && !current && !loadsError && <p role="status">Загружаем сохранённый снимок…</p>}
    {current && <section className="kshvi-environment-snapshot" aria-label="Сохранённый снимок среды">
      <h3>{current.snapshot.region.name}</h3>
      <p>Рамка WGS 84 · {current.snapshot.region.bounds.map(value => value.toFixed(4)).join(' · ')}</p>
      <p>Идентификатор и SHA-256 манифеста <code title={current.snapshot.id}>{current.snapshot.manifestSha256}</code></p>
      <ul aria-label="Наборы снимка">{current.snapshot.atlases.map(atlas => <li key={atlas.id}>
        {atlas.meta.name} · z{atlas.meta.minzoom}–{atlas.meta.maxzoom} · {atlas.attribution}
      </li>)}</ul>
      <p>Погода · {current.weather.dataset?.name ?? current.weather.attribution}
        {current.snapshot.operationalTime && <> · {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short',
          timeZone: current.snapshot.operationalTime.timeZone }).format(new Date(current.snapshot.operationalTime.operationalAt))}
          {' · '}{current.snapshot.operationalTime.timeZone}</>}</p>
      {!!current.snapshot.limitations.length && <ul>{current.snapshot.limitations.map(message => <li key={message}>{message}</li>)}</ul>}
      <div className="kshvi-environment-actions">
        {canEdit && !editOpen && <button type="button" disabled={locked} onClick={() => { setEditOpen(true); setMapOpen(false); }}>Сменить среду</button>}
        {!mapOpen && <button type="button" disabled={busy || editOpen} onClick={() => setMapOpen(true)}>Открыть исходную обстановку</button>}
        {editOpen && <button type="button" disabled={busy} onClick={() => {
          setEditOpen(false); setDirty(false); setCandidate(null); setImpact(null); setError('');
        }}>Отменить подбор</button>}
      </div>
    </section>}
    {!current && snapshotId && loadsError && canEdit && !editOpen
      && <button type="button" disabled={locked} onClick={() => setEditOpen(true)}>Выбрать замену снимку</button>}
    {editing && atlases === null && !loadsError && <p role="status">Загружаем доступные наборы…</p>}
    {editing && atlases && <EnvironmentSelectionEditor client={client} atlases={atlases}
      current={current?.snapshot ?? null} currentWeather={current?.weather ?? null}
      initialAt={savedMap?.initialOperationalAt ?? card.startsAt} initialTimeZone={savedMap?.timeZone}
      busy={busy} locked={locked || !canEdit} impact={impact} candidate={candidate} onEdit={onEdit}
      onPrepare={selection => void prepare(selection)} onFix={() => void fix()} onCartography={onCartography} />}
    {notice && <p role="status">{notice}</p>}
    {(error || loadsError) && <p role="alert" className="kshvi-error">{error || loadsError}</p>}
    {mapOpen && current && <>
      <InitialMapCanvas client={client} snapshot={current.snapshot} map={map ?? undefined} />
      {map && symbols && canEdit && card.state !== 'SEALED' && <>
        {symbols.status !== 'APPROVED' && <p role="alert">Набор знаков ещё не утверждён методистом.</p>}
        <InitialMapStep map={map} onChange={next => {
          setMapEdit(next);
          if (next.state === 'DRAFT') onMapChange(next);
        }} audiences={initialMapAudiences(map.markers)}
          availableSymbols={symbolOptions(symbols)} truthRole={truthRole} onApprove={approveOnServer} />
      </>}
    </>}
  </section>;
}
