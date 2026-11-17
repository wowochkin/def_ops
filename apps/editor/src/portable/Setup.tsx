import { useEffect, useRef, useState, type ReactNode } from 'react';
import { checkLlm, loadLlm, saveLlm, type LlmCheck } from '../shared';
import { ModelSelect } from '../ui';
import type { LlmSettings } from '../sim/game-protocol';
import { OPEN_PORTABLE_SETUP, PORTABLE_SETUP_KEY, probeSetup, type SetupProbe } from './setup-state';
import { loadPortableStress, savePortableStress } from './stress';
import { PortableLibraryControls } from './LibraryControls';
import './setup.css';

export function PortableGate({ firstRun, children, startupError = '' }: { firstRun: boolean; children: ReactNode; startupError?: string }) {
  const [ready, setReady] = useState(!firstRun);
  const [open, setOpen] = useState(firstRun);
  useEffect(() => { const show = () => setOpen(true); window.addEventListener(OPEN_PORTABLE_SETUP, show); return () => window.removeEventListener(OPEN_PORTABLE_SETUP, show); }, []);
  return <>{ready && children}{open && <Setup firstRun={!ready} startupError={startupError} onClose={() => { setReady(true); setOpen(false); }} />}</>;
}

function Setup({ firstRun, startupError, onClose }: { firstRun: boolean; startupError: string; onClose: () => void }) {
  const [tab, setTab] = useState<'models' | 'dictionary' | 'library'>('models');
  const [draft, setDraft] = useState<LlmSettings>(loadLlm);
  const [check, setCheck] = useState<LlmCheck>({ state: 'unknown' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [probes, setProbes] = useState<SetupProbe[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const patch = (p: Partial<LlmSettings>) => { setDraft(d => ({ ...d, ...p })); setProbes([]); setError(''); if (p.url !== undefined) setCheck({ state: 'unknown' }); };
  const discover = async () => {
    setBusy(true); setError(''); setCheck({ state: 'checking' });
    try { setCheck(await checkLlm(draft.url)); } finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true); setError(''); setProbes([]);
    try {
      const results = await probeSetup(draft, fetch, p => setProbes(prev => [...prev, p]));
      saveLlm({ ...loadLlm(), ...draft, url: draft.url.trim(), embedDims: results.at(-1)!.dims });
      localStorage.setItem(PORTABLE_SETUP_KEY, '1');
      onClose();
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  };
  return <div className="portable-backdrop"><section className="portable-panel" role="dialog" aria-modal="true" aria-labelledby="portable-title">
    <header><div><p className="portable-kicker">Настройка приложения</p><h2 id="portable-title" ref={heading} tabIndex={-1}>{firstRun ? 'Подготовка к первому запуску' : 'Модели, словарь и библиотека'}</h2></div><button disabled={busy} onClick={onClose} aria-label="Закрыть настройку">Закрыть</button></header>
    {startupError && <p role="alert" className="portable-error">{startupError}</p>}
    <nav aria-label="Настройки приложения">{([['models', 'Модели'], ['dictionary', 'Словарь ударений'], ['library', 'Библиотека']] as const).map(([id, label]) => <button key={id} disabled={busy} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === 'models' && <>
      <p>Откройте LM Studio, скачайте совместимую модель для диалога и Qwen3-Embedding для поиска. Во вкладке Developer запустите сервер. Для основного и голосового ответа можно выбрать одну модель.</p>
      <fieldset disabled={busy} className="portable-fields">
        <label>Адрес API<input value={draft.url} onChange={e => patch({ url: e.target.value })} spellCheck={false} /></label>
        <small>На этом компьютере: /llm/v1. Другой сервер — полный адрес http://адрес:порт/v1 с разрешённым CORS.</small>
        <button onClick={() => void discover()}>Получить список моделей</button>
        {check.state === 'fail' && <p className="portable-error" role="alert">{check.error}</p>}
        <label>Основная модель<ModelSelect value={draft.model} onChange={model => patch({ model })} check={check} empty="Выберите явно…" /></label>
        <label>Голосовая модель<ModelSelect value={draft.voiceModel ?? ''} onChange={voiceModel => patch({ voiceModel })} check={check} empty="Выберите явно…" /></label>
        <label>Модель embeddings<input list="portable-embeddings" value={draft.embedModel === 'off' ? '' : draft.embedModel ?? ''} onChange={e => patch({ embedModel: e.target.value })} placeholder="Выберите или введите идентификатор модели" spellCheck={false} /></label>
        <datalist id="portable-embeddings">{check.state === 'ok' && check.embedModels.map(m => <option key={m} value={m} />)}</datalist>
      </fieldset>
      <p className="portable-hint">Проверка отправит два запроса диалога и запрос embeddings. При смене модели поиска векторы будут рассчитаны заново в разделе «Знания»; первый расчёт может занять время.</p>
      <div aria-live="polite">{probes.map(p => <p key={p.role}>✓ {p.role}: {p.model}{p.dims ? `, размерность ${p.dims}` : ''}</p>)}{busy && <p>Проверяем подключение и ответы…</p>}</div>
      {error && <p role="alert" className="portable-error">{error}</p>}
      <footer><button disabled={busy || !draft.model || !draft.voiceModel || !draft.embedModel || draft.embedModel === 'off'} className="portable-primary" onClick={() => void apply()}>Проверить и сохранить</button>{firstRun && <button disabled={busy} onClick={onClose}>Настроить позже</button>}</footer>
    </>}
    {tab === 'dictionary' && <Dictionary />}
    {tab === 'library' && <PortableLibraryControls />}
  </section></div>;
}

interface LexiconEntry { word: string; say: string | null; suggestion: string | null; status: string; sources: string[]; examples: string[] }
function Dictionary() {
  const [entries, setEntries] = useState<LexiconEntry[]>([]);
  const [query, setQuery] = useState('');
  const [word, setWord] = useState('');
  const [say, setSay] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const load = async () => {
    await loadPortableStress();
    const r = await fetch('/api/portable/lexicon', { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Каталог слов недоступен: ${r.status}`);
    const data = await r.json() as { entries: LexiconEntry[] }; setEntries(data.entries);
  };
  useEffect(() => { setBusy(true); void load().catch(e => setError(String(e))).finally(() => setBusy(false)); }, []);
  const save = async () => {
    setBusy(true); setError(''); setMessage('');
    try { await savePortableStress(word, say); await load(); setMessage(`«${word}» сохранено. Новая живая озвучка использует исправление; готовые аудиофайлы требуют переозвучки.`); }
    catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  };
  const rows = entries.filter(e => (!onlyMissing || e.status === 'missing') && e.word.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));
  return <>
    <p>Исправления сохраняются в папке данных приложения и переживают обновление. «+» перед гласной задаёт ударение: Х+альбе. Подсказки применяются только после сохранения.</p>
    <div className="portable-dict-filter"><label>Найти слово<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Название или слово" /></label><label><input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} /> Без ударения</label></div>
    <p className="portable-hint">Найдено: {rows.length}. Показаны первые 80; уточните поиск.</p>
    <div className="portable-dict-table"><table><thead><tr><th>Слово</th><th>Ударение</th><th>Правка</th></tr></thead><tbody>{rows.slice(0, 80).map(e => <tr key={e.word}><td>{e.word}<small>{e.sources.join(' · ')}</small></td><td>{e.say ?? (e.suggestion ? `Подсказка: ${e.suggestion}` : 'Не задано')}</td><td><button disabled={busy} onClick={() => { setWord(e.word); setSay(e.say ?? e.suggestion ?? ''); setMessage(''); }}>Выбрать</button></td></tr>)}</tbody></table></div>
    <form className="portable-word-form" onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={busy}><legend>Добавить или исправить слово</legend><label>Слово без ударения<input value={word} onChange={e => setWord(e.target.value)} required maxLength={120} /></label><label>Произношение<input value={say} onChange={e => setSay(e.target.value)} placeholder="Поставьте + перед гласной" maxLength={140} /></label><small>Пустое произношение оставляет запись для последующей правки.</small><button disabled={!word.trim()} className="portable-primary">Сохранить слово</button></fieldset></form>
    {busy && <p aria-live="polite">Работа со словарём…</p>}{error && <p className="portable-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </>;
}
