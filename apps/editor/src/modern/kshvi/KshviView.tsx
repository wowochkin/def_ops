import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ExerciseClient,
  type AdminOverview,
  type ArchiveRecord,
  type CreateExerciseInput,
  type DebriefRecord,
  type ExerciseCard,
  type ExerciseFilters,
  type ExerciseRevision,
  type ExerciseSession,
  type ExpositionRecord,
  type KshviClient,
  type ReplayFrame,
  type SessionCommand,
} from './kshvi-api';
import { LibraryView, type LibraryExercise } from './LibraryView';
import { LoginPanel } from './LoginPanel';
import { readWorkspaceReference, WORKSPACE_EXERCISE_KEY, WORKSPACE_SESSION_KEY, writeWorkspaceReference } from './workspace-session';
import { PreparationWorkspace } from './preparation/PreparationWorkspace';
import { ConductWorkspace } from './conduct/ConductWorkspace';
import { ReplayWorkspace } from './replay/ReplayWorkspace';
import { ReviewWorkspace } from './assessment/ReviewWorkspace';
import { ArchiveWorkspace } from './archive/ArchiveWorkspace';
import { AdminWorkspace } from './admin/AdminWorkspace';
import { BrowserExpositionApp } from './exposition/browser-entry';
import './kshvi.css';

type KshviSection = 'library' | 'preparation' | 'conduct' | 'replay' | 'review' | 'archive' | 'exposition' | 'admin';
const SECTION_KEY = 'def_ops.kshvi.section';
const LOCAL_EDITOR_KEY = 'def_ops.kshvi.local-editor';
const sections: readonly { id: KshviSection; label: string }[] = [
  { id: 'library', label: 'Библиотека' },
  { id: 'preparation', label: 'Подготовка' },
  { id: 'conduct', label: 'Проведение' },
  { id: 'replay', label: 'Реплей' },
  { id: 'review', label: 'Разбор' },
  { id: 'archive', label: 'Архив' },
  { id: 'exposition', label: 'Показ' },
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

export function KshviView({ client: providedClient, authorities: providedAuthorities, role: providedRole }: {
  client?: KshviClient;
  authorities?: readonly string[];
  role?: string;
}) {
  const fallbackClient = useMemo(() => new ExerciseClient(), []);
  const client = providedClient ?? fallbackClient;
  const [serverAuthorities, setServerAuthorities] = useState<readonly string[]>(readAuthorities);
  const [serverRole, setServerRole] = useState(providedRole ?? 'TRAINEE');
  const [serverUserId, setServerUserId] = useState('UNKNOWN');
  const [authenticated, setAuthenticated] = useState(Boolean(providedAuthorities));
  const authorities = providedAuthorities ?? serverAuthorities;
  const role = providedRole ?? serverRole;
  const can = useCallback((authority: string) => authorities.includes(authority), [authorities]);
  const canAdmin = can('kshvi:admin');
  const [activeTab, setActiveTab] = useState<KshviSection>(() => savedSection(providedAuthorities?.includes('kshvi:admin') ?? false));
  const [filters, setFilters] = useState<ExerciseFilters>({});
  const [items, setItems] = useState<readonly LibraryExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [comparison, setComparison] = useState<ExerciseCard | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<LibraryExercise | null>(() => readWorkspaceReference(WORKSPACE_EXERCISE_KEY));
  const [session, setSession] = useState<ExerciseSession | null>(() => readWorkspaceReference(WORKSPACE_SESSION_KEY));
  const [replayFrame, setReplayFrame] = useState<ReplayFrame | null>(null);
  const [debrief, setDebrief] = useState<DebriefRecord | null>(null);
  const [archiveRecord, setArchiveRecord] = useState<ArchiveRecord | null>(null);
  const [exposition, setExposition] = useState<ExpositionRecord | null>(null);
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);

  useEffect(() => { writeWorkspaceReference(WORKSPACE_EXERCISE_KEY, selectedExercise); }, [selectedExercise]);
  useEffect(() => { writeWorkspaceReference(WORKSPACE_SESSION_KEY, session); }, [session]);
  useEffect(() => {
    let current = true;
    const exercise = readWorkspaceReference<LibraryExercise>(WORKSPACE_EXERCISE_KEY);
    const activeSession = readWorkspaceReference<ExerciseSession>(WORKSPACE_SESSION_KEY);
    if (exercise) {
      void client.getCard(exercise.id).then(card => {
        if (current) setSelectedExercise(card);
      }).catch(() => {
        if (current) { setSelectedExercise(null); setSession(null); }
      });
      if (activeSession) void client.getSession(exercise.id, activeSession.id).then(confirmed => {
        if (current) setSession(confirmed);
      }).catch(() => { if (current) setSession(null); });
    }
    return () => { current = false; };
  }, [client]);

  useEffect(() => {
    if (providedAuthorities) return;
    let current = true;
    void client.me().then(participant => {
      if (!current) return;
      if (Array.isArray(participant.authorities)) setServerAuthorities(participant.authorities);
      setServerUserId(participant.userId);
      if (participant.activeRole) {
        setServerRole(participant.activeRole);
        setAuthenticated(true);
      }
    }).catch(() => { if (current) setAuthenticated(false); });
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
    if (!providedAuthorities && !authenticated) return;
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
  }, [activeTab, authenticated, client, filters, providedAuthorities, reload]);

  useEffect(() => {
    if (activeTab === 'replay' && session && selectedExercise) {
      let current = true;
      setSectionLoading(true);
      void client.replay(selectedExercise.id, session.id, { cursor: session.confirmedRevision, perspective: 'PARTICIPANT' })
        .then(frame => { if (current) setReplayFrame(frame); })
        .catch(cause => { if (current) setError(errorText(cause)); })
        .finally(() => { if (current) setSectionLoading(false); });
      return () => { current = false; };
    }
    if (activeTab === 'review' && session && selectedExercise) {
      let current = true;
      setSectionLoading(true);
      const scope = can('TRUTH_READ') ? 'GENERAL' : 'PRIVATE';
      void client.debrief(selectedExercise.id, session.id, scope)
        .then(record => { if (current) setDebrief(record); })
        .catch(cause => { if (current) setError(errorText(cause)); })
        .finally(() => { if (current) setSectionLoading(false); });
      return () => { current = false; };
    }
    if (activeTab === 'exposition' && archiveRecord) {
      let current = true;
      setSectionLoading(true);
      void client.exposition(archiveRecord.archiveId)
        .then(record => { if (current) setExposition(record); })
        .catch(cause => { if (current) setError(errorText(cause)); })
        .finally(() => { if (current) setSectionLoading(false); });
      return () => { current = false; };
    }
    if (activeTab === 'admin' && canAdmin) {
      let current = true;
      setSectionLoading(true);
      void client.adminOverview()
        .then(record => { if (current) setAdminOverview(record); })
        .catch(cause => { if (current) setError(errorText(cause)); })
        .finally(() => { if (current) setSectionLoading(false); });
      return () => { current = false; };
    }
  }, [activeTab, archiveRecord, can, canAdmin, client, reload, selectedExercise, session]);

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

  function openWorkflow(item: LibraryExercise): void {
    setSelectedExercise(item);
    setSession(null);
    setReplayFrame(null);
    setDebrief(null);
    setArchiveRecord(null);
    setExposition(null);
    selectTab('preparation');
  }

  async function openSession(item: LibraryExercise): Promise<void> {
    if (!item.lastSessionId) return;
    setBusy(true);
    setError('');
    try {
      setSelectedExercise(item);
      setSession(await client.getSession(item.id, item.lastSessionId));
      selectTab('conduct');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function startOfficialSession(): Promise<void> {
    if (!selectedExercise || !can('exercise:conduct')) return;
    if (selectedExercise.state !== 'SEALED') {
      setError('Официальный сеанс запускается только после фиксации сценария SEALED');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const started = await client.createSession(selectedExercise.id, { revision: selectedExercise.revision });
      setSession(started);
      selectTab('conduct');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function executeCommand(command: SessionCommand): Promise<string> {
    if (!session || !selectedExercise) throw new Error('Сначала выберите официальный сеанс');
    if (command === 'JUMP') throw new Error('Для скачка нужны целевое время, расчёт и отдельное утверждение; команда не отправлялась');
    const confirmed = await client.command(selectedExercise.id, session.id, {
      command, expectedRevision: session.confirmedRevision,
      idempotencyKey: `${session.id}-${command}-${session.confirmedRevision + 1}`,
    });
    setSession(confirmed);
    setReplayFrame(null);
    return `Серверная ревизия ${confirmed.confirmedRevision}: ${confirmed.state}`;
  }

  async function handleHandover(): Promise<void> {
    try { await client.logout(); }
    finally {
      setSession(null);
      setSelectedExercise(null);
      setReplayFrame(null);
      setDebrief(null);
      setArchiveRecord(null);
      setExposition(null);
      setServerAuthorities([]);
      setServerRole('UNKNOWN');
      setAuthenticated(false);
      selectTab('library');
    }
  }

  async function approveAssessment(value: { finalAssessment: string; comment: string }): Promise<void> {
    if (!session || !selectedExercise) return;
    await perform(() => client.approveAssessment(selectedExercise.id, session.id, { ...value, idempotencyKey: `assessment-${session.id}` }), 'Оценка подтверждена сервером и включена в материалы разбора');
  }

  async function archiveCompleted(): Promise<void> {
    if (!session || !selectedExercise || session.state !== 'COMPLETED') {
      setError('Архив создаётся только после серверного завершения сеанса');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const archive = await client.createArchive(selectedExercise.id, session.id);
      await client.archive(selectedExercise.id, selectedExercise.revision);
      setArchiveRecord(archive);
      setSelectedExercise({ ...selectedExercise, state: 'ARCHIVED' });
      setReload(value => value + 1);
      selectTab('archive');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function exportArchive(): Promise<void> {
    if (!archiveRecord) return;
    await perform(async () => {
      const bundle = await client.exportArchive(archiveRecord.archiveId);
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${archiveRecord.archiveId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    }, 'Архивный пакет выгружен с проверенным манифестом');
  }

  function adminMutation(action: () => Promise<unknown>, message: string): void {
    void perform(action, message);
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
    onOpenWorkflow={!archiveMode && can('exercise:read') ? openWorkflow : undefined}
  />;

  if (!providedAuthorities && !authenticated) return <section className="modern-kshvi" aria-label="Командно-штабные военные игры">
    <h1>КШВИ</h1>
    <LoginPanel client={client} onAuthenticated={participant => {
      if (!participant.activeRole) { setAuthenticated(false); return; }
      setServerAuthorities(participant.authorities);
      setServerUserId(participant.userId);
      setServerRole(participant.activeRole);
      setAuthenticated(true);
      setReload(value => value + 1);
    }} />
  </section>;

  return <section className="modern-kshvi" aria-label="Командно-штабные военные игры">
    <header className="kshvi-heading">
      <div><p className="kshvi-kicker">Современный режим · полный цикл</p><h1>КШВИ</h1>
        <p>Библиотека, подготовка, серверное проведение, реплей, разбор, архив и экспозиция.</p></div>
      <div className="kshvi-authority"><span>Официальное состояние</span><strong>Подтверждает сервер</strong></div>
    </header>
    <nav className="kshvi-tabs" aria-label="Разделы КШВИ">
      {sections.map(section => <button key={section.id} type="button" aria-current={activeTab === section.id ? 'page' : undefined} onClick={() => selectTab(section.id)}>{section.label}</button>)}
      {canAdmin && <button type="button" aria-current={activeTab === 'admin' ? 'page' : undefined} onClick={() => selectTab('admin')}>Администрирование</button>}
    </nav>
    {notice && activeTab !== 'library' && activeTab !== 'archive' && <p role="status" className="kshvi-notice">{notice}</p>}
    {error && activeTab !== 'library' && activeTab !== 'archive' && <p role="alert" className="kshvi-error">{error}</p>}
    {sectionLoading && <p role="status">Загружаем подтверждённую серверную проекцию…</p>}

    {activeTab === 'library' && library(false)}
    {activeTab === 'archive' && <>
      {archiveRecord && <ArchiveWorkspace archiveId={archiveRecord.archiveId} manifestSha256={archiveRecord.manifestSha256} mode={archiveRecord.mode} missing={archiveRecord.missing} onExport={() => void exportArchive()} />}
      {library(true)}
    </>}
    {comparison && (activeTab === 'library' || activeTab === 'archive') && <RevisionCompare key={comparison.id} card={comparison} onClose={() => setComparison(null)} />}
    {activeTab === 'preparation' && <>
      {!selectedExercise && <LocalEditor />}
      <section className="kshvi-official-preparation" aria-labelledby="kshvi-preparation-title">
        <h2 id="kshvi-preparation-title">Подготовка официального сеанса</h2>
        {selectedExercise
          ? <p>{selectedExercise.title} · редакция {selectedExercise.revision}</p>
          : <p>Выберите «Рабочий цикл» в карточке учения библиотеки.</p>}
        <PreparationWorkspace
          client={client} exerciseId={selectedExercise?.id} revision={selectedExercise?.revision}
          authorId={serverUserId} truthRole={role} onRevision={updated => setSelectedExercise(updated)}
          exerciseState={selectedExercise?.state}
          canStartOfficial={!busy && can('exercise:conduct') && selectedExercise?.state === 'SEALED'}
          onStartOfficial={() => void startOfficialSession()}
        />
      </section>
    </>}
    {activeTab === 'conduct' && <section className="kshvi-conduct-container">
      {session && selectedExercise ? <>
        <section className="kshvi-session-card" aria-label="Подтверждённое состояние сеанса"><h2>Сеанс {session.id}</h2><dl>
          <div><dt>Учение</dt><dd>{selectedExercise.title}</dd></div>
          <div><dt>Редакция сценария</dt><dd>{session.revision}</dd></div>
          <div><dt>Состояние</dt><dd>{session.state}</dd></div>
          <div><dt>Подтверждённая ревизия мира</dt><dd>{session.confirmedRevision}</dd></div>
        </dl><p>Источник: сервер. Изменение браузера не считается совершившимся до подтверждения команды.</p></section>
        <ConductWorkspace role={role} canReadTruth={can('TRUTH_READ')} onExecute={executeCommand} onHandover={handleHandover} />
      </> : <section><h2>Проведение</h2><p>Откройте рабочий цикл учения и запустите серверный сеанс из подготовки. Обзорные панели ниже не являются официальным миром.</p><ConductWorkspace /></section>}
    </section>}
    {activeTab === 'replay' && (session && replayFrame ? <ReplayWorkspace
      initialFrame={replayFrame} maxSequence={replayFrame.maxSequence} canReadTruth={can('TRUTH_READ')}
      onSeek={async sequence => {
        if (!selectedExercise || !session) throw new Error('Сеанс не выбран');
        const frame = await client.replay(selectedExercise.id, session.id, { cursor: sequence, perspective: replayFrame.perspective });
        setReplayFrame(frame);
        return frame;
      }}
      onPerspectiveChange={async perspective => {
        if (!selectedExercise || !session) return;
        const frame = await client.replay(selectedExercise.id, session.id, { cursor: replayFrame.sequence, perspective });
        setReplayFrame(frame);
      }}
      onTrace={eventId => setNotice(`Запрошены серверные причинные связи события ${eventId}`)}
    /> : !sectionLoading && <section><h2>Реплей</h2><p>Завершите команду в официальном сеансе и откройте сохранённую серверную проекцию.</p></section>)}
    {activeTab === 'review' && (debrief && session ? <ReviewWorkspace
      debrief={debrief} canApprove={can('TRUTH_READ') && (role === 'LEADER' || role === 'DIRECTOR')}
      onApprove={value => void approveAssessment(value)}
      onArchive={session.state === 'COMPLETED' && can('exercise:archive') && can('archive.export') ? () => void archiveCompleted() : undefined}
    /> : !sectionLoading && <section><h2>Разбор</h2><p>Материалы появятся после официального сеанса. Общий разбор доступен по серверному полномочию.</p></section>)}
    {activeTab === 'exposition' && (exposition?.session && exposition.projection ? <BrowserExpositionApp key={exposition.session.sessionId} initialSession={exposition.session} initialProjection={exposition.projection} />
      : !sectionLoading && <section><h2>Экспозиция</h2><p>{exposition ? 'Сервер вернул неполную экспозиционную проекцию; показ не запущен.' : 'Сначала сформируйте архив завершённого официального сеанса в разборе.'}</p></section>)}
    {activeTab === 'admin' && canAdmin && (adminOverview ? <AdminWorkspace overview={adminOverview}
      onBlock={accountId => adminMutation(() => client.blockAccount(accountId), 'Учётная запись заблокирована сервером')}
      onArchive={accountId => adminMutation(() => client.archiveAccount(accountId), 'Учётная запись архивирована сервером')}
      onRevoke={assignmentId => adminMutation(() => client.revokeAssignment(assignmentId), 'Назначение отозвано сервером')}
      onExportAudit={() => adminMutation(() => client.exportAudit(), 'Технический аудит экспортирован сервером')}
    /> : !sectionLoading && <p>Техническая проекция недоступна. Содержание учения не раскрывается.</p>)}
  </section>;
}
