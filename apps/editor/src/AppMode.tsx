/** Два независимых рабочих пространства. Исторические данные и расчёты при переключении сохраняются. */
import { lazy, Suspense, useCallback, useRef, useState, type ReactNode } from 'react';

const ModernKnowledgeView = lazy(() => import('./modern/ModernKnowledgeView').then(m => ({ default: m.ModernKnowledgeView })));

const AtlasView = lazy(() => import('./modern/AtlasView').then(m => ({ default: m.AtlasView })));
const ReplayView = lazy(() => import('./modern/replay/ReplayView').then(m => ({ default: m.ReplayView })));
const KshviView = lazy(() => import('./modern/kshvi/KshviView').then(m => ({ default: m.KshviView })));
const SymbolsView = lazy(() => import('./modern/symbols/SymbolsView').then(m => ({ default: m.SymbolsView })));

export type AppMode = 'historical' | 'modern';
type ModernSection = 'start' | 'knowledge' | 'weather' | 'atlas' | 'replay' | 'kshvi' | 'symbols';
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
    try { const saved = localStorage.getItem('def_ops.modern.section'); return saved === 'knowledge' || saved === 'weather' || saved === 'atlas' || saved === 'replay' || saved === 'kshvi' || saved === 'symbols' ? saved : 'start'; } catch { return 'start'; }
  });
  const navigationGuard = useRef<((action: () => void) => void) | null>(null);
  const [returnToExercise, setReturnToExercise] = useState(false);
  const registerNavigationGuard = useCallback((guard: ((action: () => void) => void) | null) => {
    navigationGuard.current = guard;
  }, []);
  const openModern = (section: ModernSection) => {
    setModernSection(section);
    try { localStorage.setItem('def_ops.modern.section', section); } catch { /* выбор действует в текущем окне */ }
  };
  const requestModern = (section: ModernSection, fromExercise = false) => {
    if (section === modernSection) return;
    const action = () => { setReturnToExercise(fromExercise); openModern(section); };
    if (navigationGuard.current) navigationGuard.current(action);
    else action();
  };
  const change = (next: AppMode) => {
    if (next === 'historical') setOpenedHistory(true);
    setMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* выбор действует в текущем окне */ }
  };
  const requestMode = (next: AppMode) => {
    if (next === mode) return;
    if (navigationGuard.current) navigationGuard.current(() => change(next));
    else change(next);
  };
  return <>
    {openedHistory && <div className="app-workspace" hidden={mode !== 'historical'}>
      {historical(mode === 'historical', change)}
    </div>}
    {mode === 'modern' && <main className="modern-workspace" aria-label="Современное рабочее пространство">
      <div className="workspace-toolbar"><span>Штабные игры</span><AppModeSwitch mode={mode} onChange={requestMode} /></div>
      <nav className="modern-nav" aria-label="Разделы современного режима">
        <button type="button" aria-current={modernSection === 'start' ? 'page' : undefined} onClick={() => requestModern('start')}>Начало</button>
        <button type="button" aria-current={modernSection === 'knowledge' ? 'page' : undefined} onClick={() => requestModern('knowledge')}>База знаний</button>
        <button type="button" aria-current={modernSection === 'atlas' || modernSection === 'weather' ? 'page' : undefined} onClick={() => requestModern('atlas')}>Карта и погода</button>
        <button type="button" aria-current={modernSection === 'kshvi' ? 'page' : undefined} onClick={() => requestModern('kshvi')}>КШВИ</button>
        <button type="button" aria-current={modernSection === 'symbols' ? 'page' : undefined} onClick={() => requestModern('symbols')}>Условные знаки</button>
      </nav>
      {returnToExercise && modernSection === 'atlas' && <button type="button" onClick={() => requestModern('kshvi')}>Вернуться в текущее учение</button>}
      {modernSection === 'replay' ? <Suspense fallback={<p className="modern-loading">Открываем переигровку…</p>}><ReplayView /></Suspense> : modernSection === 'symbols' ? <Suspense fallback={<p className="modern-loading">Открываем условные знаки…</p>}><SymbolsView /></Suspense> : modernSection === 'kshvi' ? <Suspense key="kshvi" fallback={<p className="modern-loading">Открываем КШВИ…</p>}><KshviView onOpenCartography={() => requestModern('atlas', true)} registerNavigationGuard={registerNavigationGuard} /></Suspense> : modernSection === 'weather' || modernSection === 'atlas' ? <Suspense key="atlas" fallback={<p className="modern-loading">Открываем карту и погоду…</p>}><AtlasView /></Suspense> : modernSection === 'knowledge' ? <Suspense fallback={<p className="modern-loading">Открываем базу знаний…</p>}><ModernKnowledgeView /></Suspense> : <section className="modern-welcome">
        <p className="modern-kicker">Рабочее пространство</p>
        <h1>Современный режим</h1>
        <p>Выберите область в атласе, изучите материалы о странах или начните двустороннюю переигровку.</p>
        <div className="modern-start-actions">
          <button className="modern-open-knowledge" type="button" onClick={() => requestModern('replay')}>Открыть переигровку <span aria-hidden="true">→</span></button>
          <button className="modern-open-knowledge modern-secondary" type="button" onClick={() => requestModern('knowledge')}>Открыть базу знаний <span aria-hidden="true">→</span></button>
        </div>
      </section>}
    </main>}
  </>;
}
