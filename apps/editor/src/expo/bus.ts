/**
 * Шина между выставочными окнами.
 *
 * Главное окно (режиссёр) рассылает состояние, окна видов шлют ввод посетителя, приветствие при открытии и сердцебиение.
 * В настольном приложении — события Tauri `expo://bus`, в браузере разработки — `BroadcastChannel('def_ops.expo')`.
 * Своё сообщение отправитель не получает.
 */
import type { ExpoSettings } from './settings';
import type { DirectorEvent, DirectorState } from './director';
import type { ModelFrame } from './model';
import type { AiFrame } from './ai-runner';

export type BusMsg =
  | { k: 'state'; state: DirectorState; settings: ExpoSettings; count: 1 | 2 | 3; model?: ModelFrame; ai?: AiFrame }
  | { k: 'input'; ev: DirectorEvent }
  | { k: 'health'; states: import('./health').ProbeStates; note: string | null }
  | { k: 'identify'; until: number; names: string[] }
  /** has — подпись документов карты, которые у окна уже есть (главное окно досылает недостающие). */
  | { k: 'hello'; window: number; has?: string }
  | { k: 'beat'; window: number; at: number }
  /** Документ карты стенда (рассылается только при смене). */
  | { k: 'map'; key: import('./stage-maps').StageKey; d: import('./stage-maps').StageDoc };

export interface ExpoBus {
  send(m: BusMsg): void;
  /** Подписка; возвращает отписку. */
  on(f: (m: BusMsg) => void): () => void;
  /** Закрыть шину: подписчики больше ничего не получают, отправка молчит. */
  close(): void;
}

const EVENT = 'expo://bus';
const CHANNEL = 'def_ops.expo';

/** Общая часть: список подписчиков и признак закрытия. */
function hub() {
  const subs = new Set<(m: BusMsg) => void>();
  let closed = false;
  return {
    get closed() { return closed; },
    deliver(m: BusMsg) { if (!closed) for (const f of [...subs]) f(m); },
    on(f: (m: BusMsg) => void) { if (closed) return () => {}; subs.add(f); return () => { subs.delete(f); }; },
    close() { closed = true; subs.clear(); },
  };
}

/** Пара связанных шин в памяти — для тестов. */
export function memoryBus(): [ExpoBus, ExpoBus] {
  const a = hub();
  const b = hub();
  const side = (self: ReturnType<typeof hub>, peer: ReturnType<typeof hub>): ExpoBus => ({
    send: (m) => { if (!self.closed) peer.deliver(m); },
    on: (f) => self.on(f),
    close: () => self.close(),
  });
  return [side(a, b), side(b, a)];
}

function tauriBus(): ExpoBus {
  const h = hub();
  // Событие Tauri получают все окна, включая отправителя: метка отправителя отсекает своё эхо.
  const me = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let unlisten: (() => void) | null = null;
  const ev = import('@tauri-apps/api/event');
  void ev
    .then(({ listen }) => listen<{ from: string; m: BusMsg }>(EVENT, (e) => { if (e.payload.from !== me) h.deliver(e.payload.m); }))
    .then((u) => { if (h.closed) u(); else unlisten = u; });
  return {
    send: (m) => { if (!h.closed) void ev.then(({ emit }) => emit(EVENT, { from: me, m })); },
    on: (f) => h.on(f),
    close: () => { h.close(); unlisten?.(); unlisten = null; },
  };
}

function channelBus(): ExpoBus {
  const h = hub();
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e: MessageEvent<BusMsg>) => h.deliver(e.data);
  return {
    send: (m) => { if (!h.closed) ch.postMessage(m); },
    on: (f) => h.on(f),
    close: () => { h.close(); ch.close(); },
  };
}

const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function expoBus(): ExpoBus {
  return inApp() ? tauriBus() : channelBus();
}
