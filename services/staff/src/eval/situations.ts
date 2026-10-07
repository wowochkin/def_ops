/**
 * Контрольные обстановки для проверки модели. Обстановки сгруппированы в
 * сценарии (evals/<сценарий>/scenario.json + обстановки): сторона, которую
 * ведёт модель, и профиль стороны и эпохи (profiles/<id>.md). Движок и промпты
 * от сценария не зависят. У каждой обстановки — что было в истории и признаки
 * ожидаемого решения (подсказки для экспертов, а не окончательная оценка).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
  /** Есть приказ с такой задачей и районом (и, если задано, формированием и направлением). */
  order?: { task: string[]; area?: string; toArea?: string; formation?: string };
  /** Достаточно выполнения любого из вариантов. */
  oneOf?: Omit<Expectation, 'id' | 'text'>[];
}

export interface Scenario {
  id: string;
  name: string;
  /** Для промпта: «переигровка … (даты)». */
  description: string;
  /** Сторона, которую ведёт модель. */
  side: string;
  /** Профиль стороны и эпохи — файл profiles/<profile>.md. */
  profile: string;
  /** Критерий для оценки экспертом: «соответствие доктрине и обстановке …». */
  grading: string;
}

export interface Situation {
  id: string;
  /** Сценарий, к которому относится обстановка (заполняется при загрузке). */
  scenario: Scenario;
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
export const PROFILES_DIR = fileURLToPath(new URL('../../profiles', import.meta.url));

export function loadScenarios(dir = EVALS_DIR): Scenario[] {
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'scenario.json')))
    .map((d) => JSON.parse(readFileSync(join(dir, d.name, 'scenario.json'), 'utf8')) as Scenario);
}

/** Обстановки всех сценариев (или одного). */
export function loadSituations(dir = EVALS_DIR, scenarioId?: string): Situation[] {
  return loadScenarios(dir).filter((sc) => !scenarioId || sc.id === scenarioId).flatMap((sc) =>
    readdirSync(join(dir, sc.id)).filter((f) => f.endsWith('.json') && f !== 'scenario.json').sort()
      .map((f) => ({ ...(JSON.parse(readFileSync(join(dir, sc.id, f), 'utf8')) as Omit<Situation, 'scenario'>), scenario: sc })));
}

export function profileText(id: string, dir = PROFILES_DIR): string {
  return readFileSync(join(dir, `${id}.md`), 'utf8').trim();
}

/** Подстановки для staff.system.md. */
export function systemVars(s: Situation): Record<string, string> {
  return { side: s.scenario.side, scenario: s.scenario.description, profile: profileText(s.scenario.profile) };
}

const list = (a: string[]) => a.map((x) => `- ${x}`).join('\n');

/** Подстановки для staff.user.md. */
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

export function matches(e: Omit<Expectation, 'id' | 'text'>, d: Decision): boolean {
  if (e.oneOf) return e.oneOf.some((x) => matches(x, d));
  const t = decisionText(d);
  if (e.requests) return d.requests.some((r) => r.trim().length > 10);
  if (e.order) {
    const o = e.order;
    return d.orders.some((x) => o.task.includes(x.task)
      && (!o.formation || re(o.formation).test(norm(x.formation)))
      && (!o.area || re(o.area).test(norm(x.area)))
      && (!o.toArea || (!!x.toArea && re(o.toArea).test(norm(x.toArea)))));
  }
  if (e.any && !e.any.some((p) => re(p).test(t))) return false;
  if (e.all && !e.all.every((g) => g.some((p) => re(p).test(t)))) return false;
  return true;
}
