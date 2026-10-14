/**
 * Перекрёстное прочтение (проверка 8): отдельный запрос модели получает только цитату и вопросы с вариантами;
 * сравнение ответа с формальной частью кандидата — кодом. Расхождение — сомнение, не отбой.
 */
import type { Candidate, CheckResult } from './candidate';

const NUMBER_MEANINGS = ['personnel', 'tanks', 'guns', 'killed', 'wounded', 'missing', 'total', 'other'] as const;
type Meaning = (typeof NUMBER_MEANINGS)[number];

export interface CrossAnswer {
  side: 'own' | 'enemy' | 'unknown';
  plan: boolean;
  subject: string;
  date: string;
  dateTo?: string | null;
  numbers: { value: number; meaning: Meaning }[];
  note: string;
}

export const CROSS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['side', 'plan', 'subject', 'date', 'dateTo', 'numbers', 'note'],
  properties: {
    side: { type: 'string', enum: ['own', 'enemy', 'unknown'] },
    plan: { type: 'boolean' },
    subject: { type: 'string' },
    date: { type: 'string' },
    dateTo: { type: ['string', 'null'] },
    numbers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['value', 'meaning'], properties: { value: { type: 'number' }, meaning: { type: 'string', enum: [...NUMBER_MEANINGS] } } } },
    note: { type: 'string' },
  },
} as const;

export function crossMessages(quote: string): { role: 'system' | 'user'; content: string }[] {
  return [
    { role: 'system', content: `Вы читаете одну выписку из военного документа 1945 года. Ответьте на вопросы только по тексту выписки, ничего не домысливая и не используя других знаний.

- side — чья это численность, потери или положение: own — советских войск («наши», «армия», «фронт» без уточнения о противнике), enemy — противника (немецких войск, «противник», «уничтожено», «взято в плен»), unknown — по выписке не понять;
- plan — true, если это план, приказ, задача или предположение («должна», «предписано», «ожидается»), false, если описан свершившийся факт;
- subject — какое соединение (армия, корпус, дивизия, фронт) названо, как в тексте; нет — пустая строка;
- date, dateTo — день или период, к которому относится сказанное, ГГГГ-ММ-ДД (год 1945, если не указан); нет — пустая строка и null;
- numbers — каждое число из выписки с его значением (meaning): personnel — численность людей, tanks — танки и САУ, guns — орудия и миномёты, killed — убитые, wounded — раненые, missing — пропавшие без вести, total — общие потери людьми, other — любое другое число (даты, номера, километры);
- note — одной фразой по-русски: что именно сказано и о ком.

Ответ — один JSON-объект по схеме.` },
    { role: 'user', content: `Выписка:\n\n${quote}` },
  ];
}

const MEANING_RU: Record<Meaning, string> = { personnel: 'численность людей', tanks: 'танки', guns: 'орудия и миномёты', killed: 'убитые', wounded: 'раненые', missing: 'пропавшие', total: 'общие потери', other: 'иное' };
const SIDE_RU = { own: 'наши войска', enemy: 'противник', unknown: 'неясно' } as const;
const FIELDS = ['personnel', 'tanks', 'guns', 'killed', 'wounded', 'missing', 'total'] as const;

/** Сторона соединения по id сценария: su_… — свои, de_… — противник. */
function sideOfId(id: string): 'own' | 'enemy' | null {
  return /^su_/.test(id) ? 'own' : /^de_/.test(id) ? 'enemy' : null;
}

/**
 * Сравнить ответ модели с формальной частью кандидата. doubt — модель прочла иначе: «план», другая сторона,
 * другое соединение (после сопоставления по match) или другое значение числа; иначе ok.
 */
export function crossCompare(c: Candidate, answer: CrossAnswer, match: (name: string) => string | null): CheckResult {
  const whys: string[] = [];
  const claim = c.claim as unknown as Record<string, unknown>;
  const subject = typeof claim.subject === 'string' ? claim.subject : '';
  if (answer.plan) whys.push('модель прочла выписку как план или приказ, а не как свершившееся');
  const mine = subject ? sideOfId(subject) : null;
  if (mine && answer.side !== 'unknown' && answer.side !== mine) whys.push(`модель: речь о стороне «${SIDE_RU[answer.side]}», а соединение — ${SIDE_RU[mine]}`);
  const named = answer.subject?.trim();
  if (named && subject) {
    const m = match(named);
    if (m && m !== subject) whys.push(`модель называет другое соединение: «${named}»`);
  }
  for (const f of FIELDS) {
    const v = claim[f];
    if (typeof v !== 'number') continue;
    const said = answer.numbers.filter((n) => n.value === v);
    if (said.length && !said.some((n) => n.meaning === f)) whys.push(`число ${v} (${MEANING_RU[f]}) модель прочла как «${MEANING_RU[said[0].meaning]}»`);
  }
  if (!whys.length) return { check: 'cross', level: 'ok' };
  return { check: 'cross', level: 'doubt', why: `${whys.join('; ')}${answer.note ? `. Модель: ${answer.note}` : ''}` };
}
