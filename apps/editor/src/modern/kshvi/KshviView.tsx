import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ExerciseClient,
  type CreateExerciseInput,
  type ExerciseCard,
  type ExerciseFilters,
  type ExerciseRevision,
  type ExerciseSession,
  type KshviClient,
} from './kshvi-api';
import { LibraryView, type LibraryExercise } from './LibraryView';
import { PreparationWorkspace } from './preparation/PreparationWorkspace';
import { ConductWorkspace } from './conduct/ConductWorkspace';
import './kshvi.css';

type KshviSection = 'library' | 'preparation' | 'conduct' | 'review' | 'archive' | 'admin';
const SECTION_KEY = 'def_ops.kshvi.section';
const LOCAL_EDITOR_KEY = 'def_ops.kshvi.local-editor';
const sections: readonly { id: KshviSection; label: string }[] = [
  { id: 'library', label: 'Библиотека' },
  { id: 'preparation', label: 'Подготовка' },
  { id: 'conduct', label: 'Проведение' },
  { id: 'review', label: 'Разбор' },
  { id: 'archive', label: 'Архив' },
];
const readAuthorities = ['exercise:read'];

function savedSection(canAdmin: boolean): KshviSection {
  try {
    const saved = localStorage.getItem(SECTION_KEY);
    if (sections.some(section => section.id === saved) || (saved === 'admin' && canAdmin)) return saved as KshviSection;
  } catch { /* выбор остаётся в текущем окне */ }
  return 'library';
}
function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Не удалось выполнить действие в КШВИ';
}
function intentOf(revision: ExerciseRevision): string {
  const payload = revision.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.intent === 'string') return payload.intent;
  return 'Замысел в этой редакции не заполнен';
}

function RevisionCompare({ card, onClose }: { card: ExerciseCard; onClose(): void }) {
  const [from, setFrom] = useState(card.revisions.at(-2)?.revision ?? card.revisions[0]?.revision ?? 1);
  const [to, setTo] = useState(card.revisions.at(-1)?.revision ?? card.revisions[0]?.revision ?? 1);
  const first = card.revisions.find(revision => revision.revision === from) ?? card.revisions[0];
  const second = card.revisions.find(revision => revision.revision === to) ?? card.revisions.at(-1);
  const panel = (revision: ExerciseRevision | undefined, label: string) => revision ? <article>
    <h3>Редакция {revision.revision}</h3>
    <p className="kshvi-revision-hash">SHA-256: {revision.sha256}</p>
    <p>{intentOf(revision)}</p>
    <details><summary>Содержимое редакции</summary><pre>{JSON.stringify(revision.payload, null, 2)}</pre></details>
    <label>{label}
      <select value={revision.revision} onChange={event => {
        const value = Number(event.target.value);
        if (label === 'Первая редакция') setFrom(value); else setTo(value);
      }}>
        {card.revisions.map(item => <option key={item.id} value={item.revision}>{item.revision} · {item.sha256.slice(0, 12)}</option>)}
      </select>
    </label>
  </article> : <p>Редакции ещё не созданы.</p>;
  return <section className="kshvi-compare" aria-labelledby="kshvi-compare-title">
    <div className="kshvi-compare-heading"><div><h2 id="kshvi-compare-title">Сравнение редакций</h2><p>{card.title}</p></div>
      <button type="button" onClick={onClose}>Закрыть сравнение</button></div>
    <div className="kshvi-compare-grid">{panel(first, 'Первая редакция')}{panel(second, 'Вторая редакция')}</div>
  </section>;
}

function LocalEditor() {
  const [draft] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(LOCAL_EDITOR_KEY) ?? 'null');
      return { title: typeof value?.title === 'string' ? value.title : '', intent: typeof value?.intent === 'string' ? value.intent : '' };
    } catch { return { title: '', intent: '' }; }
  });
  const [title, setTitle] = useState(draft.title);
  const [intent, setIntent] = useState(draft.intent);
  const [saved, setSaved] = useState(false);
  function save(event: FormEvent): void {
    event.preventDefault();
    localStorage.setItem(LOCAL_EDITOR_KEY, JSON.stringify({ title: title.trim(), intent, updatedAt: new Date().toISOString() }));
    setSaved(true);
  }
  return <section className="kshvi-local-editor" aria-labelledby="kshvi-local-title">
    <div className="kshvi-local-badge">Только этот компьютер</div>
    <h2 id="kshvi-local-title">Локальный одномашинный редактор</h2>
    <p>Автономный черновик сценария работает без сетевого сеанса и не является сетевым сеансом или многоуровневым учением с независимыми рабочими местами.</p>
    <form onSubmit={save}>
      <label>Название локального черновика<input value={title} onChange={event => { setTitle(event.target.value); setSaved(false); }} required /></label>
      <label>Замысел<textarea value={intent} onChange={event => { setIntent(event.target.value); setSaved(false); }} rows={5} /></label>
      <button className="kshvi-primary" type="submit">Сохранить локальный черновик</button>
    </form>
    {saved && <p role="status" className="kshvi-notice">Сохранено только на этом компьютере. Официальный мир и сетевой сеанс не создавались.</p>}
  </section>;
}

export function KshviView({ client: providedClient, authorities: providedAuthorities }: {
  client?: KshviClient;
  authorities?: readonly string[];
}) {
  const fallbackClient = useMemo(() => new ExerciseClient(), []);
  const client = providedClient ?? fallbackClient;
  const [serverAuthorities, setServerAuthorities] = useState<readonly string[]>(readAuthorities);
  const authorities = providedAuthorities ?? serverAuthorities;
  const can = useCallback((authority: string) => authorities.includes(authority), [authorities]);
  const canAdmin = can('kshvi:admin');
  const [activeTab, setActiveTab] = useState<KshviSection>(() => savedSection(providedAuthorities?.includes('kshvi:admin') ?? false));
  const [filters, setFilters] = useState<ExerciseFilters>({});
  const [items, setItems] = useState<readonly LibraryExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [comparison, setComparison] = useState<ExerciseCard | null>(null);
  const [session, setSession] = useState<ExerciseSession | null>(null);

  useEffect(() => {
    if (providedAuthorities) return;
    let current = true;
    void client.me().then(participant => {
      if (current && Array.isArray(participant.authorities)) setServerAuthorities(participant.authorities);
    }).catch(() => { /* библиотека остаётся доступна только для чтения */ });
    return () => { current = false; };
  }, [client, providedAuthorities]);

  const selectTab = useCallback((next: KshviSection) => {
    if (next === 'admin' && !can('kshvi:admin')) return;
    setActiveTab(next);
    setComparison(null);
    setNotice('');
    setError('');
    try { localStorage.setItem(SECTION_KEY, next); } catch { /* выбор остаётся в текущем окне */ }
  }, [can]);

  useEffect(() => {
    if (activeTab === 'admin' && !canAdmin) selectTab('library');
  }, [activeTab, canAdmin, selectTab]);

  useEffect(() => {
    if (activeTab !== 'library' && activeTab !== 'archive') return;
    let current = true;
    setLoading(true);
    setError('');
    const serverFilters = activeTab === 'archive' ? { ...filters, state: 'ARCHIVED' as const } : filters;
    void client.list(serverFilters).then(result => {
      if (current) setItems(result);
    }).catch(cause => {
      if (current) setError(errorText(cause));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [activeTab, client, filters, reload]);

  async function perform(action: () => Promise<unknown>, success: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
      setReload(value => value + 1);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function create(input: CreateExerciseInput): Promise<void> {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await client.create(input);
      setNotice('Изменения подтверждены сервером');
      setReload(value => value + 1);
    } catch (cause) {
      setError(errorText(cause));
      throw cause;
    } finally {
      setBusy(false);
    }
  }

  async function compare(item: LibraryExercise): Promise<void> {
    setBusy(true);
    setError('');
    try { setComparison(await client.getCard(item.id)); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function openSession(item: LibraryExercise): Promise<void> {
    if (!item.lastSessionId) return;
    setBusy(true);
    setError('');
    try {
      setSession(await client.getSession(item.id, item.lastSessionId));
      selectTab('conduct');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  const library = (archiveMode: boolean) => <LibraryView
    key={archiveMode ? 'archive' : 'library'}
    items={items}
    filters={archiveMode ? { ...filters, state: 'ARCHIVED' } : filters}
    archiveMode={archiveMode}
    loading={loading}
    busy={busy}
    notice={notice}
    error={error}
    onFiltersChange={next => { setComparison(null); setNotice(''); setFilters(next); }}
    onCreate={!archiveMode && can('exercise:create') ? create : undefined}
    onCopy={can('exercise:copy') ? item => void perform(() => client.copy(item.id), 'Копия создана и подтверждена сервером') : undefined}
    onCompare={can('exercise:read') ? item => void compare(item) : undefined}
    onArchive={!archiveMode && can('exercise:archive') ? item => void perform(() => client.archive(item.id, item.revision), 'Учение архивировано на сервере') : undefined}
    onOpenSession={can('exercise:read') ? item => void openSession(item) : undefined}
  />;

  return <section className="modern-kshvi" aria-label="Командно-штабные военные игры">
    <header className="kshvi-heading">
      <div><p className="kshvi-kicker">Современный режим · полный цикл</p><h1>КШВИ</h1>
        <p>Библиотека, подготовка, серверное проведение, разбор и повторное использование учений.</p></div>
      <div className="kshvi-authority"><span>Официальное состояние</span><strong>Подтверждает сервер</strong></div>
    </header>
    <nav className="kshvi-tabs" aria-label="Разделы КШВИ">
      {sections.map(section => <button key={section.id} type="button" aria-current={activeTab === section.id ? 'page' : undefined} onClick={() => selectTab(section.id)}>{section.label}</button>)}
      {canAdmin && <button type="button" aria-current={activeTab === 'admin' ? 'page' : undefined} onClick={() => selectTab('admin')}>Администрирование</button>}
    </nav>

    {activeTab === 'library' && library(false)}
    {activeTab === 'archive' && library(true)}
    {comparison && (activeTab === 'library' || activeTab === 'archive') && <RevisionCompare key={comparison.id} card={comparison} onClose={() => setComparison(null)} />}
    {activeTab === 'preparation' && <><LocalEditor /><PreparationWorkspace /></>}
    {activeTab === 'conduct' && <section className="kshvi-placeholder">
      <h2>Проведение</h2>
      {session ? <div className="kshvi-session-card"><h3>Сеанс {session.id}</h3><dl>
        <div><dt>Редакция сценария</dt><dd>{session.revision}</dd></div>
        <div><dt>Источник официального состояния</dt><dd>Сервер</dd></div>
        <div><dt>Подтверждённая ревизия мира</dt><dd>{session.confirmedRevision}</dd></div>
      </dl><p>Оптимистичные изменения браузера не считаются совершившимися до подтверждения серверной команды.</p></div>
        : <p>Выберите последний сеанс в карточке учения. Здесь отображаются только подтверждённые сервером ревизии.</p>}
      <ConductWorkspace />
    </section>}
    {activeTab === 'review' && <section className="kshvi-placeholder"><h2>Разбор</h2><p>Общий и частный разбор использует сохранённые редакции и серверные сеансы выбранного учения.</p></section>}
    {activeTab === 'admin' && canAdmin && <section className="kshvi-placeholder"><h2>Администрирование</h2><p>Раздел открыт по назначенному сервером полномочию. Содержание учения само по себе административное право не раскрывает.</p></section>}
  </section>;
}
