/**
 * Хост выставочного сеанса — единственный владелец состояния режиссёра, живёт в главном окне.
 *
 * Принимает события (от своего окна — любые, от окон видов по шине — только ввод посетителя и не на паузе), прогоняет их
 * через режиссёра и рассылает кадр всем окнам; ПИН в кадр не попадает. Раскладывает окна по мониторам (`plan`) при
 * запуске, смене мониторов и смене настроек экранов; перестройки идут по очереди, чтобы не накладывались.
 *
 * Режим ИИ в кадре — рабочий (`setAiMode`: резервный «без ИИ» при сбое служб), в `configuration()` — выбор оператора.
 * Окно вида готово, если его сигнал активности приходил не дольше 10 с назад.
 */
import { initialState, step, type DirectorEvent, type Effect } from './director';
import type { ExpoSettings } from './settings';
import type { ExpoBus } from './bus';
import type { ModelFrame } from './model';
import { NO_AI, type AiFrame } from './ai-runner';
import { plan, type Windows, type MonitorInfo } from './windows';

const VISITOR_EVENTS: DirectorEvent['t'][] = ['touch', 'skipIntro', 'introSeek', 'pickFront', 'markFront', 'next', 'choose', 'aim', 'replace', 'speak', 'ask', 'restart', 'voice', 'brief', 'back', 'step', 'stay', 'scrollWait', 'scrollReady', 'scrollDone', 'pause', 'resume'];

const sameScreens = (a: ExpoSettings['screens'], b: ExpoSettings['screens']) =>
  a.count === b.count && a.order.length === b.order.length && a.order.every((id, i) => id === b.order[i]);

export function createHost(
  initial: ExpoSettings,
  bus: ExpoBus,
  windows: Windows,
  changed: () => void,
  effect: (e: Effect) => void = () => {},
  windowError: (error: unknown) => void = () => {},
) {
  let settings = initial;
  let state = { ...initialState(Date.now()), voice: initial.attractCall.on };
  let count: 1 | 2 | 3 = 1;
  let stopped = false;
  let aiMode = initial.aiMode;
  let model: ModelFrame = { view: null, error: null };
  let ai: AiFrame = NO_AI;
  let offMonitors = () => {};
  let queue = Promise.resolve();
  let configurations = Promise.resolve();
  let recovering: Promise<void> | null = null;
  let layoutNeedsRepair = false;
  const beats = new Map<number, number>();
  const firstBeatUntil = new Map<number, number>();

  const ready = () => !layoutNeedsRepair &&
    Array.from({ length: count - 1 }, (_, i) => i + 1).every((i) => {
      const at = beats.get(i) ?? 0;
      return at > 0 && Date.now() - at <= 10000;
    });
  /** Сторож даёт только новому окну время загрузиться; начальная готовность по-прежнему строгая. */
  const windowsHealthy = () => !layoutNeedsRepair && Array.from({ length: count - 1 }, (_, i) => i + 1).every(i => {
    const at = beats.get(i) ?? 0;
    return at > 0 ? Date.now() - at <= 10000 : Date.now() < (firstBeatUntil.get(i) ?? 0);
  });
  const snapshot = () => ({ state, settings: { ...settings, aiMode }, count, model, ai });
  const publish = () => {
    if (stopped) return;
    bus.send({ k: 'state', ...snapshot(), settings: { ...settings, aiMode, pin: '' } });
    changed();
  };
  const dispatch = (ev: DirectorEvent) => {
    if (stopped) return;
    const next = step(state, ev, settings);
    state = next.state;
    publish();
    for (const e of next.effects) {
      effect(e);
    }
  };
  const arrange = (monitors: MonitorInfo[], desired?: ExpoSettings) => {
    queue = queue
      .catch(() => {})
      .then(async () => {
        if (stopped) return;
        // Hotplug может ждать в очереди, пока оператор меняет порядок экранов.
        // Без явного configure/rollback берём настройки в момент исполнения.
        const configuration = desired ?? settings;
        let p = plan(monitors, configuration);
        try { await windows.open(p); }
        catch (error) {
          if (!String(error).includes('EXPO_MONITORS_CHANGED')) throw error;
          // Монитор мог исчезнуть между чтением списка и native размещением.
          // Один свежий план; повторная ошибка выходит наружу, без бесконечной гонки.
          p = plan(await windows.monitors(), configuration);
          await windows.open(p);
        }
        if (stopped) return;
        count = p.count;
        layoutNeedsRepair = false;
        for (const i of beats.keys()) if (i >= count) { beats.delete(i); firstBeatUntil.delete(i); }
        for (let i = 1; i < count; i++) if (!beats.has(i)) {
          beats.set(i, 0);
          firstBeatUntil.set(i, Date.now() + 10000);
        }
        publish();
      })
      .catch((error) => {
        layoutNeedsRepair = true;
        throw error;
      });
    return queue;
  };
  const off = bus.on((m) => {
    if (m.k === 'hello' || m.k === 'beat') {
      if (m.window > 0 && m.window < count) { beats.set(m.window, Date.now()); firstBeatUntil.delete(m.window); }
      if (m.k === 'hello') publish();
    }
    if (m.k === 'input' && VISITOR_EVENTS.includes(m.ev.t) && (!state.paused || m.ev.t === 'pause' || m.ev.t === 'resume')) dispatch(m.ev);
  });

  return {
    snapshot,
    dispatch,
    ready,
    windowsHealthy,
    configuration: () => settings,
    /** Вид модели сеанса (карточки, шкалы, ход, итог) — рассылается вместе с кадром. */
    setModel(f: ModelFrame) {
      model = f;
      publish();
      const p = state.phase;
      if (p.kind !== 'turn' || p.step !== 'scroll') return;
      if (p.kind === 'turn' && p.step === 'scroll' && f.view?.busy && !p.scrollBegan) dispatch({ t: 'scrollWait' });
    },
    /** Кадр ИИ: что звучит, ответ на вопрос, мысль. */
    setAi(f: AiFrame) {
      ai = f;
      publish();
    },
    setAiMode(mode: ExpoSettings['aiMode']) {
      aiMode = mode;
      publish();
    },
    async checkWindows() {
      if (stopped || windowsHealthy()) return;
      recovering ??= windows.monitors().then(async (monitors) => {
        // Native открывает только отсутствующие окна. Исправные сохраняют кадр и полноэкранность.
        if (!stopped && !windowsHealthy()) await arrange(monitors);
      }).finally(() => { recovering = null; });
      await recovering;
    },
    async start() {
      await windows.guard(true);
      if (stopped) return;
      await arrange(await windows.monitors());
      offMonitors = windows.onMonitors((m) => {
        void arrange(m).catch(windowError);
      });
    },
    /** Громкость, таймер и прочее окна не трогают: перестройка — только при смене числа или порядка экранов. */
    configure(next: ExpoSettings) {
      const change = configurations.catch(() => {}).then(async () => {
        if (stopped) return;
        const previous = settings;
        const rearrange = !sameScreens(next.screens, previous.screens);
        if (rearrange) {
          try { await arrange(await windows.monitors(), next); }
          catch (error) {
            // Native мог открыть часть окон до ошибки. Восстанавливаем прежний план,
            // не посылая режиссёру ни restart, ни newSession.
            try { await arrange(await windows.monitors(), previous); }
            catch (rollback) { throw new Error(`${String(error)}. Не удалось вернуть прежние окна: ${String(rollback)}`); }
            throw error;
          }
        }
        if (stopped) return;
        if (next.aiMode !== previous.aiMode) aiMode = next.aiMode;
        if (next.attractCall.on !== previous.attractCall.on) state = { ...state, voice: next.attractCall.on };
        settings = next;
        publish();
      });
      configurations = change;
      return change;
    },
    async stop() {
      stopped = true;
      off();
      offMonitors();
      await configurations.catch(() => {});
      await recovering?.catch(() => {});
      await queue.catch(() => {});
      await windows.guard(false);
      await windows.closeAll();
      bus.close();
    },
  };
}
