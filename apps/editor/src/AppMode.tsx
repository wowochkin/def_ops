/** Два независимых рабочих пространства. Исторические данные и расчёты при переключении сохраняются. */
import { lazy, Suspense, useState, type ReactNode } from 'react';

const ModernKnowledgeView = lazy(() => import('./modern/ModernKnowledgeView').then(m => ({ default: m.ModernKnowledgeView })));

const AtlasView = lazy(() => import('./modern/AtlasView').then(m => ({ default: m.AtlasView })));
const ReplayView = lazy(() => import('./modern/replay/ReplayView').then(m => ({ default: m.ReplayView })));
const KshviView = lazy(() => import('./modern/kshvi/KshviView').then(m => ({ default: m.KshviView })));

export type AppMode = 'historical' | 'modern';
type ModernSection = 'start' | 'knowledge' | 'weather' | 'atlas' | 'replay' | 'kshvi';
const MODE_KEY = 'def_ops.app.mode';
function readMode(): AppMode {
  try { return localStorage.getItem(MODE_KEY) === 'modern' ? 'modern' : 'historical'; }
  catch { return 'historical'; }
}

export function AppModeSwitch({ mode, onChange }: { mode: AppMode; onChange(mode: AppMode): void }) {
  return <div className="app-mode-switch" role="group" aria-label="Режим приложения">
    <button type="button" aria-pressed={mode === 'historical'} onClick={() => onChange('historical')}>Исторический режим</button>
    <button type="button" aria-pressed={mode === 'modern'} onClick={() => onChange('modern')}>Современный режим</button>
  </div>;
}

export function AppWorkspace({ historical }: { historical(active: boolean, onModeChange: (mode: AppMode) => void): ReactNode }) {
  const [mode, setMode] = useState<AppMode>(readMode);
  const [openedHistory, setOpenedHistory] = useState(mode === 'historical');
  const [modernSection, setModernSection] = useState<ModernSection>(() => {
    try { const saved = localStorage.getItem('def_ops.modern.section'); return saved === 'knowledge' || saved === 'weather' || saved === 'atlas' || saved === 'replay' || saved === 'kshvi' ? saved : 'start'; } catch { return 'start'; }
  });
  const openModern = (section: ModernSection) => {
    setModernSection(section);
    try { localStorage.setItem('def_ops.modern.section', section); } catch { /* выбор действует в текущем окне */ }
  };
  const change = (next: AppMode) => {
    if (next === 'historical') setOpenedHistory(true);
    setMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* выбор действует в текущем окне */ }
  };
  return <>
    {openedHistory && <div className="app-workspace" hidden={mode !== 'historical'}>
      {historical(mode === 'historical', change)}
    </div>}
    {mode === 'modern' && <main className="modern-workspace" aria-label="Современное рабочее пространство">
      <div className="workspace-toolbar"><span>Штабные игры</span><AppModeSwitch mode={mode} onChange={change} /></div>
      <nav className="modern-nav" aria-label="Разделы современного режима">
        <button type="button" aria-current={modernSection === 'start' ? 'page' : undefined} onClick={() => openModern('start')}>Начало</button>
        <button type="button" aria-current={modernSection === 'knowledge' ? 'page' : undefined} onClick={() => openModern('knowledge')}>База знаний</button>
        <button type="button" aria-current={modernSection === 'atlas' || modernSection === 'weather' ? 'page' : undefined} onClick={() => openModern('atlas')}>Карта и погода</button>
        <button type="button" aria-current={modernSection === 'kshvi' ? 'page' : undefined} onClick={() => openModern('kshvi')}>КШВИ</button>
        <button type="button" aria-current={modernSection === 'replay' ? 'page' : undefined} onClick={() => openModern('replay')}>Переигровка</button>
      </nav>
      {modernSection === 'replay' ? <Suspense fallback={<p className="modern-loading">Открываем переигровку…</p>}><ReplayView /></Suspense> : modernSection === 'kshvi' ? <Suspense fallback={<p className="modern-loading">Открываем КШВИ…</p>}><KshviView /></Suspense> : modernSection === 'weather' || modernSection === 'atlas' ? <Suspense fallback={<p className="modern-loading">Открываем карту и погоду…</p>}><AtlasView /></Suspense> : modernSection === 'knowledge' ? <Suspense fallback={<p className="modern-loading">Открываем базу знаний…</p>}><ModernKnowledgeView /></Suspense> : <section className="modern-welcome">
        <p className="modern-kicker">Рабочее пространство</p>
        <h1>Современный режим</h1>
        <p>Выберите область в атласе, изучите материалы о странах или начните двустороннюю переигровку.</p>
        <div className="modern-start-actions">
          <button className="modern-open-knowledge" type="button" onClick={() => openModern('replay')}>Открыть переигровку <span aria-hidden="true">→</span></button>
          <button className="modern-open-knowledge modern-secondary" type="button" onClick={() => openModern('knowledge')}>Открыть базу знаний <span aria-hidden="true">→</span></button>
        </div>
      </section>}
    </main>}
  </>;
}
