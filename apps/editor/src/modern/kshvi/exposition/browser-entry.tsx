import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  ExpositionPresenterSession,
  ExpositionProgram,
  PresenterCommand,
} from '../../../../../../packages/kshvi/src/exposition/browser-entry';
import type { AudienceProjectionView } from './AudienceProjector';
import { ExpositionEditor } from './ExpositionEditor';
import { PresenterWorkspace } from './PresenterWorkspace';
import { ExpositionClient, type ExpositionApi } from './exposition-client';
import './exposition.css';

export function BrowserExpositionApp({ client: providedClient, projectorId = 'exposition-projector', initialSession, initialProjection }: Readonly<{
  client?: ExpositionApi;
  projectorId?: string;
  initialSession?: ExpositionPresenterSession;
  initialProjection?: AudienceProjectionView;
}>) {
  const clientRef = useRef(providedClient ?? new ExpositionClient());
  const client = clientRef.current;
  const [session, setSession] = useState<ExpositionPresenterSession | null>(initialSession ?? null);
  const [projection, setProjection] = useState<AudienceProjectionView | null>(initialProjection ?? null);
  const [mode, setMode] = useState<'presenter' | 'editor'>('presenter');
  const [seed, setSeed] = useState(42);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const advancing = useRef(false);

  async function adopt(next: ExpositionPresenterSession): Promise<void> {
    const current = ++generation.current;
    setSession(next);
    const nextProjection = await client.projector(next.sessionId, projectorId);
    if (generation.current === current) setProjection(nextProjection);
  }

  async function run(action: () => Promise<ExpositionPresenterSession>): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await adopt(await action());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function start(source: 'ARCHIVE' | 'AUTONOMOUS'): Promise<void> {
    await run(() => client.start(source === 'ARCHIVE' ? { source } : { source, seed }));
  }

  useEffect(() => { if (!initialSession) void start('ARCHIVE'); }, []);

  async function command(command: PresenterCommand): Promise<void> {
    if (!session) return;
    await run(() => client.command(session.sessionId, command));
  }

  useEffect(() => {
    if (!session || session.playback.status !== 'PLAYING' || busy) return;
    let previous = performance.now();
    const timer = globalThis.setInterval(() => {
      const now = performance.now();
      const elapsedMs = Math.max(0, now - previous);
      previous = now;
      if (advancing.current || elapsedMs === 0) return;
      advancing.current = true;
      void client.command(session.sessionId, { type: 'ADVANCE', elapsedMs })
        .then(adopt)
        .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
        .finally(() => { advancing.current = false; });
    }, 100);
    return () => globalThis.clearInterval(timer);
  }, [session?.sessionId, session?.playback.status, busy]);

  const ready = session && projection;
  return <div className="exposition-browser-shell">
    <nav className="exposition-browser-nav" aria-label="Экспозиционный browser entry">
      <strong>Показ КШВИ</strong>
      <div>
        <button type="button" disabled={busy} onClick={() => void start('ARCHIVE')}>Архивный показ</button>
        <button type="button" disabled={busy || !Number.isSafeInteger(seed) || seed < 0} onClick={() => void start('AUTONOMOUS')}>Автономный расчёт</button>
        <label className="exposition-seed">Seed<input aria-label="Зерно автономного показа" type="number" min={0} step={1} value={seed} onChange={event => setSeed(Number(event.target.value))} /></label>
        <button type="button" disabled={!ready} onClick={() => setMode('presenter')}>Ведущий показ</button>
        <button type="button" disabled={!ready} onClick={() => setMode('editor')}>Редактор программы</button>
      </div>
    </nav>
    {error && <p className="exposition-error" role="alert">{error}</p>}
    {busy && !ready && <p className="exposition-loading" role="status">Сервер выполняет расчёт…</p>}
    {ready && mode === 'presenter' && <PresenterWorkspace
      session={session}
      projection={projection}
      onCommand={next => void command(next)}
      onContinueFromCheckpoint={checkpointId => void run(() => client.continueFromCheckpoint(session.sessionId, checkpointId, { seed: session.seed ?? undefined }))}
      onRestart={restartMode => void run(() => client.restart(session.sessionId, {
        mode: restartMode,
        ...(restartMode === 'NEW_BRANCH' ? { seed: (session.seed ?? seed) + 1 } : {}),
      }))}
    />}
    {ready && mode === 'editor' && <ExpositionEditor program={session.program} onChange={(program: ExpositionProgram) => {
      void run(() => client.updateProgram(session.sessionId, program));
    }} />}
  </div>;
}

const root = document.getElementById('exposition-browser-root');
if (root) createRoot(root).render(<BrowserExpositionApp />);
