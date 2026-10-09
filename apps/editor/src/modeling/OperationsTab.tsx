/**
 * «Операции»: загрузить новую операцию (файлы сценария, театра, истории, по желанию — участков, настроек штаба
 * модели; или один файл-пакет), проверить, настроить игру (победа, поражение, допуск, наборы правил) и штаб
 * модели (какая сторона, роль, опорный пункт, ограничения), сделать контрольный прогон и подготовить к
 * переигровке — операция появится в «Переигровке». Встроенную операцию можно скачать пакетом как образец.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { areaTitle, defaultCatalog, defaultLive, detectPart, mergeEvaluations, validateOperation, type CatalogEntry, type LiveSetup, type OperationPackage, type PackageIssue, type Rules, type Scenario, type SideProfile, type TheatreData, type History } from '@def-ops/sim';
import { BUILTIN, BUILTIN_CATALOG, deleteOperation, getData, getInfra, saveOperation, type UserOperation } from '../sim/userdata';
import type { Llm } from '../shared';
import { Materials } from './Materials';
import { CoveragePanel, useCoverage } from './Coverage';
import { COVERAGE_LEVEL } from '@def-ops/knowledge';
import { download, getPool, pct, type SimData } from './data';

const liveFiles = import.meta.glob('../../../../services/staff/live/*.json', { import: 'default' });
const sectorFiles = import.meta.glob('../../../../packages/sim/data/scenarios/*.sectors.json', { import: 'default' });

/** Встроенная операция пакетом — образец формата. */
async function builtinPackage(id: string): Promise<OperationPackage> {
  const scenario = (await getData('scenarios', `${id}.json`)) as Scenario;
  return {
    scenario,
    theatre: (await getData('theatres', `${scenario.theatre}.json`)) as TheatreData,
    history: (await getData('scenarios', `${id}.history.json`)) as History,
    sectors: (await sectorFiles[`../../../../packages/sim/data/scenarios/${id}.sectors.json`]?.()) as OperationPackage['sectors'],
    live: (await liveFiles[`../../../../services/staff/live/${id}.json`]?.()) as LiveSetup,
    catalog: BUILTIN_CATALOG.find((c) => c.id === id),
  };
}

/** Собрать пакет из файлов: части узнаются по полям. */
async function readFiles(files: FileList): Promise<{ pkg: Partial<OperationPackage>; notes: string[] }> {
  const pkg: Partial<OperationPackage> = {};
  const notes: string[] = [];
  for (const f of Array.from(files)) {
    let j: unknown;
    try { j = JSON.parse(await f.text()); } catch { notes.push(`${f.name}: не JSON — пропущен`); continue; }
    const part = detectPart(j);
    if (part === 'bundle') Object.assign(pkg, j as OperationPackage);
    else if (part === 'rules') pkg.rules = [...(pkg.rules ?? []), j as Rules];
    else if (part === 'profiles') pkg.profiles = [...(pkg.profiles ?? []), j as SideProfile];
    else if (part) (pkg as Record<string, unknown>)[part] = j;
    else notes.push(`${f.name}: не удалось понять, что это за файл — пропущен`);
    if (part) notes.push(`${f.name}: ${({ bundle: 'пакет операции', scenario: 'сценарий', theatre: 'театр', history: 'история', sectors: 'участки', live: 'настройки штаба модели', catalog: 'запись каталога', rules: 'правила', profiles: 'профиль стороны' } as Record<string, string>)[part]}`);
  }
  return { pkg, notes };
}

const LEVEL: Record<PackageIssue['level'], string> = { error: '✗', warning: '!', info: '·' };

export function OperationsTab({ d, llm, onCompare, onCalibrate }: { d: SimData; llm: Llm; onCompare: (scenario: string, rules: string[]) => void; onCalibrate: (scenario: string) => void }) {
  const [sel, setSel] = useState<string | null>(d.ops[0]?.id ?? BUILTIN_CATALOG[0]?.id ?? null);
  const [upload, setUpload] = useState<{ pkg: Partial<OperationPackage>; notes: string[]; id: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState(BUILTIN_CATALOG[0].id);
  const input = useRef<HTMLInputElement>(null);
  const op = d.ops.find((o) => o.id === sel) ?? null;
  const builtin = !op ? BUILTIN_CATALOG.find((c) => c.id === sel) ?? null : null;
  const known = useMemo(() => ({ rules: [...BUILTIN.rules, ...d.rules.filter((r) => r.user).map((r) => r.id)], profiles: BUILTIN.profiles }), [d.rules]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const { pkg, notes } = await readFiles(files);
    setUpload({ pkg, notes, id: pkg.scenario?.id ?? '' });
    setSel(null);
  };
  const saveUpload = async () => {
    if (!upload?.pkg.scenario || !upload.pkg.theatre || !upload.pkg.history) return;
    const id = upload.id.trim();
    if (BUILTIN_CATALOG.some((c) => c.id === id)) { setError(`«${id}» — встроенная операция; дайте другой id`); return; }
    const pkg = { ...upload.pkg, scenario: { ...upload.pkg.scenario, id }, history: { ...upload.pkg.history, scenario: id } } as OperationPackage;
    if (pkg.live) pkg.live = { ...pkg.live, scenario: id };
    if (pkg.catalog) pkg.catalog = { ...pkg.catalog, id };
    await saveOperation({ id, created: new Date().toISOString(), pkg, ready: false });
    setUpload(null); setSel(id); setError(null);
  };
  const update = (o: UserOperation, p: Partial<OperationPackage>, extra: Partial<UserOperation> = {}) => saveOperation({ ...o, ...extra, pkg: { ...o.pkg, ...p } });

  const control = async (o: UserOperation) => {
    setBusy('контрольный прогон…'); setError(null);
    try {
      const pool = getPool();
      const t0 = Date.now();
      const r = mergeEvaluations(await Promise.all([0, 1, 2].map((k) => pool.run({ scenario: o.id, rules: o.pkg.scenario.rules, seeds: 1, seed0: 101 + k, toleranceKm: (o.pkg.catalog ?? defaultCatalog(o.pkg)).toleranceKm }))));
      const ev = r.events.flatMap((e) => e.days);
      await saveOperation({ ...o, check: { at: new Date().toISOString(), within: r.within, medianExcessKm: r.medianExcessKm, eventsHit: ev.filter((x) => x != null && Math.abs(x) <= 2).length, eventsTotal: ev.length, ms: Date.now() - t0 } });
    } catch (e) { setError(`Прогон не удался: ${(e as Error).message}`); }
    setBusy(null);
  };

  return (
    <div className="mdl-split">
      <aside className="mdl-list">
        <h4>Операции стенда</h4>
        {BUILTIN_CATALOG.map((c) => <button key={c.id} className={sel === c.id ? 'on' : ''} onClick={() => { setSel(c.id); setUpload(null); }}>
          <b>{c.title.split(':')[0]}</b><small>{c.id} · материалы, инфраструктура</small></button>)}
        <h4>Свои операции</h4>
        {d.ops.map((o) => <button key={o.id} className={sel === o.id ? 'on' : ''} onClick={() => { setSel(o.id); setUpload(null); }}>
          <b>{o.pkg.catalog?.title ?? o.pkg.scenario.name}</b><small>{o.id} · {o.ready ? '✓ в переигровке' : 'черновик'}</small></button>)}
        {!d.ops.length && <p className="muted">Пока нет. Загрузите файлы операции.</p>}
        <input ref={input} type="file" accept=".json,application/json" multiple hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
        <button className="primary mdl-add" onClick={() => input.current?.click()}>+ Загрузить операцию</button>
        <h4>Образец формата</h4>
        <div className="row"><select value={sample} onChange={(e) => setSample(e.target.value)}>{BUILTIN_CATALOG.map((c) => <option key={c.id} value={c.id}>{c.title.split(',')[0]}</option>)}</select>
          <button onClick={() => void builtinPackage(sample).then((p) => download(`${sample}.operation.json`, JSON.stringify(p)))} title="Встроенная операция одним файлом-пакетом">Скачать</button></div>
        <p className="muted small">Пакет — один JSON с частями scenario, theatre, history (и по желанию sectors, live, catalog, rules, profiles); можно и отдельными файлами. Театр (местность, дороги, реки по WorldCover и Natural Earth) собирается инструментом <code>npm run sim:scenario</code>.</p>
      </aside>
      <main className="mdl-main">
        {error && <div className="err" onClick={() => setError(null)}>{error}</div>}
        {upload && <>
          <h3>Новая операция</h3>
          <ul className="mdl-notes">{upload.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          <Issues issues={validateOperation({ ...upload.pkg, ...(upload.pkg.scenario ? { scenario: { ...upload.pkg.scenario, id: upload.id } } : {}) }, known)} />
          <label className="mdl-id">id операции (латиница, цифры, дефис) <input value={upload.id} onChange={(e) => setUpload({ ...upload, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></label>
          <div className="row">
            <button className="primary" disabled={!upload.pkg.scenario || !upload.pkg.theatre || !upload.pkg.history || !upload.id} onClick={() => void saveUpload()}>Сохранить черновик</button>
            <button onClick={() => input.current?.click()}>Добавить файлы</button>
            <button onClick={() => setUpload(null)}>Отмена</button>
          </div>
          <p className="muted">Не хватает частей — добавьте файлы. Черновик можно проверять, сравнивать и калибровать; в «Переигровке» он появится после подготовки.</p>
        </>}
        {builtin && !upload && <BuiltinCard id={builtin.id} title={builtin.title} detail={builtin.detail} llm={llm} />}
        {op && !upload && <OperationCard op={op} d={d} llm={llm} known={known} busy={busy} update={update} control={control} onCompare={onCompare} onCalibrate={onCalibrate}
          remove={() => { if (confirm(`Удалить операцию «${op.pkg.scenario.name}»?`)) void deleteOperation(op.id).then(() => setSel(null)); }} />}
        {!op && !builtin && !upload && <div className="mdl-empty">
          <h3>Подготовка новой операции к переигровке</h3>
          <ol className="steps">
            <li><b>Загрузите</b> файлы операции: сценарий (стороны, состав, исторические приказы, сроки), театр (местность, дороги, реки, районы), история (положения по дням, линия фронта, ключевые события). Формат — как у встроенных: скачайте образец слева.</li>
            <li><b>Проверка</b> покажет, сходятся ли ссылки: стороны и профили, правила, районы приказов и событий, формирования истории.</li>
            <li><b>Настройте игру</b>: чем кончается (победа — событие истории, поражение — потеря сил или срок), допуск сравнения, наборы правил на выбор; и <b>штаб модели</b>: какой стороной командует модель, её роль, опорный пункт, ограничения.</li>
            <li><b>Контрольный прогон</b> с историческими приказами покажет, насколько расчёт повторяет историю. Если плохо — откалибруйте правила по этой операции (вкладка «Калибровка») и сравните.</li>
            <li><b>Подготовьте к переигровке</b> — операция появится в разделе «Переигровка»: расчёт, карта, принятие командования, советник, разбор.</li>
          </ol>
        </div>}
      </main>
    </div>
  );
}

function Issues({ issues }: { issues: PackageIssue[] }) {
  const n = { error: issues.filter((i) => i.level === 'error').length, warning: issues.filter((i) => i.level === 'warning').length };
  return <section className="mdl-card">
    <h4>Проверка: {n.error ? <span className="err">ошибок {n.error}</span> : <span className="ok">ошибок нет</span>}{n.warning ? `, замечаний ${n.warning}` : ''}</h4>
    <ul className="mdl-issues">{issues.map((i, k) => <li key={k} className={i.level}><i>{LEVEL[i.level]}</i><b>{i.part}</b> {i.text}</li>)}</ul>
  </section>;
}

/** Встроенная операция: материалы и состояние инфраструктуры (сценарий и театр — из сборки). */
function BuiltinCard({ id, title, detail, llm }: { id: string; title: string; detail: string; llm: Llm }) {
  const [T, setT] = useState<TheatreData | null>(null);
  useEffect(() => { setT(null); void (getData('scenarios', `${id}.json`) as Promise<Scenario>).then((s) => getData('theatres', `${s.theatre}.json`)).then((t) => setT(t as TheatreData)); }, [id]);
  return <>
    <div className="mdl-h"><div><h3>{title}</h3><span className="muted">{id} · операция стенда · {detail}</span></div>
      <div className="mdl-acts"><button onClick={() => void builtinPackage(id).then(async (p) => download(`${id}.operation.json`, JSON.stringify({ ...p, infrastructure: await getInfra(id) })))}>Скачать пакет</button></div></div>
    <p className="muted">Сценарий, театр и история — из сборки стенда. Здесь — материалы операции (документы → база знаний и сведения об инфраструктуре) и состояние инфраструктуры, которое ложится поверх театра в расчёте и в игре.</p>
    <CoveragePanel op={id} title={title} />
    <Materials op={id} title={title} theatre={T} llm={llm} />
  </>;
}

function OperationCard({ op, d, llm, known, busy, update, control, onCompare, onCalibrate, remove }: {
  op: UserOperation; d: SimData; llm: Llm; known: { rules: string[]; profiles: string[] }; busy: string | null;
  update: (o: UserOperation, p: Partial<OperationPackage>, extra?: Partial<UserOperation>) => Promise<void>; control: (o: UserOperation) => Promise<void>;
  onCompare: (scenario: string, rules: string[]) => void; onCalibrate: (scenario: string) => void; remove: () => void;
}) {
  const P = op.pkg, S = P.scenario;
  const cov = useCoverage(op.id);
  const cat: CatalogEntry = P.catalog ?? defaultCatalog(P);
  const live: LiveSetup = P.live ?? defaultLive(P);
  const issues = validateOperation({ ...P, catalog: cat, live }, known);
  const errors = issues.filter((i) => i.level === 'error').length;
  const setCat = (c: Partial<CatalogEntry>) => void update(op, { catalog: { ...cat, ...c } });
  const setLive = (l: Partial<LiveSetup>) => void update(op, { live: { ...live, ...l } });
  const events = P.history.events ?? [];
  const areas = P.theatre.areas.map((a) => ({ id: a.id, name: areaTitle(a.name) })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const counts = { units: S.formations.filter((f) => f.type && f.position).length, orders: S.orders.length, pos: P.history.positions.length, ev: events.length };
  return <>
    <div className="mdl-h"><div><h3>{cat.title}</h3><span className="muted">{op.id} · {S.start.slice(0, 10)} — {S.end.slice(0, 10)}, ход {S.turnHours} ч · {op.ready ? '✓ в переигровке' : 'черновик'}</span></div>
      <div className="mdl-acts">
        <button onClick={() => void getInfra(op.id).then((inf) => download(`${op.id}.operation.json`, JSON.stringify(inf.length ? { ...P, infrastructure: inf } : P)))}>Скачать пакет</button>
        <button className="danger" onClick={remove}>Удалить</button>
      </div></div>
    <p className="muted">Формирований {counts.units}, приказов {counts.orders}; театр {P.theatre.name} (клетка {P.theatre.cellKm} км, районов {P.theatre.areas.length}); история: положений {counts.pos}, событий {counts.ev}.</p>
    <Issues issues={issues} />
    <div className="mdl-cols">
      <section className="mdl-card mdl-form">
        <h4>Игра и переигровка</h4>
        <label>Название <input value={cat.title} onChange={(e) => setCat({ title: e.target.value })} /></label>
        <label>Подпись <input value={cat.detail} onChange={(e) => setCat({ detail: e.target.value })} /></label>
        <label title="Сверх неопределённости исторического положения: положение «совпало», если ближе">Допуск сравнения, км <input type="number" min={0.5} step={0.5} value={cat.toleranceKm} onChange={(e) => setCat({ toleranceKm: +e.target.value || 1 })} /></label>
        <div className="mdl-pick"><span>Наборы правил в переигровке (первый — по умолчанию):</span>
          {d.rules.map((r) => { const on = cat.rules.some((x) => x.id === r.id); return <label key={r.id} className={on ? 'on' : ''}><input type="checkbox" checked={on} onChange={() => setCat({ rules: on ? cat.rules.filter((x) => x.id !== r.id) : [...cat.rules, { id: r.id, title: r.title }] })} />{r.title}</label>; })}</div>
        <label>Победа — событие истории <select value={cat.game?.victory.event ?? ''} onChange={(e) => { const ev = events.find((x) => x.id === e.target.value); if (ev) setCat({ game: { victory: { event: ev.id, title: ev.title }, defeat: cat.game?.defeat ?? { strengthBelow: 0.35, deadline: S.end, deadlineText: 'время операции вышло' } } }); }}>
          <option value="" disabled>—</option>{events.map((e) => <option key={e.id} value={e.id}>{e.title} ({e.date.slice(8, 10)}.{e.date.slice(5, 7)})</option>)}</select></label>
        {cat.game && <div className="mdl-grid">
          <label title="Доля численности от момента принятия командования">Поражение: силы ниже, % <input type="number" min={5} max={90} value={Math.round(cat.game.defeat.strengthBelow * 100)} onChange={(e) => setCat({ game: { ...cat.game!, defeat: { ...cat.game!.defeat, strengthBelow: (+e.target.value || 35) / 100 } } })} /></label>
          <label>Предельный срок <input type="datetime-local" value={cat.game.defeat.deadline.slice(0, 16)} onChange={(e) => setCat({ game: { ...cat.game!, defeat: { ...cat.game!.defeat, deadline: e.target.value } } })} /></label>
          <label className="wide">Если срок вышел <input value={cat.game.defeat.deadlineText} onChange={(e) => setCat({ game: { ...cat.game!, defeat: { ...cat.game!.defeat, deadlineText: e.target.value } } })} /></label>
        </div>}
      </section>
      <section className="mdl-card mdl-form">
        <h4>Штаб модели и советник</h4>
        <label>Модель командует стороной <select value={live.side} onChange={(e) => { const ai = S.sides.find((s) => s.id === e.target.value)!, hu = S.sides.find((s) => s.id !== ai.id)!; setLive({ side: ai.id, sideName: ai.name, profile: ai.profile, advisor: { ...(live.advisor ?? defaultLive(P).advisor!), side: hu.id, sideName: hu.name, profile: hu.profile } }); }}>
          {S.sides.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Роль модели <input value={live.role} onChange={(e) => setLive({ role: e.target.value })} placeholder="командующий …, кто подчинён" /></label>
        <label>Вышестоящее командование <input value={live.higher} onChange={(e) => setLive({ higher: e.target.value })} /></label>
        <label>О чём переигровка <input value={live.description} onChange={(e) => setLive({ description: e.target.value })} /></label>
        <label>Ограничения (по строке) <textarea rows={3} value={live.constraints.join('\n')} onChange={(e) => setLive({ constraints: e.target.value.split('\n').filter((x) => x.trim()) })} placeholder="приказы сверху, запреты, ожидания" /></label>
        <label title="От него в обстановке считаются расстояния и направления: «12 км к СЗ от …»">Опорный пункт <select value={live.anchor} onChange={(e) => { const a = areas.find((x) => x.id === e.target.value)!; setLive({ anchor: a.id, anchorName: a.name, advisor: live.advisor ? { ...live.advisor, anchor: a.id, anchorName: a.name } : undefined }); }}>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Роль советника человека <input value={live.advisor?.role ?? ''} onChange={(e) => setLive({ advisor: { ...(live.advisor ?? defaultLive(P).advisor!), role: e.target.value } })} /></label>
        <p className="muted small">Профиль стороны для промпта модели (доктрина, стиль) — из services/staff/profiles/&lt;профиль&gt;.md; для своих профилей — без него.</p>
      </section>
    </div>
    <CoveragePanel op={op.id} title={cat.title} />
    <section className="mdl-card">
      <h4>Контрольный прогон и подготовка</h4>
      {op.check ? <p>Прогон {op.check.at.slice(0, 10)} (3 × правила сценария «{S.rules}»): положений в допуске <b>{pct(op.check.within)}</b>, медиана превышения <b>{op.check.medianExcessKm} км</b>, события в ±2 сут: <b>{op.check.eventsHit} из {op.check.eventsTotal}</b>.</p>
        : <p className="muted">Ещё не было: прогон с историческими приказами покажет, насколько расчёт повторяет историю.</p>}
      <div className="row">
        <button disabled={!!busy || errors > 0} onClick={() => void control(op)}>{busy ? <><span className="spinner" /> {busy}</> : 'Контрольный прогон'}</button>
        <button disabled={errors > 0} onClick={() => onCalibrate(op.id)}>Калибровать правила по ней →</button>
        <button disabled={errors > 0} onClick={() => onCompare(op.id, cat.rules.map((r) => r.id).slice(0, 4))}>Сравнить наборы →</button>
        <span className="grow" />
        {op.ready ? <button onClick={() => void update(op, {}, { ready: false })}>Снять с переигровки</button>
          : <button className="primary" disabled={errors > 0 || !op.check} title={!op.check ? 'сначала контрольный прогон' : ''} onClick={() => { if (cov && cov.level === 'little' && !confirm(`Материалов по операции мало: ${Math.round(cov.score * 100)} % (${COVERAGE_LEVEL[cov.level]}). Всё равно подготовить к переигровке?`)) return; void update(op, { catalog: cat, live }, { ready: true }); }}>Подготовить к переигровке ✓</button>}
      </div>
      {op.ready && <p className="ok">Операция в «Переигровке»: расчёт, карта, принятие командования, советник, разбор.</p>}
    </section>
  <Materials op={op.id} title={cat.title} theatre={P.theatre} llm={llm} />
  </>;
}
