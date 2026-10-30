/**
 * Статистика дня и журнал стенда. В приложении — команды `expo_stats_*` и `expo_log` (src-tauri/src/expo_storage.rs),
 * в браузере — ключи `localStorage`. День — местная дата `ГГГГ-ММ-ДД`; приращения счётчиков идут по очереди.
 */
export interface ExpoStats {
  sessions: number;
  finished: number;
  failures: number;
}
export type StatKind = 'started' | 'finished' | 'failure';
const blank = (): ExpoStats => ({ sessions: 0, finished: 0, failures: 0 });
const day = () => new Date().toLocaleDateString('sv-SE');
const inApp = () => '__TAURI_INTERNALS__' in window;
export function telemetry() {
  let queue = Promise.resolve();
  const today = async (): Promise<ExpoStats> => {
    if (inApp()) return (await import('@tauri-apps/api/core')).invoke('expo_stats_today', { day: day() });
    try {
      return { ...blank(), ...JSON.parse(localStorage.getItem(`def_ops.expo.stats.${day()}`) ?? '{}') };
    } catch {
      return blank();
    }
  };
  return {
    today,
    add(kind: StatKind) {
      queue = queue
        .catch(() => {})
        .then(async () => {
          if (inApp()) {
            await (await import('@tauri-apps/api/core')).invoke('expo_stats_add', { kind, day: day() });
            return;
          }
          const s = await today();
          s[kind === 'started' ? 'sessions' : kind === 'finished' ? 'finished' : 'failures']++;
          localStorage.setItem(`def_ops.expo.stats.${day()}`, JSON.stringify(s));
        });
      return queue;
    },
    async log(line: string) {
      if (inApp()) {
        await (await import('@tauri-apps/api/core')).invoke('expo_log', { line, day: day() });
        return;
      }
      try {
        const key = 'def_ops.expo.log';
        localStorage.setItem(key, `${localStorage.getItem(key) ?? ''}\n${new Date().toISOString()} ${line}`.slice(-200000));
      } catch {}
    },
  };
}
