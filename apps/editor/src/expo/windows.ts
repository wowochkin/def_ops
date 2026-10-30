/**
 * Окна выставочного стенда на мониторах.
 *
 * `plan` — чистая: какие окна на каких мониторах. Порядок мониторов — из настроек (`screens.order`, неизвестные id
 * отброшены), недостающие — слева направо по `x`; число окон — `effectiveCount` (не больше подключённых мониторов).
 * Потеряли монитор — тот же план по новому списку даёт меньшую раскладку; фаза режиссёра от этого не зависит.
 *
 * В настольном приложении окна открывает и стережёт приложение (команды `expo_*`, src-tauri/src/expo.rs): окно 0 —
 * главное окно, окна 1 и 2 — `expo-1`, `expo-2` с адресом редактора `?expo=<номер>`. В браузере разработки — один
 * «монитор» по размеру окна, остальные окна — вкладки `?expo=<номер>`, охраны нет.
 */
import type { ExpoSettings, Invoke } from './settings';
import { effectiveCount } from './layout';

export interface MonitorInfo { id: string; name: string; x: number; y: number; width: number; height: number; scale: number }
export type WindowPlan = { count: 1 | 2 | 3; windows: { index: number; monitor: string }[] };

export function plan(monitors: MonitorInfo[], s: ExpoSettings): WindowPlan {
  const byX = [...monitors].sort((a, b) => a.x - b.x || a.y - b.y);
  const known = new Set(byX.map((m) => m.id));
  const first = [...new Set(s.screens.order)].filter((id) => known.has(id));
  const ids = [...first, ...byX.map((m) => m.id).filter((id) => !first.includes(id))];
  const count = effectiveCount(s.screens.count, ids.length);
  // мониторов не нашлось — одно окно там, где оно есть (пустой id: приложение оставит окно на текущем мониторе)
  const windows = Array.from({ length: count }, (_, i) => ({ index: i, monitor: ids[i] ?? '' }));
  return { count, windows };
}

export interface Windows {
  monitors(): Promise<MonitorInfo[]>;
  open(p: WindowPlan): Promise<void>;
  closeAll(): Promise<void>;
  guard(on: boolean): Promise<void>;
  /** Подписка на смену списка мониторов; возвращает отписку. */
  onMonitors(f: (m: MonitorInfo[]) => void): () => void;
}

export const MONITORS_EVENT = 'expo://monitors';

/** Настольное приложение: команды Tauri. `invoke` и `listen` подставляются в тестах. */
export function desktopWindows(
  invoke: Invoke = async (cmd, args) => (await import('@tauri-apps/api/core')).invoke(cmd, args),
  listen: (event: string, f: (payload: unknown) => void) => Promise<() => void> = async (event, f) =>
    (await import('@tauri-apps/api/event')).listen(event, (e) => f(e.payload)),
): Windows {
  return {
    monitors: async () => (await invoke('expo_monitors')) as MonitorInfo[],
    open: async (p) => { await invoke('expo_open', { windows: p.windows }); },
    closeAll: async () => { await invoke('expo_close_all'); },
    guard: async (on) => { await invoke('expo_set_guard', { on }); },
    onMonitors(f) {
      let off: (() => void) | null = null;
      let done = false;
      void listen(MONITORS_EVENT, (m) => f(m as MonitorInfo[])).then((u) => { if (done) u(); else off = u; });
      return () => { done = true; off?.(); off = null; };
    },
  };
}

/** Браузер разработки: один монитор по размеру окна, остальные окна — вкладки. */
export function browserWindows(w: Window = window): Windows {
  const tabs = new Map<number, Window>();
  const url = (i: number) => { const u = new URL(w.location.href); u.searchParams.set('expo', String(i)); return u.toString(); };
  return {
    monitors: async () => [{ id: 'browser', name: 'Окно браузера', x: 0, y: 0, width: w.innerWidth, height: w.innerHeight, scale: w.devicePixelRatio || 1 }],
    async open(p) {
      const want = new Set(p.windows.map((x) => x.index).filter((i) => i > 0));
      for (const [i, t] of tabs) if (!want.has(i) || t.closed) { if (!want.has(i)) t.close(); tabs.delete(i); }
      for (const i of want) if (!tabs.has(i)) { const t = w.open(url(i), `def_ops-expo-${i}`); if (t) tabs.set(i, t); }
    },
    async closeAll() { for (const t of tabs.values()) t.close(); tabs.clear(); },
    async guard() { /* в браузере окна не стережём */ },
    onMonitors: () => () => {},
  };
}

const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function expoWindows(): Windows {
  return inApp() ? desktopWindows() : browserWindows();
}
