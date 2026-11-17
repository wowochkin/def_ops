import { useRef, useState } from 'react';
import { downloadPortableLibrary, importPortableLibrary } from './library';

/** Доступно в установленном приложении: перенос знаний и пользовательских данных модели. */
export function PortableLibraryControls() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  async function run(action: () => Promise<string>) {
    setBusy(true); setFailed(false); setMessage('Подготовка библиотеки…');
    try { setMessage(await action()); }
    catch (e) { setFailed(true); setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <section aria-label="Перенос библиотеки">
    <h3>Пользовательская библиотека</h3>
    <p>Документы, факты, страницы, векторы поиска, свои операции, правила и сохранённые переигровки.</p>
    <div className="btns">
      <button disabled={busy} onClick={() => void run(async () => { const saved = await downloadPortableLibrary(); return saved.path ? `Библиотека сохранена: ${saved.path}` : 'Библиотека подготовлена для сохранения в user-library.json.'; })}>Экспортировать библиотеку</button>
      <button disabled={busy} onClick={() => fileInput.current?.click()}>Импортировать библиотеку</button>
      <input ref={fileInput} hidden type="file" accept=".json,application/json" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (file) void run(async () => {
          const result = await importPortableLibrary(JSON.parse(await file.text()));
          return result.alreadyImported ? 'Эта версия библиотеки уже импортирована.' : `Добавлено записей: ${result.imported}. Сохранено существующих: ${result.skipped}. Откройте нужный раздел заново, чтобы увидеть новые данные.`;
        });
      }} />
    </div>
    <p>Импорт добавляет отсутствующие записи. Ваши изменения сохраняются.</p>
    {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
  </section>;
}
