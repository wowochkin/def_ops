/**
 * Проверки служб стенда и первый прогон при запуске.
 *
 * Ядро в приложении — пробная игра по сценарию Берлинской операции при первой проверке, дальше — чтение сценария
 * командой ядра; в браузере ядро не проверяется. Голос — `/api/voice`, модель — список моделей локальной LM Studio.
 * `runProbes` повторяет неудачные проверки раз в секунду до двух минут, но отпускает раньше, если ядро и окна готовы,
 * а голос и модель уже ответили (хотя бы отказом) — тогда стенд стартует без ИИ.
 */
import { checkProbe, type Probe, type ProbeStates } from './health';
const scenario = 'packages/sim/data/scenarios/agents/berlin-1945.json';
const app = () => '__TAURI_INTERNALS__' in window;
async function json(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw Error(String(r.status));
  return r.json();
}
/** Порты локальной модели: LM Studio обычно на 1234, Bionic — на 1235. Берётся тот, где есть не-эмбеддинг. */
const MODEL_URLS = ['http://127.0.0.1:1235/v1', 'http://127.0.0.1:1234/v1'];
let liveModel: string | null = null;

async function modelsAt(url: string): Promise<string[]> {
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000));
  if (app()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await Promise.race([invoke<string[]>('list_models', { url }), timeout]);
  }
  const r = await fetch(`${url}/models`, { signal: AbortSignal.timeout(2000) });
  if (!r.ok) throw Error(String(r.status));
  const j = await r.json() as { data?: { id: string }[] };
  return (j.data ?? []).map((m) => m.id);
}

/** Адрес живой локальной модели или null. Настройки полного режима могут указывать другой сервер — стенд их не берёт. */
export async function findLocalModel(): Promise<string | null> {
  if (liveModel) return liveModel;
  for (const url of MODEL_URLS) {
    try {
      const models = await modelsAt(url);
      if (models.some((id) => !id.toLowerCase().includes('embed'))) {
        liveModel = url;
        return url;
      }
    } catch { /* следующий порт */ }
  }
  return null;
}

/** Адрес модели фиксирован на loopback: настройки полного режима могут указывать удалённый сервер. */
export function localProbes(windowsReady: () => boolean): Probe[] {
  let booted = false;
  return [
    {
      id: 'core',
      label: 'Ядро',
      check: async () => {
        if (!app()) return true; // браузер показывает каркас, ядро доступно только в приложении или мосте
        const { invoke } = await import('@tauri-apps/api/core');
        if (!booted) {
          try {
            await invoke('game_start', { scenario, seed: 1, takeover: 0, player: 'su', enemy: 'intent', mode: 'intent' });
            booted = true;
          } finally {
            await invoke('game_stop');
          }
        }
        const text = await invoke<string>('read_text', { path: scenario });
        return JSON.parse(text).id !== undefined;
      },
    },
    { id: 'voice', label: 'Голос', check: async () => (await json('/api/voice')).state === 'ready' },
    {
      id: 'model',
      label: 'Языковая модель',
      check: async () => (await findLocalModel()) !== null,
    },
    { id: 'windows', label: 'Экраны', check: async () => windowsReady() },
  ];
}
export async function runProbes(probes: Probe[], onState: (states: ProbeStates) => void, signal: AbortSignal): Promise<ProbeStates> {
  const states: ProbeStates = { core: 'off', voice: 'off', model: 'off', windows: 'off' };
  for (const p of probes) states[p.id] = 'wait';
  onState({ ...states });
  const deadline = Date.now() + 120000;
  do {
    await Promise.all(
      probes
        .filter((p) => states[p.id] !== 'ok')
        .map(async (p) => {
          states[p.id] = (await checkProbe(p, Math.min(10000, deadline - Date.now()), signal)) ? 'ok' : 'fail';
        }),
    );
    if (signal.aborted) return states;
    onState({ ...states });
    if (probes.every((p) => states[p.id] === 'ok')) return states;
    // Явно отсутствующие необязательные службы допускают быстрый запуск резервного режима.
    if (states.core === 'ok' && states.windows === 'ok' && states.model !== 'wait' && states.voice !== 'wait') return states;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const t = setTimeout(done, 1000);
      signal.addEventListener('abort', done, { once: true });
    });
  } while (!signal.aborted && Date.now() < deadline);
  return states;
}
