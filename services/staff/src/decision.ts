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

function known(name: string, list: string[]): boolean {
  const n = norm(name);
  if (!n) return false;
  return list.some((x) => { const k = norm(x); return k === n || n.includes(k) || k.includes(n); });
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
    if (!known(o.area ?? '', ctx.areas)) issues.push({ level: 'warning', text: `${at}: район «${o.area}» не из списка обстановки` });
    if (o.toArea && !known(o.toArea, ctx.areas)) issues.push({ level: 'warning', text: `${at}: район «${o.toArea}» не из списка обстановки` });
    if (['withdraw', 'breakout', 'regroup', 'relieve'].includes(o.task) && !o.toArea) issues.push({ level: 'warning', text: `${at}: для задачи «${TASK_RU[o.task]}» не указано, куда` });
  }
  const assessment = (d.assessment ?? '').trim();
  if (assessment && assessment.length < 400) issues.push({ level: 'warning', text: `оценка обстановки короткая (${assessment.length} знаков)` });
  if (!Array.isArray(d.requests)) issues.push({ level: 'error', text: 'нет поля «requests»' });
  if (!Array.isArray(d.risks)) issues.push({ level: 'error', text: 'нет поля «risks»' });
  const ok = !issues.some((x) => x.level === 'error');
  return { decision: ok ? (d as Decision) : null, issues };
}
