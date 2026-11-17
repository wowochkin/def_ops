/** Правка словаря студии: точечное изменение без потери существующих исправлений. */
import { plainStress, type StressData } from '../apps/editor/src/expo/stress';

export interface StudioDictionary extends StressData {
  /** Свои слова, для которых ударение ещё не выбрано. */
  pending?: string[];
}

const keyOf = (word: string) => word.toLocaleLowerCase('ru');
const tidy = (text: string) => text.normalize('NFC').trim().replace(/\s+/g, ' ');

export function dictionaryEntry(wordInput: unknown, sayInput: unknown): { word: string; say: string | null } {
  const word = tidy(String(wordInput ?? ''));
  if (!word || word.length > 120 || !/^[\p{L}]+(?:[ '\u2019-][\p{L}]+)*$/u.test(word)) {
    throw new Error('Введите слово или название буквами, без цифр и знаков ударения.');
  }
  const raw = tidy(String(sayInput ?? ''));
  if (!raw) return { word, say: null };
  const say = raw.replace(/([аеёиоуыэюя])\u0301/giu, '+$1');
  if (keyOf(plainStress(say)) !== keyOf(word)) throw new Error('В поле ударения должно быть то же слово: добавьте «+» перед нужной гласной.');
  if (!say.includes('+')) return { word, say: null };
  if (/\+(?![аеёиоуыэюя])/iu.test(say) || say.includes('\u0301')) throw new Error('Знак «+» ставится непосредственно перед гласной.');
  for (const part of say.split(/[ '\u2019-]+/u)) {
    if ((part.match(/\+/g) ?? []).length > 1) throw new Error('В одном слове можно указать только одно ударение.');
  }
  return { word, say };
}

/** Пустое ударение оставляет слово в каталоге для последующей правки. */
export function updateDictionary(data: StudioDictionary, wordInput: unknown, sayInput: unknown): StudioDictionary {
  const { word, say } = dictionaryEntry(wordInput, sayInput);
  const words = { ...data.words };
  const matches = Object.keys(words).filter(k => keyOf(k) === keyOf(word));
  if (say) {
    // Старый словарь может содержать варианты регистра. Обновляем их согласованно,
    // иначе первая старая запись продолжит перекрывать исправление пользователя.
    for (const key of matches.length ? matches : [word]) words[key] = say;
  } else {
    for (const key of matches) delete words[key];
  }
  const pending = (data.pending ?? []).filter(k => keyOf(k) !== keyOf(word));
  if (!say) pending.push(word);
  return { ...data, words, pending };
}
