/**
 * Какой корень монтировать: `?expo=0` или автозапуск — хост стенда, `?expo=1|2` — окно вида, иначе — полный режим.
 */
import type { ExpoSettings } from './settings';
export function expoWindowIndex(search: string): number | null {
  const value = new URLSearchParams(search).get('expo');
  return value !== null && /^[0-2]$/.test(value) ? Number(value) : null;
}
export function shouldStartExpo(settings: ExpoSettings, search: string): boolean {
  return expoWindowIndex(search) !== null || settings.autostart;
}
export function chooseRoot(search: string, settings: ExpoSettings): 'shell' | 'expo-host' | 'expo-view' {
  const index = expoWindowIndex(search);
  return index !== null && index > 0 ? 'expo-view' : shouldStartExpo(settings, search) ? 'expo-host' : 'shell';
}
