/**
 * Контрольные обстановки для проверки модели: ключевые развилки немецкого
 * командования в Берлинской операции. У каждой — что было в истории и
 * признаки ожидаемого решения (автоматические подсказки для экспертов, а не
 * окончательная оценка).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { type Decision, norm } from '../decision';

export interface Expectation {
  id: string;
  text: string;
  /** Хотя бы одно регулярное выражение совпало с текстом решения. */
  any?: string[];
  /** В каждой группе совпало хотя бы одно. */
  all?: string[][];
  /** Есть доклады или просьбы наверх. */
  requests?: boolean;
  /** Есть приказ с такой задачей и районом (для avoid). */
  order?: { task: string[]; area?: string; toArea?: string };
}

export interface Situation {
  id: string;
  title: string;
  draft?: string;
  moment: string;
  role: string;
  higher: string;
  constraints: string[];
  own_forces: { name: string; state: string }[];
  neighbours: string[];
  enemy: string[];
  areas: string[];
  supply: string[];
  question: string;
  expect: Expectation[];
  avoid: Expectation[];
  history: string;
}

export const EVALS_DIR = fileURLToPath(new URL('../../evals', import.meta.url));

export function loadSituations(dir = EVALS_DIR): Situation[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Situation);
}

const list = (a: string[]) => a.map((x) => `- ${x}`).join('\n');

/** Подстановки для german-staff.user.md. */
export function promptVars(s: Situation): Record<string, string> {
  return {
    moment: s.moment,
    role: s.role,
    higher: s.higher,
    constraints: list(s.constraints),
    own_forces: s.own_forces.map((f) => `- ${f.name} — ${f.state}`).join('\n'),
    neighbours: list(s.neighbours),
    enemy: list(s.enemy),
    areas: list(s.areas),
    supply: list(s.supply),
    question: s.question,
  };
}

/** Текст решения для поиска признаков: всё в нижнем регистре, ё → е. */
export function decisionText(d: Decision): string {
  return JSON.stringify(d).toLowerCase().replace(/ё/g, 'е').replace(/\\n/g, ' ');
}

const re = (p: string) => new RegExp(p.toLowerCase().replace(/ё/g, 'е'), 'i');

export function matches(e: Expectation, d: Decision): boolean {
  const t = decisionText(d);
  if (e.requests) return d.requests.some((r) => r.trim().length > 10);
  if (e.order) {
    const o = e.order;
    return d.orders.some((x) => o.task.includes(x.task)
      && (!o.area || re(o.area).test(norm(x.area)) || (!!o.toArea && !!x.toArea && re(o.toArea).test(norm(x.toArea)))));
  }
  if (e.any && !e.any.some((p) => re(p).test(t))) return false;
  if (e.all && !e.all.every((g) => g.some((p) => re(p).test(t)))) return false;
  return true;
}
