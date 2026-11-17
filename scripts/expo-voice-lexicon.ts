/** Корпус слов студии: только каталог и пометки из пользовательского словаря, без синтеза и записи. */
import { readFileSync } from 'node:fs';
import SUGGESTIONS from './data/stress-suggestions.json';
import PLACES_RU from '../packages/sim/data/places-ru.json';
import SCENARIO from '../packages/sim/data/scenarios/agents/berlin-1945.json';
import ALIASES from '../apps/editor/src/voice/place-aliases.json';
import { BANK, PLACE_TITLE } from '../apps/editor/src/expo/bank';
import { EXCURSION } from '../apps/editor/src/expo/excursion';
import { INTRO_CUES, INTRO_FACTORS } from '../apps/editor/src/expo/intro-story';
import { MAP } from '../apps/editor/src/expo/map';
import { stageDomains, voiceTexts } from '../apps/editor/src/expo/prerecord';
import { plainStress, type StressData } from '../apps/editor/src/expo/stress';
import { placeStressForms, placeWordForms, STRESS_PLACE_WORDS } from '../apps/editor/src/expo/stress-places';
import { speakable } from '../apps/editor/src/voice/speech';

export type LexiconStatus = 'explicit' | 'derived' | 'missing' | 'inherent';
export interface LexiconEntry {
  word: string;
  /** Канонический «+» перед ударной; null означает, что словарь ударение не задаёт. */
  say: string | null;
  /** Неподтверждённая словарная подсказка; не применяется к озвучке до сохранения. */
  suggestion: string | null;
  kind: 'place' | 'word';
  status: LexiconStatus;
  sources: string[];
  examples: string[];
}
export interface Lexicon {
  entries: LexiconEntry[];
  coverage: { total: number } & Record<LexiconStatus, number>;
}

const tokenize = (text: string) => plainStress(text).normalize('NFC').match(/[\p{Script=Cyrillic}]+/gu) ?? [];
let sourceCache: string[] | undefined;
const defaultCorpus: { source: string; texts: string[] }[] = [
  { source: 'Предзапись и подстановки', texts: voiceTexts(stageDomains(SCENARIO.start, SCENARIO.hours)) },
  { source: 'Карточки решений', texts: BANK.cards.flatMap(c => [c.title, ...c.lines, c.risk ?? '', c.fact?.text ?? '']) },
  { source: 'Обстановка', texts: Object.values(BANK.fronts).flatMap(f => [f.name, f.marshal, ...f.turns.flatMap(t => [t.title, t.situation])]) },
  { source: 'Интро', texts: [...INTRO_CUES.flatMap(c => [c.chapter, c.title, c.detail]), ...INTRO_FACTORS] },
  { source: 'История операции', texts: EXCURSION.flatMap(b => [b.title, b.text, ...b.facts.flatMap(f => [f.value, f.label])]) },
  { source: 'Карта операции', texts: [...MAP.cities.map(c => c.name), ...MAP.events.map(e => e.title)] },
  { source: 'Названия мест', texts: [...Object.values(PLACES_RU), ...Object.values(PLACE_TITLE), ...Object.values(ALIASES).flatMap(x => Array.isArray(x) ? x : [])] },
  { source: 'Разбор и итоги', texts: sourceVocabulary() },
];
const places = new Set(STRESS_PLACE_WORDS.flatMap(placeWordForms).map(w => w.toLowerCase()));
const cap = (word: string) => word[0].toUpperCase() + word.slice(1).toLowerCase();

/**
 * Детерминированный каталог: все известные тексты и названия + дополнительные живые/сохранённые реплики.
 * Нет обещания угадать весь будущий словарь LLM: неизвестные слова попадают сюда через extraTexts.
 * Словарь не изменяется; односложные и слова с «ё» выделены отдельно от неизвестных ударений.
 */
export function buildLexicon(stress: Pick<StressData, 'words'> & { pending?: string[] }, extraTexts: string[] = []): Lexicon {
  const rows = new Map<string, { word: string; kind: LexiconEntry['kind']; sources: Set<string>; examples: Set<string> }>();
  const add = (word: string, source: string, example?: string, custom = false) => {
    const key = word.toLowerCase();
    if (!key || (!custom && !/[а-яё]/i.test(key))) return;
    let row = rows.get(key);
    if (!row) {
      const kind = places.has(key) ? 'place' : 'word';
      row = { word: kind === 'place' ? cap(word) : key, kind, sources: new Set(), examples: new Set() };
      rows.set(key, row);
    }
    row.sources.add(source);
    if (example && row.examples.size < 3) row.examples.add(example.replace(/\s+/g, ' ').trim().slice(0, 260));
  };
  for (const { source, texts } of [...defaultCorpus, { source: 'Дополнительные реплики', texts: extraTexts }]) {
    for (const text of texts) {
      // Словарь покрывает и исходный текст, и слова, появляющиеся при раскрытии чисел/сокращений.
      for (const word of new Set([...tokenize(text), ...tokenize(speakable(text, { full: true }))])) add(word, source, text);
    }
  }
  for (const word of STRESS_PLACE_WORDS) for (const form of placeWordForms(word)) add(form, form === word ? 'Названия мест' : 'Падежные формы мест', word);
  for (const word of Object.keys(stress.words)) for (const token of tokenize(word)) add(token, 'Пользовательский словарь');
  // Своя запись может быть фразой или названием с дефисом: в редакторе она остаётся целиком.
  for (const word of [...Object.keys(stress.words), ...(stress.pending ?? [])]) {
    const clean = plainStress(word).normalize('NFC').trim();
    add(clean, 'Пользовательский словарь', undefined, true);
    const row = rows.get(clean.toLowerCase());
    if (row) row.word = clean;
  }
  const explicit = new Map(Object.entries(stress.words).map(([word, say]) => [word.toLowerCase(), say]));
  const derived = placeStressForms(stress.words);
  const coverage: Lexicon['coverage'] = { total: rows.size, explicit: 0, derived: 0, inherent: 0, missing: 0 };
  const entries = [...rows.entries()].map(([key, row]): LexiconEntry => {
    const say = explicit.get(key) ?? derived[key] ?? null;
    const parts = key.match(/\p{L}+/gu) ?? [];
    const inherent = parts.length > 0 && parts.every(w => /^[а-яё]+$/iu.test(w) && ((w.match(/[аеёиоуыэюя]/g)?.length ?? 0) <= 1 || w.includes('ё')));
    const status: LexiconStatus = explicit.has(key) ? 'explicit' : derived[key] ? 'derived' : inherent ? 'inherent' : 'missing';
    coverage[status]++;
    const suggested = (SUGGESTIONS as Record<string, string>)[key];
    const obvious = inherent ? row.word.replace(/[а-яё]+/giu, w => w.replace(w.match(/[ёЁ]/)?.[0] ?? w.match(/[аеёиоуыэюя]/iu)?.[0] ?? /$^/, v => '+' + v)) : null;
    const at = suggested?.indexOf('+') ?? -1;
    const suggestion = say ? null : at >= 0 ? row.word.slice(0, at) + '+' + row.word.slice(at) : obvious;
    return { word: row.word, say, suggestion, status, kind: row.kind, sources: [...row.sources].sort(), examples: [...row.examples] };
  }).sort((a, b) => a.word.localeCompare(b.word, 'ru'));
  return { entries, coverage };
}

/** Читает только строковые литералы отчёта/разбора; не запускает модель и не обращается к GAME. */
export function sourceVocabulary(): string[] {
  if (!sourceCache) {
    const out = new Set<string>();
    for (const path of ['debrief.ts', 'score.ts', 'stage.ts']) {
      const source = readFileSync(new URL(`../apps/editor/src/expo/${path}`, import.meta.url), 'utf8');
      // Комментарии пропускаются; содержимое подстановок не становится примером для пользователя.
      const literals = /(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(['"`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g;
      for (const match of source.matchAll(literals)) {
        if (!match[1]) continue;
        const text = match[2].replace(/\$\{[^}]*\}/g, '…').replace(/\\[nrt]/g, ' ').replace(/\\([\\'"`])/g, '$1');
        if (/[а-яё]/i.test(text) && !/[{}]|=>/.test(text)) out.add(text);
      }
    }
    sourceCache = [...out];
  }
  return [...sourceCache];
}
