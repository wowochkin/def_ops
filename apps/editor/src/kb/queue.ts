/**
 * Очередь «На проверку» и итоги документа — чистые функции: причины сомнения, фильтры, групповой приём
 * («принять все, где сомнение только в …»), правка формальной части на месте, подсказка модели по кнопке
 * («Почему сомнение», «Предложи исправление»), принятое и отброшенное из документа.
 */
import type { Candidate, CheckId, Claim, Entry, Fact } from '@def-ops/knowledge';
import type { StoredCandidate } from './candidates';

/** Проверки по-русски (причины сомнения и отбоя). */
export const CHECK_RU: Record<CheckId, string> = {
  quote: 'цитата', numbers: 'числа', subject: 'соединение', param: 'норматив', place: 'место', date: 'дата', plausible: 'правдоподобие', duplicate: 'повтор', cross: 'перекрёстная проверка',
};
export const CHECK_IDS = Object.keys(CHECK_RU) as CheckId[];

/** Вид в фильтре очереди: вид формальной части или 'text' — предложение записи (без формальной части). */
export type QueueKind = Claim['kind'] | 'text';
export interface QueueFilter { doc?: string; kind?: QueueKind; subject?: string; reason?: CheckId; op?: string }

type AnyCand = Candidate | StoredCandidate;

/** Документ кандидата: из доказательства, иначе из источника doc:… */
export function candDoc(c: AnyCand): string | undefined {
  return (c.evidence && 'doc' in c.evidence ? c.evidence.doc : undefined) ?? (c.source?.startsWith('doc:') ? c.source.slice(4) : undefined);
}

/** Причины сомнения кандидата (проверки с doubt, без повторов, в порядке проверок). */
export function doubtKinds(c: AnyCand): CheckId[] {
  return [...new Set(c.checks.filter((r) => r.level === 'doubt').map((r) => r.check))];
}

/** Причины отбоя (проверки с fail). */
export const failKinds = (c: AnyCand): CheckId[] => [...new Set(c.checks.filter((r) => r.level === 'fail').map((r) => r.check))];

/** О ком кандидат: id соединения (subject, оба в линии) и названия из источника. */
export function candSubjects(c: AnyCand): string[] {
  const cl = c.claim;
  const ids = !cl ? [] : cl.kind === 'boundary' ? cl.between : cl.kind === 'event' || cl.kind === 'param' || cl.kind === 'outcome' ? [] : [cl.subject];
  return [...ids, c.names.subject, ...(c.names.between ?? [])].filter((x): x is string => !!x);
}

/** Соединения кандидата для списка фильтра: id, а где не сопоставлено — название из источника. */
export function subjectKeys(c: AnyCand): string[] {
  const cl = c.claim;
  if (!cl || cl.kind === 'event' || cl.kind === 'param') return [];
  if (cl.kind === 'boundary') return cl.between.map((x, i) => x || c.names.between?.[i] || '').filter(Boolean);
  return [cl.subject || c.names.subject || ''].filter(Boolean);
}

/** Вид кандидата для фильтра. */
export const candKind = (c: AnyCand): QueueKind => c.claim?.kind ?? 'text';

/** Отбор очереди: документ, вид, соединение (id или название из источника), причина сомнения, операция. */
export function filterQueue<T extends AnyCand>(list: T[], f: QueueFilter): T[] {
  return list.filter((c) =>
    (!f.doc || candDoc(c) === f.doc)
    && (!f.kind || candKind(c) === f.kind)
    && (!f.subject || candSubjects(c).includes(f.subject))
    && (!f.reason || doubtKinds(c).includes(f.reason))
    && (!f.op || c.op === f.op));
}

/** Кандидаты, у которых сомнение ровно одно — в reason (для «принять все, где сомнение только в …»). */
export function onlyDoubt<T extends AnyCand>(list: T[], reason: CheckId): T[] {
  return list.filter((c) => { const d = doubtKinds(c); return d.length === 1 && d[0] === reason; });
}

/** Группировка причин: сколько кандидатов с каждой причиной и сколько — только с ней (по убыванию). */
export function reasonGroups(list: AnyCand[]): { reason: CheckId; n: number; only: number }[] {
  const m = new Map<CheckId, { n: number; only: number }>();
  for (const c of list) {
    const d = doubtKinds(c);
    for (const r of d) { const x = m.get(r) ?? { n: 0, only: 0 }; x.n++; if (d.length === 1) x.only++; m.set(r, x); }
  }
  return [...m].map(([reason, x]) => ({ reason, ...x })).sort((a, b) => b.n - a.n || CHECK_IDS.indexOf(a.reason) - CHECK_IDS.indexOf(b.reason));
}

/* ───────────── правка формальной части ───────────── */

export type FieldType = 'text' | 'date' | 'number' | 'list' | 'state' | 'subject';
export interface ClaimField { key: string; title: string; type: FieldType }

const F = (key: string, title: string, type: FieldType): ClaimField => ({ key, title, type });
const NUMS = [F('personnel', 'людей', 'number'), F('tanks', 'танков', 'number'), F('guns', 'орудий', 'number')];
/** Поля формальной части каждого вида (что правится в карточке). Соединение — отдельным выбором. */
export const CLAIM_FIELDS: Record<Claim['kind'], ClaimField[]> = {
  strength: [F('at', 'на дату', 'date'), ...NUMS],
  reinforce: [F('at', 'дата', 'date'), ...NUMS],
  parent: [F('from', 'с', 'date'), F('parent', 'вышестоящее', 'subject')],
  enter: [F('at', 'ввод', 'date')],
  position: [F('at', 'на дату', 'date'), F('place', 'пункт', 'text'), F('uncertaintyKm', '± км', 'number')],
  boundary: [F('from', 'с', 'date'), F('to', 'по', 'date'), F('points', 'пункты (через «—»)', 'list'), F('inclusive', 'включительно для', 'text')],
  crossing: [F('subject', 'переправа', 'text'), F('from', 'с', 'date'), F('state', 'состояние', 'state')],
  event: [F('title', 'событие', 'text'), F('at', 'дата', 'date'), F('place', 'место', 'text')],
  losses: [F('from', 'с', 'date'), F('to', 'по', 'date'), F('killed', 'убитых', 'number'), F('wounded', 'раненых', 'number'), F('missing', 'пропавших', 'number'), F('total', 'всего', 'number'), F('tanks', 'танков', 'number')],
  // нормативы модели: полная форма — в задаче 3 части 3
  param: [F('param', 'параметр', 'text'), F('value', 'значение', 'number'), F('unit', 'единица', 'text'), F('why', 'почему допущение', 'text')],
  outcome: [F('measure', 'мера', 'text'), F('scenario', 'сценарий', 'text'), F('from', 'с', 'date'), F('to', 'по', 'date'), F('unit', 'единица', 'text')],
};

export const CROSSING_STATE_RU: Record<Extract<Claim, { kind: 'crossing' }>['state'], string> = { open: 'действует', destroyed: 'разрушена', built: 'наведена' };

/** Значение поля для поля ввода. */
export function fieldText(claim: Claim, key: string): string {
  const v = (claim as Record<string, unknown>)[key];
  if (Array.isArray(v)) return v.join(' — ');
  return v == null ? '' : String(v);
}

/** Число из ввода: «4 910», «4.910», «4910» → 4910; пусто — undefined; не число — null. */
export function parseCount(raw: string): number | undefined | null {
  const s = raw.trim();
  if (!s) return undefined;
  const t = /^\d{1,3}(?:[ .  ]\d{3})+$/.test(s) ? s.replace(/[ .  ]/g, '') : s.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Поле формальной части из ввода (пустое числовое и необязательное поле убирается). Негодное число — без изменения. */
export function setClaimField(claim: Claim, key: string, raw: string): Claim {
  const f = CLAIM_FIELDS[claim.kind].find((x) => x.key === key) ?? (key === 'subject' ? F('subject', '', 'subject') : null);
  if (!f) return claim;
  const out = { ...claim } as Record<string, unknown>;
  if (f.type === 'number') {
    const n = parseCount(raw);
    if (n === null) return claim;
    if (n === undefined) delete out[key]; else out[key] = n;
  } else if (f.type === 'list') out[key] = raw.split(/\s*[—–]\s*|\s*;\s*/).map((x) => x.trim()).filter(Boolean);
  else if (f.type === 'state') { if (!(raw in CROSSING_STATE_RU)) return claim; out[key] = raw; }
  else if (!raw.trim() && (key === 'place' || key === 'to' || key === 'inclusive')) delete out[key];
  else out[key] = f.type === 'date' ? raw.trim().slice(0, 10) : raw.trim();
  return out as Claim;
}

/** Соединение кандидата (между — i-й из пары). */
export function setSubject(claim: Claim, id: string, i = 0): Claim {
  if (claim.kind === 'boundary') { const b: [string, string] = [...claim.between]; b[i] = id; return { ...claim, between: b }; }
  if (claim.kind === 'event' || claim.kind === 'param' || (claim.kind === 'outcome' && claim.measure === 'frontage')) return claim;
  return { ...claim, subject: id };
}

/* ───────────── подсказка модели по кнопке ───────────── */

export type AssistMode = 'why' | 'fix';
/** Ответ модели: объяснение и (для «Предложи исправление») правки полей формальной части. */
export interface AssistAnswer { explanation: string; fixes: { field: string; value: string }[] }

export const ASSIST_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['explanation', 'fixes'],
  properties: {
    explanation: { type: 'string' },
    fixes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['field', 'value'], properties: { field: { type: 'string' }, value: { type: 'string' } } } },
  },
} as const;

/** Текст доказательства для модели и человека: цитата, расшифровка страницы, ячейки строки, выписка агента. */
export function evidenceText(c: AnyCand, transcript?: string): string {
  const e = c.evidence;
  if (e.kind === 'quote') return `Цитата из документа: «${e.quote}»`;
  if (e.kind === 'scan') return `Страница ${e.page} скана. Цитата: «${e.quote}»${transcript ? `\nРасшифровка страницы:\n${transcript.slice(0, 3000)}` : ''}`;
  if (e.kind === 'row') return `Строка ${e.row} таблицы: ${Object.entries(e.cells).map(([k, v]) => `${k}: ${v}`).join('; ')}`;
  if (e.kind === 'agent') return `Выписка внешнего агента (${e.ref})${e.quote ? `: «${e.quote}»` : ''}`;
  return `Ручной ввод${e.note ? `: ${e.note}` : ''}`;
}

/**
 * Запрос модели роли разбора: кандидат, доказательство, причины сомнения. why — объяснить сомнение (правки — по
 * желанию), fix — предложить правку полей формальной части (поле и новое значение строкой).
 */
export function assistMessages(c: AnyCand, mode: AssistMode, evidence: string): { role: 'system' | 'user'; content: string }[] {
  const fields = c.claim ? CLAIM_FIELDS[c.claim.kind].map((f) => f.key) : [];
  const subj = c.claim && c.claim.kind !== 'event' ? (c.claim.kind === 'boundary' ? ['between0', 'between1'] : ['subject']) : [];
  const reasons = c.checks.filter((r) => r.level !== 'ok').map((r) => `- ${CHECK_RU[r.check]} (${r.level === 'fail' ? 'отбой' : 'сомнение'}): ${r.why ?? ''}`).join('\n') || '- нет';
  return [
    { role: 'system', content: `Вы помогаете историку проверить факт, который модель выписала из документа о боевых действиях 1945 года, прежде чем он попадёт в базу знаний и в модель операции. Код проверил факт и высказал сомнения. Опирайтесь только на доказательство — ничего не выдумывайте.
${mode === 'why' ? 'Объясните простыми словами (2–4 предложения), почему возникло сомнение и что человеку проверить в источнике. Правки (fixes) — только если ошибка очевидна из доказательства, иначе пустой список.' : 'Предложите исправление: какие поля формальной части поменять, чтобы факт точно соответствовал доказательству. В explanation — коротко, что и почему исправлено; не нужно исправлять — пустой список fixes и объяснение почему.'}
Поля для правки (field): ${[...subj, ...fields].join(', ') || 'нет'}. Значение (value) — строкой: даты ГГГГ-ММ-ДД, числа цифрами без пробелов, соединение — название как в источнике, пункты линии — через « — », состояние переправы — open, destroyed или built.
Ответ — JSON: explanation, fixes.` },
    { role: 'user', content: `Факт: ${c.key} — ${c.value}
Формальная часть: ${c.claim ? JSON.stringify(c.claim) : 'нет (предложение записи)'}
Названия в источнике: ${JSON.stringify(c.names)}
${evidence}
Причины сомнения:
${reasons}` },
  ];
}

/**
 * Правки модели → правка кандидата для карточки (принимает человек): поля формальной части по её виду;
 * соединение — по названию (match → id; не нашлось — название в names, id пуст). Чужие поля пропускаются.
 */
export function applyFixes(c: AnyCand, fixes: AssistAnswer['fixes'], match: (name: string) => string | null): { claim?: Claim; names?: Candidate['names'] } {
  if (!c.claim) return {};
  let claim = c.claim;
  let names = { ...c.names };
  let touched = false;
  for (const { field, value } of fixes ?? []) {
    if (typeof field !== 'string' || typeof value !== 'string') continue;
    const m = /^(subject|between([01]))$/.exec(field);
    if (m && claim.kind !== 'event' && !(claim.kind === 'crossing' && field === 'subject')) {
      const i = m[2] ? +m[2] : 0;
      if (m[2] && claim.kind !== 'boundary') continue;
      claim = setSubject(claim, match(value) ?? '', i);
      if (claim.kind === 'boundary') { const b: [string, string] = [...(names.between ?? ['', ''])] as [string, string]; b[i] = value; names = { ...names, between: b }; }
      else names = { ...names, subject: value };
      touched = true;
      continue;
    }
    if (!CLAIM_FIELDS[claim.kind].some((f) => f.key === field)) continue;
    // вышестоящее — как соединение: id по названию (не нашлось — пусто), название — в names
    if (field === 'parent') { claim = { ...claim, parent: match(value) ?? '' } as Claim; names = { ...names, parent: value }; touched = true; continue; }
    const next = setClaimField(claim, field, value);
    if (next !== claim) { claim = next; touched = true; }
  }
  return touched ? { claim, names } : {};
}

/* ───────────── итоги документа ───────────── */

/** Документ факта: из доказательства, иначе из источника doc:… */
const factDoc = (f: Fact): string | undefined =>
  (f.evidence && 'doc' in f.evidence ? f.evidence.doc : undefined) ?? (f.source?.startsWith('doc:') ? f.source.slice(4) : undefined);

/** Принятое из документа: факты записей с проверкой (авто или человек) и с этим документом в источнике. */
export function docAccepted(entries: Entry[], docId: string): { entry: Entry; index: number; fact: Fact }[] {
  const out: { entry: Entry; index: number; fact: Fact }[] = [];
  for (const entry of entries) (entry.facts ?? []).forEach((fact, index) => { if (fact.check && factDoc(fact) === docId) out.push({ entry, index, fact }); });
  return out;
}

/** Отброшенное из документа: отклонённые кандидаты с причинами (провалы проверок; отклонённые человеком — без них). */
export function docDropped<T extends AnyCand>(list: T[], docId: string): T[] {
  return list.filter((c) => c.state === 'rejected' && candDoc(c) === docId);
}

/** Текст с выделенными числами (разряды через пробел или точку — одно число): куски для подсветки. */
export function numberParts(text: string): { t: string; num: boolean }[] {
  const out: { t: string; num: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(/\d{1,3}(?:[   .]\d{3}(?!\d))+(?:,\d+)?|\d+(?:[.,]\d+)?/g)) {
    if (m.index! > last) out.push({ t: text.slice(last, m.index), num: false });
    out.push({ t: m[0], num: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), num: false });
  return out;
}
