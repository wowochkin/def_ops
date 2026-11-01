/**
 * Ударения для озвучки стенда: словарь «слово → слово с „+“ перед ударной гласной» (`bank-data/stress.json`) и вид
 * пометки, который понимает модель озвучки (знак ударения над гласной, «+» перед гласной или заглавная гласная).
 * Пометки ставятся только в тексте, уходящем на озвучку; на экране и в проверке распознаванием их нет.
 */
export type StressMark = 'acute' | 'plus' | 'upper';
export interface StressData { mark: Record<string, StressMark>; words: Record<string, string> }

const VOWEL = /[аеёиоуыэюяАЕЁИОУЫЭЮЯ]/;

/** «Х+альбе» — в вид пометки модели: «Ха́льбе», «Х+альбе», «ХАльбе». */
export function markStress(text: string, mark: StressMark): string {
  return text.replace(/\+(\p{L})/gu, (m, v: string) => {
    if (!VOWEL.test(v)) return m;
    return mark === 'acute' ? `${v}\u0301` : mark === 'upper' ? v.toUpperCase() : `+${v}`;
  });
}

/** Слова словаря в тексте — с ударением (слово целиком, без учёта регистра первой буквы). */
export function applyStress(text: string, words: Record<string, string>): string {
  const keys = Object.keys(words).sort((a, b) => b.length - a.length);
  if (!keys.length) return text;
  const esc = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.replace(new RegExp(`(?<![\\p{L}+])(${esc.join('|')})(?![\\p{L}])`, 'giu'), (w: string) => {
    const key = keys.find((k) => k.toLowerCase() === w.toLowerCase())!;
    const v = words[key];
    const up = w[0] !== w[0].toLowerCase();
    const i = v[0] === '+' ? 1 : 0;
    return v.slice(0, i) + (up ? v[i].toUpperCase() : v[i].toLowerCase()) + v.slice(i + 1);
  });
}

/** Без пометок ударения — для проверки распознаванием и показа. */
export const plainStress = (text: string) => text.replace(/\u0301/g, '').replace(/\+(?=\p{L})/gu, '');

/** Вид пометки для модели озвучки (по умолчанию — знак ударения). */
export const markFor = (engine: string, d: StressData): StressMark => d.mark[engine] ?? 'acute';

/** Текст для озвучки в каноническом виде («+» перед ударной) и в виде пометки модели. */
export function stressed(say: string, engine: string, d: StressData): { say: string; said: string } {
  const s = applyStress(say, d.words);
  return { say: s, said: markStress(s, markFor(engine, d)) };
}
