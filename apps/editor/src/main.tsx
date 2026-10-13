import { createRoot } from 'react-dom/client';
import '../demo/fonts';
import './styles.css';
import { Shell } from './Shell';

createRoot(document.getElementById('root')!).render(<Shell />);
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
