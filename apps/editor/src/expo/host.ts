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
import { missingWindows } from './health';
import { initialState, step, type DirectorEvent, type Effect } from './director';
import type { ExpoSettings } from './settings';
import type { ExpoBus } from './bus';
import { plan, type Windows, type MonitorInfo } from './windows';

const VISITOR_EVENTS: DirectorEvent['t'][] = ['touch', 'pickFront', 'next', 'choose', 'replace', 'speak', 'restart'];

const sameScreens = (a: ExpoSettings['screens'], b: ExpoSettings['screens']) =>
  a.count === b.count && a.order.length === b.order.length && a.order.every((id, i) => id === b.order[i]);

export function createHost(
  initial: ExpoSettings,
  bus: ExpoBus,
  windows: Windows,
  changed: () => void,
  effect: (e: Effect) => void = () => {},
) {
  let settings = initial;
  let state = initialState(Date.now());
  let count: 1 | 2 | 3 = 1;
  let stopped = false;
  let aiMode = initial.aiMode;
  let offMonitors = () => {};
  let queue = Promise.resolve();
  const beats = new Map<number, number>();

  const ready = () =>
    Array.from({ length: count - 1 }, (_, i) => i + 1).every((i) => {
      const at = beats.get(i) ?? 0;
      return at > 0 && Date.now() - at <= 10000;
    });
  const snapshot = () => ({ state, settings: { ...settings, aiMode }, count });
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
      if (e.e === 'aiPick') dispatch({ t: 'choose', card: 0 });
    }
  };
  const arrange = (monitors: MonitorInfo[]) => {
    queue = queue
      .catch(() => {})
      .then(async () => {
        if (stopped) return;
        const p = plan(monitors, settings);
        await windows.open(p);
        if (stopped) return;
        count = p.count;
        for (let i = 1; i < count; i++) if (!beats.has(i)) beats.set(i, 0);
        publish();
      });
    return queue;
  };
  const off = bus.on((m) => {
    if (m.k === 'hello' || m.k === 'beat') {
      if (m.window > 0 && m.window < count) beats.set(m.window, Date.now());
      if (m.k === 'hello') publish();
    }
    if (m.k === 'input' && !state.paused && VISITOR_EVENTS.includes(m.ev.t)) dispatch(m.ev);
  });

  return {
    snapshot,
    dispatch,
    ready,
    configuration: () => settings,
    setAiMode(mode: ExpoSettings['aiMode']) {
      aiMode = mode;
      publish();
    },
    async checkWindows() {
      if (!missingWindows(count, beats, Date.now()).length) return;
      await windows.closeAll();
      await arrange(await windows.monitors());
    },
    async start() {
      await windows.guard(true);
      if (stopped) return;
      await arrange(await windows.monitors());
      offMonitors = windows.onMonitors((m) => {
        void arrange(m).catch(() => dispatch({ t: 'jump', phase: 'startup' }));
      });
    },
    /** Громкость, таймер и прочее окна не трогают: перестройка — только при смене числа или порядка экранов. */
    async configure(next: ExpoSettings) {
      const rearrange = !sameScreens(next.screens, settings.screens);
      if (next.aiMode !== settings.aiMode) aiMode = next.aiMode;
      settings = next;
      if (rearrange) await arrange(await windows.monitors());
      publish();
    },
    async stop() {
      stopped = true;
      off();
      offMonitors();
      await queue.catch(() => {});
      await windows.guard(false);
      await windows.closeAll();
      bus.close();
    },
  };
}
