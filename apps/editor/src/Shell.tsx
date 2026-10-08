/**
 * Оболочка приложения: колонка разделов слева и рабочая область раздела.
 * Разделы: редактор карт, переигровка операций, карты-подложки, справочник знаков,
 * штаб (слой ИИ — в работе). Раздел запоминается в адресе (#editor, #replay…).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { emptyDocument, type MapDocument } from '@def-ops/core';
import { EditorView, type IncomingDoc } from './App';
import { ReplayView } from './ReplayView';
import { MapsPanel } from './MapsPanel';
import { BasemapControls, Icon } from './ui';
import { useBasemaps, useServer, type Basemaps, type ServerState } from './shared';

type Section = 'editor' | 'replay' | 'maps' | 'library' | 'staff';
const SECTIONS: { id: Section; title: string; icon: ReactNode; soon?: boolean }[] = [
  { id: 'editor', title: 'Редактор', icon: Icon.editor },
  { id: 'replay', title: 'Переигровка', icon: Icon.replay },
  { id: 'maps', title: 'Карты', icon: Icon.maps },
  { id: 'library', title: 'Знаки', icon: Icon.library },
  { id: 'staff', title: 'Штаб', icon: Icon.staff, soon: true },
];
const fromHash = (): Section => {
  const h = location.hash.replace('#', '') as Section;
  return SECTIONS.some((s) => s.id === h) ? h : ((localStorage.getItem('def_ops.section') as Section) || 'editor');
};

export function Shell() {
  const [section, setSection] = useState<Section>(fromHash);
  const bm = useBasemaps();
  const server = useServer();
  const [incoming, setIncoming] = useState<IncomingDoc | null>(null);
  // разделы, которые уже открывались, остаются смонтированными: карта и расчёт не теряются при переключении
  const [mounted, setMounted] = useState<Set<Section>>(() => new Set([section]));

  useEffect(() => {
    setMounted((m) => (m.has(section) ? m : new Set(m).add(section)));
    try { localStorage.setItem('def_ops.section', section); } catch { /* */ }
    if (location.hash !== `#${section}`) history.replaceState(null, '', `#${section}`);
  }, [section]);
  useEffect(() => { const h = () => setSection(fromHash()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);

  const toEditor = (doc: MapDocument) => { setIncoming({ doc, key: Date.now() }); setSection('editor'); };

  return (
    <div className="shell">
      <nav className="rail">
        <div className="rail-logo" title="Тактическая карта">ТК</div>
        {SECTIONS.map((s) => (
          <button key={s.id} className={`rail-btn${section === s.id ? ' on' : ''}`} onClick={() => setSection(s.id)} title={s.soon ? `${s.title} — в работе` : s.title}>
            {s.icon}<span>{s.title}</span>{s.soon && <i className="rail-soon" />}
          </button>
        ))}
        <span className={`rail-srv ${server.status}`} title={server.status === 'online' ? 'Сервер доступен' : server.status === 'offline' ? 'Сервер недоступен — работа в браузере' : 'Проверка сервера…'} />
      </nav>
      <div className="stage">
        {mounted.has('editor') && <div className="pane" hidden={section !== 'editor'}><EditorView bm={bm} server={server} incoming={incoming} /></div>}
        {mounted.has('replay') && <div className="pane" hidden={section !== 'replay'}><ReplayView bm={bm} onOpenInEditor={toEditor} /></div>}
        {section === 'maps' && <MapsView bm={bm} server={server} />}
        {section === 'library' && <iframe className="pane lib" src="/library.html" title="Справочник знаков" />}
        {section === 'staff' && <StaffView />}
      </div>
    </div>
  );
}

function MapsView({ bm, server }: { bm: Basemaps; server: ServerState }) {
  const doc = useMemo(() => emptyDocument(), []);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="page">
      <div className="page-in">
        <h2>Карты-подложки</h2>
        <p className="lead">Под знаками можно показать современную карту из интернета или свою: историческую карту, скан, тайловый архив. Локальные карты хранятся на сервере и работают без интернета.</p>
        <div className="cols">
          <section className="card"><BasemapControls bm={bm} /></section>
          <section className="card">
            <MapsPanel online={server.status === 'online' && server.services?.cartography === 'up'} doc={doc} selected={null} engine={null}
              onShow={(m) => { bm.setId(`local-${m.id}`); setNotice(`Подложка: ${m.name}`); }} onMaps={bm.setLocalMaps} notify={setNotice} />
            {server.status !== 'online' && <p className="muted">Локальные карты требуют сервера: <code>npm run dev:services</code> или <code>./scripts/start-local.sh</code>.</p>}
          </section>
        </div>
        {notice && <div className="toast" onClick={() => setNotice(null)}>{notice}</div>}
      </div>
    </div>
  );
}

function StaffView() {
  return (
    <div className="page">
      <div className="page-in narrow">
        <div className="soon-badge">в работе</div>
        <h2>Штаб</h2>
        <p className="lead">Немецкой стороной в переигровке будет командовать языковая модель на этом компьютере (LM Studio): на каждом ходе она получает обстановку, которую мог знать штаб на эту дату, и отдаёт приказы. Арбитр считает последствия, отчёт показывает, где решения модели увели операцию от истории.</p>
        <ul className="steps">
          <li><b>Готово</b> — подключение к модели, промпт немецкого штаба, схема решений, контрольные обстановки (<code>npm run llm:quick</code>).</li>
          <li><b>Далее</b> — ход за ходом в переигровке: «немецкая сторона: история / модель», журнал решений с обоснованиями.</li>
          <li><b>Затем</b> — диалог: вопросы к истории, к ходу игры и к «штабу» с опорой на базу знаний.</li>
        </ul>
      </div>
    </div>
  );
}
