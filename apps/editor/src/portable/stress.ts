/** Пользовательский слой из папки данных; штатный словарь остаётся резервом до загрузки служб. */
import BASE from '../expo/bank-data/stress.json';
import type { StressData } from '../expo/stress';
export interface PortableStress extends StressData { pending?: string[] }
let current: PortableStress = BASE as PortableStress;
export const runtimeStress = () => current;
const REVISION = 'def_ops.portable.stress.revision';
export async function loadPortableStress(): Promise<PortableStress> {
  const r = await fetch('/api/portable/stress', { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Словарь недоступен: ${r.status}`);
  const data = await r.json() as PortableStress;
  if (!data.words || !data.mark || typeof data.words !== 'object' || typeof data.mark !== 'object') throw new Error('Неверный формат словаря.');
  current = data;
  return current;
}
export async function savePortableStress(word: string, say: string): Promise<PortableStress> {
  const r = await fetch('/api/portable/stress', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ word, say }), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) { const detail = await r.json().catch(() => null); throw new Error(detail?.error || `Не удалось сохранить слово: ${r.status}`); }
  current = await r.json() as PortableStress;
  try { localStorage.setItem(REVISION, String(Date.now())); } catch { /* данные уже записаны в папку приложения */ }
  return current;
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => { if (e.key === REVISION) void loadPortableStress().catch(() => {}); });
  window.addEventListener('focus', () => { void loadPortableStress().catch(() => {}); });
}
