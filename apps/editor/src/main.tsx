import { createRoot } from 'react-dom/client';
import '../demo/fonts';
import './styles.css';
import { settingsStore } from './expo/settings';
import { chooseRoot, expoWindowIndex } from './expo/routing';
import { IN_APP } from './dialogs';
import { PortableGate } from './portable/Setup';
import { PORTABLE_SETUP_KEY } from './portable/setup-state';
import { loadPortableStress } from './portable/stress';
import { importPortableLibraryFromUrl } from './portable/library';

const root = createRoot(document.getElementById('root')!);
let prepared = false;
let stressWarning = '';
async function mount(full = false) {
  const primary = (expoWindowIndex(location.search) ?? 0) === 0;
  if (!prepared) {
    if (IN_APP && primary) {
      try { await importPortableLibraryFromUrl(); }
      catch (e) {
        root.render(<div className="portable-backdrop"><section className="portable-panel" role="alert"><h2>Библиотека не установлена</h2><p>Импорт не завершён. Приложение не запущено, чтобы сохранить данные.</p><p>{String(e)}</p><button onClick={() => void mount(full)}>Повторить импорт</button></section></div>);
        return;
      }
    }
    await loadPortableStress().catch(e => { if (IN_APP) stressWarning = `Пользовательский словарь не загружен: ${String(e)}`; });
    prepared = true;
  }
  let firstRun = false;
  try { firstRun = IN_APP && primary && localStorage.getItem(PORTABLE_SETUP_KEY) !== '1'; } catch { firstRun = IN_APP && primary; }
  const wrap = (view: import('react').ReactNode) => <PortableGate firstRun={firstRun} startupError={stressWarning}>{view}</PortableGate>;
  const settings = await settingsStore().load();
  if (!full && chooseRoot(location.search, settings) !== 'shell') {
    const { ExpoRoot } = await import('./expo/ExpoRoot');
    root.render(wrap(<ExpoRoot index={expoWindowIndex(location.search) ?? 0} onExit={() => { void mount(true); }} />));
  } else {
    const [{ Shell }, { watchKb }] = await Promise.all([import('./Shell'), import('./sim/kb-recompile')]);
    root.render(wrap(<Shell />));
    watchKb();
  }
}
void mount();
// Backspace вне поля ввода в окне приложения (WebKit) листает историю назад — со страницы редактора на страницу запуска.
// Свои действия редактора по Backspace (удалить знак, точку) срабатывают раньше — на всплытии до окна; здесь только
// запрет перехода по истории.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Backspace' || e.defaultPrevented) return;
  const t = e.target as HTMLElement | null;
  const editable = !!t && (t.isContentEditable || (t instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(t.type)) || t instanceof HTMLTextAreaElement || (t instanceof HTMLSelectElement));
  if (!editable) e.preventDefault();
});
document.fonts.ready.then(() => document.body.setAttribute('data-ready', '1'));
