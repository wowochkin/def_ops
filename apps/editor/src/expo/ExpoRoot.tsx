/**
 * Корень выставочного окна (`?expo=<номер>` или автозапуск).
 *
 * Окно 0 — главное: в нём хост сеанса (`createHost`), часы режиссёра, проверка служб при запуске (`runProbes`), сторож
 * служб (`watchdog`), статистика и меню оператора. Окна 1 и 2 только показывают кадр, присланный хостом по шине, шлют
 * ввод посетителя и сигналы активности (`hello`, `beat` раз в 2 с).
 *
 * Пока открыт корень, действуют ограничения ввода (`lockdown`): проходят только сочетание оператора, клавиши профиля
 * «мышь и клавиатура» и любые клавиши при открытом меню.
 */
import { useEffect, useRef, useState } from 'react';
import { localProbes, runProbes } from './probes';
import { startupPlan, startupVerdict, watchdog, type ProbeId, type ProbeStates } from './health';
import { StartupScene } from './StartupScene';
import { telemetry, type ExpoStats } from './stats';
import { expoBus, type ExpoBus } from './bus';
import { expoWindows, plan, type Windows } from './windows';
import { settingsStore, EXPO_DEFAULTS, type ExpoSettings } from './settings';
import { createHost } from './host';
import { initialState, type DirectorEvent } from './director';
import { ExpoView } from './ExpoView';
import { cuesFor, soundEngine } from './sound';
import { coreEnv, modelRunner, type ModelFrame } from './model';
import { createStage } from './stage';
import { NO_AI } from './ai-runner';
import type { StatKind } from './stats';
import { lockdown } from './lockdown';
import { cornerHold, operatorCombo } from './operator';
import { OperatorMenu } from './OperatorMenu';
import { phaseLabel } from './scenes';
import { docsSig, stageMaps, type StageDocs } from './stage-maps';
import { axesSum } from './score';
import { noteSession } from './records';

type Host = ReturnType<typeof createHost>;
const NO_MODEL: ModelFrame = { view: null, error: null };

const VISITOR_KEYS = ['1', '2', '3', 'r', 'R', 'Enter', ' ', 'ArrowLeft', 'ArrowRight'];

export function ExpoRoot({ index = 0, onExit }: { index?: number; onExit?: () => void }) {
  const [frame, setFrame] = useState({ state: initialState(Date.now()), settings: EXPO_DEFAULTS, count: 1 as 1 | 2 | 3, model: NO_MODEL as ModelFrame, ai: NO_AI });
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const [identify, setIdentify] = useState({ until: 0, names: [] as string[] });
  const [health, setHealth] = useState<ProbeStates>({ core: 'wait', voice: 'wait', model: 'wait', windows: 'wait' });
  const [note, setNote] = useState<string | null>(null);
  const [stats, setStats] = useState<ExpoStats>({ sessions: 0, finished: 0, failures: 0 });
  const [maps, setMaps] = useState<StageDocs>({});
  const hostRef = useRef<Host | null>(null);
  const busRef = useRef<ExpoBus | null>(null);
  const windowsRef = useRef<Windows | null>(null);
  const menuRef = useRef(false);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const sound = useRef<ReturnType<typeof soundEngine> | null>(null);
  const heard = useRef<{ state: typeof frame.state; flashes: string } | null>(null);
  useEffect(() => {
    if (index !== 0) return;
    const s = (sound.current = soundEngine());
    const unlock = () => s.resume();
    document.addEventListener('pointerdown', unlock);
    return () => {
      document.removeEventListener('pointerdown', unlock);
      s.close();
      sound.current = null;
    };
  }, [index]);
  useEffect(() => sound.current?.set(frame.settings.volume), [frame.settings.volume]);
  useEffect(() => {
    if (index !== 0) return;
    const flashes = (frame.model.view?.map?.flashes ?? []).map((f) => f.id).join();
    const prev = heard.current;
    heard.current = { state: frame.state, flashes };
    for (const c of cuesFor(prev?.state ?? null, frame.state, prev && flashes && flashes !== prev.flashes ? 1 : 0)) sound.current?.play(c);
  }, [index, frame.state, frame.model]);

  const send = (ev: DirectorEvent) => (index === 0 ? hostRef.current?.dispatch(ev) : busRef.current?.send({ k: 'input', ev }));
  const close = () => {
    menuRef.current = false;
    setMenu(false);
    hostRef.current?.dispatch({ t: 'resume' });
  };

  useEffect(() => {
    let disposed = false;
    const abort = new AbortController();
    let stopWatch = () => {};
    let stopStage = () => {};
    let historyRun = () => {};
    let timer: ReturnType<typeof setInterval> | undefined;
    const metrics = telemetry();
    const log = (s: string) => {
      void metrics.log(s).catch(() => {});
    };
    const refreshStats = () => {
      void metrics
        .today()
        .then((s) => {
          if (!disposed) setStats(s);
        })
        .catch(() => {});
    };
    const count = (kind: StatKind) => {
      void metrics
        .add(kind)
        .then(refreshStats)
        .catch(() => {});
    };
    refreshStats();

    const bus = expoBus();
    busRef.current = bus;
    let mine: StageDocs = {};
    const mapsRef = stageMaps((key, d) => {
      if (disposed) return;
      setMaps((x) => ({ ...x, [key]: d }));
      bus.send({ k: 'map', key, d });
    });
    const windows = expoWindows();
    windowsRef.current = windows;

    const open = () => {
      if (index !== 0) return;
      hostRef.current?.dispatch({ t: 'pause' });
      menuRef.current = true;
      setMenu(true);
    };
    const offLock = lockdown(document, {
      operatorCombo,
      allowKey: (e) => menuRef.current || (frameRef.current.settings.input === 'mouse-keyboard' && VISITOR_KEYS.includes(e.key)),
    });
    const combo = (e: KeyboardEvent) => {
      if (!operatorCombo(e)) return;
      e.preventDefault();
      open();
    };
    document.addEventListener('keydown', combo);
    const offCorner = index === 0 ? cornerHold(document.body, open) : () => {};

    const off = bus.on((m) => {
      if (index > 0 && m.k === 'state') setFrame({ state: m.state, settings: m.settings, count: m.count, model: m.model ?? NO_MODEL, ai: m.ai ?? NO_AI });
      if (m.k === 'health') {
        setHealth(m.states);
        setNote(m.note);
      }
      if (m.k === 'identify') setIdentify({ until: m.until, names: m.names });
      if (index > 0 && m.k === 'map') setMaps((x) => (mine = { ...x, [m.key]: m.d }));
      // окно без нынешних документов карты (новое или перезапущенное) — дослать
      if (index === 0 && m.k === 'hello' && m.has !== docsSig(mapsRef.docs)) for (const [key, d] of Object.entries(mapsRef.docs)) if (d) bus.send({ k: 'map', key: key as keyof StageDocs, d });
    });

    const publishHealth = (states: ProbeStates, reason: string | null = null) => {
      if (disposed) return;
      setHealth({ ...states });
      setNote(reason);
      bus.send({ k: 'health', states: { ...states }, note: reason });
    };

    /** Сторож после запуска: службы, не нужные текущим настройкам, считаются исправными и показываются как «не требуется». */
    const watch = (host: Host, probes: ReturnType<typeof localProbes>, states: ProbeStates) => {
      const tracked = probes.map((p) => ({
        ...p,
        check: async () => {
          if (!startupPlan(host.configuration()).includes(p.id)) {
            states[p.id] = 'off';
            publishHealth(states);
            return true;
          }
          const ok = await p.check();
          states[p.id] = ok ? 'ok' : 'fail';
          publishHealth(states);
          return ok;
        },
      }));
      const onFail = (id: ProbeId) => {
        log(`Нет связи: ${id}`);
        count('failure');
        // модель и голос, которыми сеанс уже не пользуется (стенд работает без ИИ), сеанс не прерывают
        const used = id === 'core' || id === 'windows' || host.snapshot().settings.aiMode === 'ai';
        if (used) host.dispatch({ t: 'jump', phase: id === 'core' || id === 'windows' ? 'startup' : 'attract' });
        if (id === 'model' || id === 'voice') {
          host.setAiMode('noai');
          publishHealth(states, 'Запуск в режиме без ИИ');
        }
        if (id === 'windows') void host.checkWindows().catch((e) => log(String(e)));
      };
      const onSweep = () => {
        if (states.core === 'ok' && states.windows === 'ok') {
          setError('');
          host.dispatch({ t: 'ready' });
        }
        if (host.configuration().aiMode === 'ai' && states.model === 'ok' && states.voice === 'ok') host.setAiMode('ai');
      };
      return watchdog(tracked, onFail, 15000, () => {}, onSweep);
    };

    const startHost = async (settings: ExpoSettings) => {
      if (disposed) return;
      const stage = createStage({
        aiOn: () => hostRef.current?.snapshot().settings.aiMode === 'ai',
        snapshot: () => hostRef.current?.snapshot() ?? { state: initialState(Date.now()), model: NO_MODEL },
        dispatch: (ev) => hostRef.current?.dispatch(ev),
        onFrame: (f) => hostRef.current?.setAi(f),
        count,
      });
      stopStage = () => {
        document.removeEventListener('pointerdown', stage.resume);
        stage.dispose();
      };
      document.addEventListener('pointerdown', stage.resume);
      const model = modelRunner(coreEnv, (f) => hostRef.current?.setModel(f), undefined, undefined, {
        ...stage.hooks,
        traced: (trace, env, s, final) => {
          if (final) noteSession(s.view.scales.axes, s.front);
          void mapsRef.session(trace, env.history, s.front, final ? axesSum(s.view.scales.axes) : undefined);
        },
      });
      historyRun = () =>
        void model.history().then((r) => {
          if (r && !disposed) void mapsRef.history(r.trace, r.env.history);
        });
      const host = createHost(
        settings,
        bus,
        windows,
        () => {
          if (!disposed) setFrame(host.snapshot());
        },
        (e) => {
          if (e.e === 'stat') count(e.kind);
          if (e.e === 'newSession' || e.e === 'deal' || e.e === 'replace' || e.e === 'decide') void model.handle(e);
          stage.handle(e);
        },
      );
      hostRef.current = host;
      await host.start();
      if (disposed) return;
      timer = setInterval(() => {
        host.dispatch({ t: 'tick', now: Date.now() });
        stage.tick();
      }, 250);
      const probes = localProbes(host.ready);
      const required = probes.filter((p) => startupPlan(settings).includes(p.id));
      const states = await runProbes(required, publishHealth, abort.signal);
      if (disposed) return;
      const verdict = startupVerdict(states, settings);
      publishHealth(states, verdict.note);
      host.setAiMode(verdict.aiMode);
      if (verdict.ready) {
        host.dispatch({ t: 'ready' });
        historyRun();
      }
      else setError('Обязательные службы не готовы. Проверьте ядро и экраны в меню оператора.');
      log(verdict.ready ? 'Стенд готов' : 'Стенд не готов');
      stopWatch = watch(host, probes, states);
    };

    if (index === 0) {
      void settingsStore()
        .load()
        .then(startHost)
        .catch((e) => {
          if (!disposed) setError(String(e));
        });
    } else {
      bus.send({ k: 'hello', window: index, has: '' });
      timer = setInterval(() => {
        bus.send({ k: 'hello', window: index, has: docsSig(mine) });
        bus.send({ k: 'beat', window: index, at: Date.now() });
      }, 2000);
    }

    return () => {
      disposed = true;
      abort.abort();
      stopWatch();
      stopStage();
      mapsRef.dispose();
      off();
      offCorner();
      offLock();
      document.removeEventListener('keydown', combo);
      clearInterval(timer);
      const host = hostRef.current;
      hostRef.current = null;
      if (host) void host.stop();
      else bus.close();
    };
  }, [index]);

  const save = async (settings: ExpoSettings) => {
    const host = hostRef.current;
    if (!host) return;
    if (settings.aiMode === 'ai' && host.configuration().aiMode !== 'ai') {
      const checks = localProbes(host.ready).filter((p) => p.id === 'model' || p.id === 'voice');
      const ok = await Promise.all(checks.map((p) => p.check().catch(() => false)));
      if (ok.some((v) => !v)) throw Error('Для режима с ИИ нужны работающие локальная модель и голос');
    }
    await settingsStore().save(settings);
    await host.configure(settings);
  };
  const exit = async () => {
    await hostRef.current?.stop();
    hostRef.current = null;
    const url = new URL(location.href);
    url.searchParams.delete('expo');
    history.replaceState(null, '', url);
    onExit?.();
  };
  /** Номер и монитор каждого окна — на всех экранах на 10 с. */
  const showScreenNumbers = async () => {
    const monitors = (await windowsRef.current?.monitors()) ?? [];
    const slots = plan(monitors, hostRef.current?.configuration() ?? frame.settings).windows;
    const names = slots.map((slot) => {
      const m = monitors.find((m) => m.id === slot.monitor);
      return m ? `${m.name} · ${m.id}` : slot.monitor;
    });
    const info = { until: Date.now() + 10000, names };
    setIdentify(info);
    busRef.current?.send({ k: 'identify', ...info });
  };
  return (
    <>
      {error && (
        <div className="expo-error" role="alert">
          Не удалось запустить стенд: {error}
        </div>
      )}
      <ExpoView window={index} {...frame} maps={maps} send={send}>
        {frame.state.phase.kind === 'startup' && <StartupScene states={health} note={note} />}
        {identify.until > frame.state.now && (
          <div className="expo-identify">
            <strong>Экран {index + 1}</strong>
            <span>{identify.names[index]}</span>
          </div>
        )}
      </ExpoView>
      {index === 0 && (
        <OperatorMenu
          open={menu}
          summary={{
            phase: `${phaseLabel(frame.state)}${frame.state.paused ? ' · на паузе' : ''}`,
            health,
            note,
            stats,
            screens: { open: frame.count, want: (hostRef.current?.configuration() ?? frame.settings).screens.count },
          }}
          monitors={() => windowsRef.current?.monitors() ?? Promise.resolve([])}
          settings={hostRef.current?.configuration() ?? frame.settings}
          onSave={save}
          onClose={close}
          onExit={() => {
            void exit().catch((e) => setError(String(e)));
          }}
          onAction={(action) => {
            if (action === 'identify') {
              void showScreenNumbers();
              return;
            }
            if (action === 'reboot') {
              location.reload();
              return;
            }
            hostRef.current?.dispatch(action);
            close();
          }}
        />
      )}
    </>
  );
}
