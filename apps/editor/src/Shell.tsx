/**
 * Оболочка приложения: колонка разделов слева и рабочая область раздела.
 * Разделы: редактор карт, переигровка операций, моделирование (правила, сравнение с историей, калибровка,
 * подготовка операций), карты-подложки, справочник знаков,
 * база знаний (материалы, загрузка документов, вопросы к модели),
 * ИИ (связь с моделями: штаб противника в игре, советник, база знаний). Раздел запоминается в адресе (#editor, #replay…).
 * Поверх разделов — панель голоса (voice/VoicePanel) и тур с подсветкой (voice/tour, voice/TourLayer; элементы — `data-tour="…"`).
 */
import { IN_APP, SERVICES_HINT } from './dialogs';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { emptyDocument, type MapDocument } from '@def-ops/core';
import { EditorView, type IncomingDoc } from './App';
import { ReplayView } from './ReplayView';
import { KnowledgeView } from './KnowledgeView';
import { ModelingView } from './modeling/ModelingView';
import { TheatreView } from './TheatreView';
import * as kb from './kb/kb';
import { MapsPanel } from './MapsPanel';
import { MapView } from './MapView';
import type { MapEngine } from './engine/types';
import type { MapSource } from '@def-ops/core';
import { SECTIONS, type Section } from './sections';
import { registerShellActions } from './voice/actions/shell';
import { VoicePanel } from './voice/VoicePanel';
import { TourLayer } from './voice/TourLayer';
import { ModelPicker } from './ModelPicker';
import { BasemapControls, Icon, ModelSelect } from './ui';
import { basemapDate } from './engine/basemaps';
import { useBasemaps, useLlm, useServer, type Basemaps, type Llm, type ServerState } from './shared';

export { SECTIONS };
const ICONS: Record<Section, ReactNode> = {
  editor: Icon.editor, replay: Icon.replay, modeling: Icon.modeling, maps: Icon.maps,
  library: Icon.library, knowledge: Icon.knowledge, staff: Icon.staff,
};
const fromHash = (): Section => {
  const h = location.hash.replace('#', '') as Section;
  return SECTIONS.some((s) => s.id === h) ? h : ((localStorage.getItem('def_ops.section') as Section) || 'editor');
};

export function Shell() {
  const [section, setSection] = useState<Section>(fromHash);
  const bm = useBasemaps();
  const server = useServer();
  const llm = useLlm();
  const [incoming, setIncoming] = useState<IncomingDoc | null>(null);
  // разделы, которые уже открывались, остаются смонтированными: карта и расчёт не теряются при переключении
  // база знаний: модель эмбеддингов из LM Studio — для смыслового поиска (и в разделе «Знания», и для советника)
  useEffect(() => { if (llm.check.state === 'ok' || llm.check.state === 'fail') kb.configure(llm.settings, llm.check.state === 'ok' ? llm.check.embedModels : null); }, [llm.settings, llm.check]);
  const [mounted, setMounted] = useState<Set<Section>>(() => new Set([section]));

  useEffect(() => {
    setMounted((m) => (m.has(section) ? m : new Set(m).add(section)));
    try { localStorage.setItem('def_ops.section', section); } catch { /* */ }
    if (location.hash !== `#${section}`) history.replaceState(null, '', `#${section}`);
  }, [section]);
  // голосовые действия оболочки (переход — через адрес, его слушает hashchange)
  const sectionRef = useRef(section);
  sectionRef.current = section;
  useEffect(() => registerShellActions({ section: () => sectionRef.current }), []);
  useEffect(() => { const h = () => setSection(fromHash()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);

  const toEditor = (doc: MapDocument) => { setIncoming({ doc, key: Date.now() }); setSection('editor'); };

  return (
    <div className="shell">
      <nav className="rail" data-tour="rail">
        <div className="rail-logo" title="Тактическая карта">ТК</div>
        {SECTIONS.map((s) => (
          <button key={s.id} className={`rail-btn${section === s.id ? ' on' : ''}`} data-tour={`rail-${s.id}`} onClick={() => setSection(s.id)} title={s.soon ? `${s.title} — в работе` : s.title}>
            {ICONS[s.id]}<span>{s.id === 'modeling' ? 'Модели\u00adрование' : s.title}</span>{s.soon && <i className="rail-soon" />}
          </button>
        ))}
        <span className={`rail-srv ${server.status}`} data-tour="rail-srv" title={server.status === 'online' ? 'Сервер доступен' : server.status === 'offline' ? 'Сервер недоступен — работа в браузере' : 'Проверка сервера…'} />
      </nav>
      <div className="stage">
        {mounted.has('editor') && <div className="pane" data-tour="section-editor" hidden={section !== 'editor'}><EditorView bm={bm} server={server} incoming={incoming} /></div>}
        {mounted.has('replay') && <div className="pane" data-tour="section-replay" hidden={section !== 'replay'}><ReplayView bm={bm} llm={llm} onOpenInEditor={toEditor} /></div>}
        {mounted.has('modeling') && <div className="pane" data-tour="section-modeling" hidden={section !== 'modeling'}><ModelingView llm={llm} /></div>}
        {section === 'maps' && <MapsView bm={bm} server={server} onOpenInEditor={toEditor} />}
        {section === 'library' && <iframe className="pane lib" data-tour="section-library" src="/library.html" title="Справочник знаков" />}
        {mounted.has('knowledge') && <div className="pane" data-tour="section-knowledge" hidden={section !== 'knowledge'}><KnowledgeView llm={llm} /></div>}
        {section === 'staff' && <StaffView llm={llm} />}
      </div>
      {/* голос — поверх любого раздела */}
      <VoicePanel section={section} llm={llm.settings} llmCheck={llm.check.state} recheck={llm.recheck} />
      <TourLayer section={section} />
    </div>
  );
}

function MapsView({ bm, server, onOpenInEditor }: { bm: Basemaps; server: ServerState; onOpenInEditor: (d: MapDocument) => void }) {
  const doc = useMemo(() => emptyDocument(), []);
  const [notice, setNotice] = useState<string | null>(null);
  const [eng, setEng] = useState<MapEngine | null>(null);
  const [tab, setTab] = useState<'base' | 'theatres'>(() => (localStorage.getItem('def_ops.maps.tab') as 'base' | 'theatres') || 'base');
  const go = (t: 'base' | 'theatres') => { setTab(t); try { localStorage.setItem('def_ops.maps.tab', t); } catch { /* */ } };
  const tabs = <nav className="maps-tabs"><button className={tab === 'base' ? 'on' : ''} onClick={() => go('base')}>Подложки</button><button className={tab === 'theatres' ? 'on' : ''} onClick={() => go('theatres')}>Театры</button></nav>;
  /** Вид — на охват карты: целиком в окне, не мельче её наименьшего уровня (тайлы 256 px видны с уровня движка minzoom − 1). */
  const showArea = (m: MapSource) => {
    if (!eng) return;
    const { width, height } = eng.size();
    const [w, s, e, n] = m.bounds;
    const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
    const fit = Math.min(Math.log2((360 * width) / (512 * Math.max(1e-6, e - w))), Math.log2((360 * height * k) / (512 * Math.max(1e-6, n - s))));
    eng.setView({ center: [(w + e) / 2, (s + n) / 2], zoom: Math.min(m.maxzoom - 1, Math.max(m.minzoom - 0.7, fit - 0.2)) });
  };
  if (tab === 'theatres') return <div className="pane maps-pane" data-tour="section-maps">{tabs}<div className="maps-body"><TheatreView bm={bm} onOpenInEditor={onOpenInEditor} /></div></div>;
  return (
    <div className="pane maps-pane" data-tour="section-maps">
      {tabs}
      <div className="maps-base">
        <aside className="maps-base-side">
          <h2>Карты-подложки</h2>
          <p className="muted small">Под знаками — современная карта из интернета или своя: историческая карта, скан, тайловый архив. Локальные карты хранятся на сервере и работают без интернета. Справа — как выглядит выбранная подложка.</p>
          <section className="card"><BasemapControls bm={bm} /></section>
          <section className="card">
            <MapsPanel online={server.status === 'online' && server.services?.cartography === 'up'} doc={doc} selected={null} engine={eng}
              onShow={(m) => { bm.setId(`local-${m.id}`); showArea(m); setNotice(`Подложка: ${m.name}`); }} onArea={showArea} onMaps={bm.setLocalMaps} notify={setNotice} />
            {server.status !== 'online' && <p className="muted">Локальные карты требуют сервисов: {SERVICES_HINT}.</p>}
          </section>
        </aside>
        <main className="maps-base-map">
          <MapView doc={doc} setDoc={() => {}} selected={null} setSelected={() => {}} selectedOverlay={null} tool={{ mode: 'select' }} setTool={() => {}} activeLayer={null}
            basemap={bm.current} basemapOpacity={bm.current ? 1 : bm.opacity} basemapDate={basemapDate(bm.current, null, bm.year)} onEngineReady={setEng} onStatus={() => {}} time={null} newFromNow={false} />
          {!bm.current && <div className="maps-base-hint">Подложка не выбрана — выберите слева или нажмите «подложить» у локальной карты.</div>}
        </main>
        {notice && <div className="toast" onClick={() => setNotice(null)}>{notice}</div>}
      </div>
    </div>
  );
}

function StaffView({ llm }: { llm: Llm }) {
  const { settings, set, check, recheck } = llm;
  return (
    <div className="page" data-tour="section-staff">
      <div className="page-in narrow">
        <h2>ИИ</h2>
        <p className="lead">Немецкой стороной в игре командует языковая модель на этом компьютере (LM Studio). Игра начинается в «Переигровке»: выберите момент на шкале времени и нажмите «Принять командование». С этого хода советской стороной командуете вы, немецкой — модель, до конца операции. На каждом ходу модель получает обстановку, которую мог знать немецкий штаб: свои войска, противника в пределах разведки, итоги суток. Она отдаёт приказы, а арбитр считает их последствия так же, как исторические.</p>
        <section className="card staff-cfg">
          <h3>Связь с моделью</h3>
          <label>Адрес сервера
            <input value={settings.url} onChange={(e) => set({ url: e.target.value })} spellCheck={false} />
            <small>По умолчанию <code>/llm/v1</code> — к LM Studio на этом компьютере (<code>localhost:1234</code>) через {IN_APP ? 'сервисы приложения' : 'сервер разработки'}; другой сервер — полным адресом здесь, например <code>http://192.168.1.10:1234/v1</code>.</small>
          </label>
          <label>Модель
            <ModelSelect value={settings.model} onChange={(model) => set({ model })} check={check} empty={`первая загруженная${check.state === 'ok' ? ` (${check.models[0]})` : ''}`} />
            <small>Варианты одной модели (4bit, 8bit) загрузите в LM Studio под своими именами (например, qwen-4bit и qwen-8bit) — они появятся в списке среди загруженных. Модели по всем ролям — и в разделе «Моделирование».</small>
          </label>
          <label>Размышление перед ответом
            <select value={settings.thinking} onChange={(e) => set({ thinking: e.target.value as typeof settings.thinking })}>
              <option value="off">нет — быстрее, решение за 1–2 минуты</option>
              <option value="low">короткое</option>
              <option value="medium">обычное — глубже, но в разы дольше</option>
              <option value="high">глубокое</option>
            </select>
          </label>
          <div className="staff-st">
            <span className={`llm-st ${check.state}`}>{check.state === 'ok' ? `✓ на связи · моделей: ${check.models.length}` : check.state === 'fail' ? `✗ ${check.error}` : 'проверка…'}</span>
            <button onClick={recheck}>Проверить связь</button>
          </div>
        </section>
        <section className="card staff-cfg staff-voice">
          <h3>Голос</h3>
          <div className="staff-voice-row" role="group" aria-label="Модель для голоса">
            <span>Модель для голоса и размышление</span>
            <ModelPicker llm={llm} who="voice" purpose="голоса" />
            <small>Что начальник штаба не понял по готовым правилам, разбирает эта модель: выбирает подходящее действие или честно отвечает, что такого нет. Ответ нужен быстро — подойдёт небольшая модель без размышления.</small>
          </div>
        </section>
        <section className="card staff-help">
          <h3>Как подготовить</h3>
          <ol className="steps">
            <li>LM Studio → загрузите модель (Qwen 27B, 4 бит) → вкладка Developer → <b>Start Server</b>. Длина контекста — не меньше 16 000 токенов.</li>
            <li>Здесь нажмите «Проверить связь» — должна появиться модель.</li>
            <li>Разработчикам: без LM Studio проверить стенд можно на подставной модели: <code>npm run llm:mock</code> в отдельном терминале. Её решения простые, для проверки интерфейса.</li>
          </ol>
          <h3>Что видит и делает модель</h3>
          <ul className="steps">
            <li>Обстановку на утро хода: доклады своих соединений, разведсводку о противнике в пределах разведки, итоги суток, пункты вблизи войск, действующие ограничения (приказы фюрера и т. п.).</li>
            <li>Отвечает решением штаба: оценка обстановки, замысел противника, свой замысел, приказы соединениям, доклады наверх, риски. Приказы доходят до войск с той же задержкой, что и в истории.</li>
            <li>Все решения — во вкладке «Посредник» игры и в журнале. Их можно разобрать с экспертами после игры.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
