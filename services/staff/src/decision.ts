/**
 * Решение штаба стороны, которую ведёт модель: схема ответа и проверки
 * исполнимости. Не зависит от сценария и эпохи.
 *
 * Модель отвечает строго по схеме (строгий JSON-режим LM Studio). Тексты — на
 * русском; правила терминологии — в профиле стороны. Проверки здесь — только
 * формальные: ответ разобран, приказы отданы своим формированиям, районы —
 * из списка обстановки. Военную состоятельность оценивают эксперты.
 */

export const TASKS = ['defend', 'hold', 'delay', 'withdraw', 'counterattack', 'attack', 'breakout', 'regroup', 'reserve', 'relieve'] as const;
export type Task = (typeof TASKS)[number];
export const TASK_RU: Record<Task, string> = {
  defend: 'оборонять', hold: 'удерживать любой ценой', delay: 'сдерживать', withdraw: 'отходить', counterattack: 'контратаковать',
  attack: 'наступать', breakout: 'прорываться', regroup: 'перегруппироваться', reserve: 'в резерв', relieve: 'деблокировать',
};

export interface Order {
  /** Формирование из списка своих сил обстановки. */
  formation: string;
  task: Task;
  /** Район или рубеж из списка обстановки. */
  area: string;
  /** Куда (для отхода, прорыва, перегруппировки), иначе null. */
  toArea: string | null;
  /** Срок: «к 06:00 16.04», «в ночь на 17.04». */
  deadline: string;
  /** Подробности: силы, порядок, взаимодействие. */
  details: string;
}

export interface Decision {
  /** Оценка обстановки — развёрнуто, как доклад начальника штаба. */
  assessment: string;
  /** Как штаб понимает замысел советских войск. */
  enemyIntent: string;
  /** Замысел своих действий. */
  intent: string;
  orders: Order[];
  /** Доклады и просьбы вышестоящему командованию (резервы, разрешение на отход). */
  requests: string[];
  /** Главные риски решения. */
  risks: string[];
  /** Распоряжения по тылу, переправам, резервам (в игре, если штаб их ведёт). */
  actions?: StaffActionGiven[];
}

const str = { type: 'string' };
export const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assessment', 'enemyIntent', 'intent', 'orders', 'requests', 'risks'],
  properties: {
    assessment: str,
    enemyIntent: str,
    intent: str,
    orders: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['formation', 'task', 'area', 'toArea', 'deadline', 'details'],
        properties: {
          formation: str,
          task: { type: 'string', enum: [...TASKS] },
          area: str,
          toArea: { type: ['string', 'null'] },
          deadline: str,
          details: str,
        },
      },
    },
    requests: { type: 'array', items: str },
    risks: { type: 'array', items: str },
  },
} as const;

/** Распоряжение штаба модели помимо приказов войскам: тыл, переправы, резервы (только в игре, где штаб ведёт их сам). */
export const STAFF_ACTION_KINDS = ['base', 'priority', 'bridge', 'demolish', 'commit'] as const;
export interface StaffActionGiven {
  kind: (typeof STAFF_ACTION_KINDS)[number];
  /** База снабжения (base) или формирование из резерва (commit). */
  subject: string | null;
  /** Пункт: куда перенести базу, где навести переправу или подорвать мост, район ввода резерва. */
  area: string | null;
  /** Формирования с приоритетом подвоза (priority). */
  formations: string[];
}

/** Решение в игре: то же, что DECISION_SCHEMA, и распоряжения по тылу, переправам, резервам. */
export const LIVE_DECISION_SCHEMA = {
  ...DECISION_SCHEMA,
  required: [...DECISION_SCHEMA.required, 'actions'],
  properties: {
    ...DECISION_SCHEMA.properties,
    actions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['kind', 'subject', 'area', 'formations'],
        properties: { kind: { type: 'string', enum: [...STAFF_ACTION_KINDS] }, subject: { type: ['string', 'null'] }, area: { type: ['string', 'null'] }, formations: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
} as const;

/**
 * Быстрое решение — первая часть ответа по частям: замысел и приказы, коротко,
 * без размышления. Приказы уходят в движок по одному, по мере генерации;
 * развёрнутая оценка обстановки идёт отдельным запросом в фоне.
 */
export interface QuickDecision {
  intent: string;
  orders: Order[];
}

export const QUICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'orders'],
  properties: {
    intent: DECISION_SCHEMA.properties.intent,
    orders: DECISION_SCHEMA.properties.orders,
  },
} as const;

export interface Issue {
  level: 'error' | 'warning';
  text: string;
}

/** Сравнение названий без учёта регистра, кавычек и оригинального названия в скобках. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[«»"'„“”.,]/g, '').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Оригинальное название в скобках: «(21. Panzer-Division)» → «21 panzer-division». */
function original(s: string): string {
  const m = /\(([^()]*(?:\([^()]*\)[^()]*)*)\)/.exec(s);
  return m ? m[1].toLowerCase().replace(/[«»"'„“”.,]/g, '').replace(/\s+/g, ' ').trim() : '';
}

/** Основы значимых слов (первые 5 букв; числа — целиком): «21-й танковой дивизии» ≈ «21-я танковая дивизия». */
function stems(s: string): Set<string> {
  return new Set(norm(s).split(/[\s—–-]+/).filter((w) => w.length > 2 || /\d/.test(w)).map((w) => (/^\d/.test(w) ? w.replace(/\D.*$/, '') : w.slice(0, 5))));
}

/** Индекс элемента списка, которому соответствует название (−1 — нет): точное совпадение, затем оригинал в скобках, вхождение, общие основы слов. */
export function findName(name: string, list: string[], places = false): number {
  const n = norm(name);
  const o = original(name), sn = stems(name);
  if (!n && !o) return -1;
  const exact = list.findIndex((x) => norm(x) === n && !!n);
  if (exact >= 0) return exact;
  let best = -1, score = 0;
  list.forEach((x, i) => {
    let s = 0;
    const ox = original(x);
    // пункты (places): «Seelow» против «Зелов (Seelow)» — и по исходному названию без скобок; у формирований так не угадываем
    if ((o && o === ox) || (places && n && ox && n === ox)) s = 3;
    else if (places && n && ox && (n.includes(ox) || ox.includes(n)) && Math.min(n.length, ox.length) >= 4) s = 2.5;
    else if (n) {
      const k = norm(x);
      if (k && (n.includes(k) || k.includes(n))) s = 2 + Math.min(k.length, n.length) / Math.max(k.length, n.length);
      else {
        const sk = stems(x);
        const common = [...sn].filter((w) => sk.has(w)).length;
        if (common >= 2 && common / Math.min(sn.size, sk.size) >= 0.75) s = 1 + common / Math.max(sn.size, sk.size);
      }
    }
    if (s > score) { score = s; best = i; }
  });
  return best;
}

export function known(name: string, list: string[], places = false): boolean {
  return findName(name, list, places) >= 0;
}

/** Формальная проверка решения против обстановки. */
export function checkDecision(raw: unknown, ctx: { formations: string[]; areas: string[] }): { decision: Decision | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const d = raw as Partial<Decision> | null;
  if (!d || typeof d !== 'object') return { decision: null, issues: [{ level: 'error', text: 'ответ — не объект' }] };
  for (const k of ['assessment', 'enemyIntent', 'intent'] as const) {
    if (typeof d[k] !== 'string' || !d[k]!.trim()) issues.push({ level: 'error', text: `нет поля «${k}»` });
  }
  if (!Array.isArray(d.orders) || !d.orders.length) issues.push({ level: 'error', text: 'нет приказов' });
  for (const [i, o] of (d.orders ?? []).entries()) {
    const at = `приказ ${i + 1} (${o?.formation ?? '?'})`;
    if (!o || typeof o !== 'object') { issues.push({ level: 'error', text: `${at}: не объект` }); continue; }
    if (!TASKS.includes(o.task)) issues.push({ level: 'error', text: `${at}: неизвестная задача «${o.task}»` });
    if (!known(o.formation ?? '', ctx.formations)) issues.push({ level: 'error', text: `${at}: формирования нет среди своих сил` });
    if (!known(o.area ?? '', ctx.areas, true)) issues.push({ level: 'warning', text: `${at}: район «${o.area}» не из списка обстановки` });
    if (o.toArea && !known(o.toArea, ctx.areas, true)) issues.push({ level: 'warning', text: `${at}: район «${o.toArea}» не из списка обстановки` });
    if (['withdraw', 'breakout', 'regroup', 'relieve'].includes(o.task) && !o.toArea) issues.push({ level: 'warning', text: `${at}: для задачи «${TASK_RU[o.task]}» не указано, куда` });
  }
  const assessment = (d.assessment ?? '').trim();
  if (assessment && assessment.length < 400) issues.push({ level: 'warning', text: `оценка обстановки короткая (${assessment.length} знаков)` });
  if (!Array.isArray(d.requests)) issues.push({ level: 'error', text: 'нет поля «requests»' });
  if (!Array.isArray(d.risks)) issues.push({ level: 'error', text: 'нет поля «risks»' });
  const ok = !issues.some((x) => x.level === 'error');
  return { decision: ok ? (d as Decision) : null, issues };
}
