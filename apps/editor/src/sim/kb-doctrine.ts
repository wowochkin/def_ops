/**
 * Доктрина из базы знаний для штабов агентной модели на языковой модели: окно отбирает правила своей стороны
 * (сид, слой пользователя, закрепления) и передаёт текст ядру (run_scenario, game_turn — doctrineText); ядро
 * подставляет его в промпт штаба вместо зашитого предложения. Числа доктрины ядра не меняются.
 */
import { doctrineFor, type DoctrineRule, type DoctrineTrigger, type Entry, type Pins } from '@def-ops/knowledge';

/**
 * Обстановка штабов агентной модели: немецкие — оборона (вклинение, давление, окружение), советские — наступление и
 * узлы обороны на пути (обход).
 */
export const AGENT_TRIGGERS: Record<'su' | 'de', DoctrineTrigger[]> = { de: ['penetration', 'pressure', 'encircled'], su: ['attack', 'encircled'] };

const run = (entries: Entry[], pins: Pins, side: 'su' | 'de', moment?: string) =>
  doctrineFor(entries, pins, side, AGENT_TRIGGERS[side], '', { levels: side === 'su' ? ['army', 'corps'] : ['army', 'corps', 'division'], spread: true, ...(moment ? { moment } : {}) });

/**
 * Правила доктрины по сторонам (≤ 8, ≤ 4000 знаков): группы триггеров по кругу — по правилу каждой группы, потом по
 * второму…, чтобы в текст попали и отход, и окружение, и обход, а не одни контратаки; moment — правила с датой позже не
 * берутся.
 */
export function agentRules(entries: Entry[], pins: Pins, moment?: string): Record<'su' | 'de', DoctrineRule[]> {
  return { su: run(entries, pins, 'su', moment).rules, de: run(entries, pins, 'de', moment).rules };
}

/** Текст доктрины по сторонам; у стороны без правил ключа нет. */
export function agentDoctrine(entries: Entry[], pins: Pins, moment?: string): { su?: string; de?: string } {
  const out: { su?: string; de?: string } = {};
  for (const side of ['su', 'de'] as const) {
    const { text } = run(entries, pins, side, moment);
    if (text) out[side] = text;
  }
  return out;
}

/**
 * Доктрина по базе окна на момент (начало сценария или время игры); база недоступна — undefined (ядро берёт зашитый
 * текст).
 */
export async function agentDoctrineText(moment?: string): Promise<{ su?: string; de?: string } | undefined> {
  try {
    const kb = await import('../kb/kb');
    await kb.load();
    return agentDoctrine(kb.current().entries, await kb.getPins(), moment);
  } catch { return undefined; }
}
