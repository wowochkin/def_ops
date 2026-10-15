/**
 * Чтение параметров агентной модели (data/rules/agents-v0.json) по пути через точку: у параметра {value} — само
 * значение, у ступенчатой таблицы ([нижняя граница соотношения сил, значение]) — значение при 3:1. Общее для перечня
 * входов правил (rule-inputs) и отчёта нормативов (norms: путь норматива с приставкой «agents.»).
 */

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Пройти по пути в объекте агентной модели; у параметра {value} — само значение. */
export function agentValue(agents: unknown, path: string): unknown {
  let cur: unknown = agents;
  for (const k of path.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
  return cur && typeof cur === 'object' && !Array.isArray(cur) && 'value' in cur ? (cur as { value: unknown }).value : cur;
}

/** Ступенчатая таблица агентной модели ([нижняя граница соотношения, значение]) при 3:1. */
export function stepAt3(v: unknown): number | null {
  if (!Array.isArray(v) || !v.length) return null;
  let y: number | null = null;
  for (const row of v as [number, number][]) if (row[0] <= 3) y = row[1];
  return y ?? num((v as [number, number][])[0][1]);
}

/** Число параметра агентной модели: таблица — при 3:1, иначе само значение; нет такого — null. */
export function agentNumber(agents: unknown, path: string, table?: boolean): number | null {
  const v = agentValue(agents, path);
  return (table ?? Array.isArray(v)) ? stepAt3(v) : num(v);
}
