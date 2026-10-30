import { createRoot } from 'react-dom/client';
import '../demo/fonts';
import './styles.css';
import { settingsStore } from './expo/settings';
import { chooseRoot, expoWindowIndex } from './expo/routing';

const root = createRoot(document.getElementById('root')!);
async function mount(full = false) {
  const settings = await settingsStore().load();
  if (!full && chooseRoot(location.search, settings) !== 'shell') {
    const { ExpoRoot } = await import('./expo/ExpoRoot');
    root.render(<ExpoRoot index={expoWindowIndex(location.search) ?? 0} onExit={() => { void mount(true); }} />);
  } else {
    const [{ Shell }, { watchKb }] = await Promise.all([import('./Shell'), import('./sim/kb-recompile')]);
    root.render(<Shell />);
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
