/**
 * Текст — диктовкой и вслух. fieldActions — действия поля для реестра: `<id>.write {text}` (записать заново),
 * `<id>.append {text}` (дописать), `<id>.clear`, `<id>.read` (прочитать вслух). Голосом: «запиши в замысел: …»,
 * «допиши в замысел …», «очисти замысел», «прочитай замысел» (parseDictation — для разборщика).
 *
 * readAloud — длинное читается частями (не больше двух предложений и 300 знаков): первая часть — сразу, с вопросом
 * «Дальше?»; пока есть что читать, в реестре действия `read.next` («дальше») и `read.stop` («хватит»).
 */
import { register, getAction, type Action } from './registry';
import { speakable, SPEAK_MAX_CHARS, SPEAK_MAX_SENTENCES } from './speech';

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const TEXT = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };

/** Поля, известные голосу: id → названия (для «запиши в <название>»): первое — название поля, дальше — другие слова. */
const fields = new Map<string, string[]>();

/**
 * Действия поля «title» (id — начало их имён). section — раздел действий (по умолчанию — общие); aliases — другие
 * названия поля в речи («запиши в решение» — то же, что «в замысел»).
 */
export function fieldActions(id: string, title: string, get: () => string, set: (s: string) => void, section = 'global', aliases: string[] = []): Action[] {
  fields.set(id, [title, ...aliases]);
  const low = title.toLowerCase();
  const base = { section, available: () => true as const };
  return [
    { ...base, id: `${id}.write`, title: `Записать в «${title}»`, describe: `Записывает продиктованный текст в поле «${title}» (прежний текст заменяется).`,
      params: TEXT, say: [`штаб, запиши в ${low}: …`], run: async (p: { text: string }) => { set(cap(String(p?.text ?? '').trim())); return `Записал в «${title}».`; } },
    { ...base, id: `${id}.append`, title: `Дописать в «${title}»`, describe: `Дописывает продиктованный текст в конец поля «${title}».`,
      params: TEXT, say: [`штаб, допиши в ${low} …`], run: async (p: { text: string }) => {
        const add = String(p?.text ?? '').trim();
        const cur = get().trim();
        set(cur ? `${cur} ${add}` : cap(add));
        return 'Дописал.';
      } },
    { ...base, id: `${id}.clear`, title: `Очистить «${title}»`, describe: `Стирает текст поля «${title}».`,
      say: [`штаб, очисти ${low}`], run: async () => { set(''); return `«${title}» очищено.`; } },
    { ...base, id: `${id}.read`, title: `Прочитать «${title}»`, describe: `Читает вслух текст поля «${title}» (длинный — частями).`,
      say: [`штаб, прочитай ${low}`], run: async () => (get().trim() ? readAloud(get()) : `«${title}» пусто.`) },
  ];
}

const stem = (w: string) => w.slice(0, Math.min(5, Math.max(3, w.length - 1)));
/** Сколько слов в начале words — название поля title (по основам: «в замысле», «замысел»); 0 — не оно. */
function titleSpan(words: string[], title: string): number {
  const t = norm(title).split(' ');
  if (words.length < t.length) return 0;
  return t.every((w, i) => words[i].startsWith(stem(w))) ? t.length : 0;
}

const VERBS: [RegExp, 'write' | 'append' | 'clear' | 'read'][] = [
  [/^(?:запиши|напиши|впиши|внеси|занеси)$/, 'write'], [/^(?:допиши|добавь)$/, 'append'],
  [/^(?:очисти|сотри)$/, 'clear'], [/^(?:прочитай|прочти|зачитай|читай)$/, 'read'],
];
const PREPS = new Set(['в', 'во', 'к', 'мне']);

/**
 * Диктовка голосом: rest — реплика без обращения (нормализованная), raw — как сказано (текст берётся оттуда, с
 * регистром и знаками). Поле должно быть в реестре сейчас. Не диктовка — null.
 */
export function parseDictation(rest: string, raw = rest): { id: string; params?: unknown } | null {
  const words = rest.split(' ').filter(Boolean);
  const verb = VERBS.find(([re]) => re.test(words[0] ?? ''));
  if (!verb) return null;
  let i = 1;
  while (PREPS.has(words[i] ?? '')) i++;
  // самое длинное подходящее название: «в замысел противника» — не «в замысел» с текстом «противника …»
  let best: { id: string; span: number } | null = null;
  for (const [id, names] of fields) {
    if (!getAction(`${id}.${verb[1]}`)) continue;
    for (const name of names) {
      const span = titleSpan(words.slice(i), name);
      if (span && (!best || span > best.span)) best = { id, span };
    }
  }
  if (!best) return null;
  const tail = words.slice(i + best.span);
  if (verb[1] === 'clear' || verb[1] === 'read') return tail.length ? null : { id: `${best.id}.${verb[1]}` };
  if (!tail.length) return null;
  return { id: `${best.id}.${verb[1]}`, params: { text: rawTail(raw, tail.length) ?? tail.join(' ') } };
}

/** Последние n слов фразы как сказано (со знаками внутри, без знаков по краям); не вышло — null. */
function rawTail(raw: string, n: number): string | null {
  const parts = raw.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (parts.length < n) return null;
  return parts.slice(parts.length - n).join(' ').replace(/^[^\p{L}\p{N}]+|[\s,;:—–-]+$/gu, '') || null;
}

// ---------------------------------------------------------------- чтение по частям

/** Части текста для чтения: по предложениям, не больше двух и 300 знаков; длинное предложение — по словам. */
export function readParts(text: string): string[] {
  const t = speakable(text, { full: true });
  const sentences = (t.match(/[^.!?…]+[.!?…]+["»]?|[^.!?…]+$/g) ?? [t]).map((x) => x.trim()).filter(Boolean);
  const pieces = sentences.flatMap((x) => splitLong(x, SPEAK_MAX_CHARS));
  const out: string[] = [];
  let cur: string[] = [];
  for (const s of pieces) {
    if (cur.length && (cur.length >= SPEAK_MAX_SENTENCES || [...cur, s].join(' ').length > SPEAK_MAX_CHARS)) { out.push(cur.join(' ')); cur = []; }
    cur.push(s);
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
}
function splitLong(s: string, max: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max - 1);
    if (cut < max / 2) cut = max - 1;
    out.push(`${rest.slice(0, cut).replace(/[\s,;:—–-]+$/, '')}…`);
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

let reading: { parts: string[]; i: number; off: () => void } | null = null;
/** Конец части: вопрос не кончается словом-ответом (быстрое «дальше» сервис иначе принял бы за эхо). */
const MORE = ' Читать дальше? Жду ответа.';

/** Читать текст частями: первая часть (с «Дальше?», если есть ещё) — её и сказать; дальше — read.next / read.stop. */
export function readAloud(text: string): string {
  stopReading();
  const parts = readParts(text);
  if (parts.length <= 1) return parts[0] ?? '';
  const r = { parts, i: 0, off: () => {} };
  const base = { section: 'global', available: () => true as const };
  const offs = [
    register({ ...base, id: 'read.next', title: 'Читать дальше', describe: 'Читает следующую часть текста.', say: ['дальше'],
      run: async () => next(r) }),
    register({ ...base, id: 'read.stop', title: 'Хватит читать', describe: 'Заканчивает чтение текста.', say: ['хватит'],
      run: async () => { stopReading(); } }),
  ];
  r.off = () => offs.forEach((o) => o());
  reading = r;
  return parts[0] + MORE;
}
function next(r: NonNullable<typeof reading>): string {
  if (reading !== r) return '';
  r.i++;
  const last = r.i >= r.parts.length - 1;
  const part = r.parts[r.i] ?? '';
  if (last) stopReading();
  return last ? part : part + MORE;
}
/** Закончить чтение («хватит», «стоп», новое чтение). */
export function stopReading(): void {
  reading?.off();
  reading = null;
}
