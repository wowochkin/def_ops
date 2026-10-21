/**
 * Устройства звука: выбор микрофона и вывода. Выбор запоминается (id устройства; пусто — «как в системе») и
 * применяется при открытии микрофона. Чистые функции — разбор списка и выбор, что делать при смене устройств.
 */
export const MIC_KEY = 'def_ops.voice.mic';
export const OUT_KEY = 'def_ops.voice.out';

export interface AudioDevice { id: string; label: string }
export interface AudioDevices { inputs: AudioDevice[]; outputs: AudioDevice[] }

/** Список устройств из `enumerateDevices`: свои имена; без имени (доступа ещё нет) — «Микрофон 1»; системные дубли («default», «communications») не берутся. */
export function parseDevices(list: { kind: string; deviceId: string; label: string }[]): AudioDevices {
  const make = (kind: string, name: string): AudioDevice[] => {
    let n = 0;
    return list.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d) => ({ id: d.deviceId, label: d.label.trim() || `${name} ${++n}` }));
  };
  return { inputs: make('audioinput', 'Микрофон'), outputs: make('audiooutput', 'Вывод') };
}

/** Выбранное устройство есть в списке — оно; нет (отключили) — '' (как в системе). */
export const pickDevice = (saved: string, list: AudioDevice[]): string => (saved && list.some((d) => d.id === saved) ? saved : '');

/**
 * Что делать микрофону, когда список устройств изменился. Выбрали устройство и оно пропало — вернуться к системному;
 * устройство не выбрано (как в системе), а системное теперь другое (подключили веб-камеру) — открыть заново;
 * иначе ничего. Системное устройство узнаётся по списку входов: порядок и набор изменились.
 */
export function onDevicesChanged(o: { chosen: string; before: AudioDevice[]; after: AudioDevice[] }): 'keep' | 'fallback' | 'reopen' {
  if (o.chosen) return o.after.some((d) => d.id === o.chosen) ? 'keep' : 'fallback';
  const ids = (l: AudioDevice[]) => l.map((d) => d.id).join('|');
  return ids(o.before) === ids(o.after) ? 'keep' : 'reopen';
}

export const MIC_CHANGED_NOTE = 'Микрофон сменился — если штаб стал хуже слышать, пройдите калибровку заново.';
