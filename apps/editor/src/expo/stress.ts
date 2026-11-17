/**
 * Ударения для озвучки стенда: словарь «слово → слово с „+“ перед ударной гласной» (`bank-data/stress.json`) и вид
 * пометки, который понимает модель озвучки (знак ударения над гласной, «+» перед гласной или заглавная гласная).
 * Пометки ставятся только в тексте, уходящем на озвучку; на экране и в проверке распознаванием их нет.
 */
import { placeStressForms } from './stress-places';
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

/** Словарь и безопасные падежи известных топонимов; явная форма важнее производной и входной пометки. */
export function applyStress(text: string, words: Record<string, string>): string {
  const lookup = new Map(Object.entries(placeStressForms(words)));
  for (const [word, say] of Object.entries(words)) lookup.set(word.toLowerCase(), say);
  if (!lookup.size) return text;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keys = [...lookup.keys()].sort((a, b) => b.length - a.length);
  const patterns = keys.map(k => [...k].map(c => /\p{L}/u.test(c) ? `\\+?${esc(c)}\u0301?` : esc(c)).join(''));
  const re = new RegExp(`(?<![\\p{L}\\p{M}+])(?:${patterns.join('|')})(?![\\p{L}\\p{M}])`, 'giu');
  return text.normalize('NFC').replace(re, (token: string) => {
    const w = plainStress(token).normalize('NFC');
    const v = lookup.get(w.toLowerCase());
    if (!v) return token;
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
