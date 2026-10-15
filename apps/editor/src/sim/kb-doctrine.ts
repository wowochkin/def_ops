/**
 * Доктрина из базы знаний для штабов агентной модели на языковой модели: окно отбирает правила своей стороны
 * (сид, слой пользователя, закрепления) и передаёт текст ядру (run_scenario, game_turn — doctrineText); ядро
 * подставляет его в промпт штаба вместо зашитого предложения. Числа доктрины ядра не меняются.
 */
import { doctrineFor, type DoctrineTrigger, type Entry, type Pins } from '@def-ops/knowledge';

/** Обстановка штабов агентной модели: немецкие — оборона (вклинение, давление, окружение), советские — наступление. */
export const AGENT_TRIGGERS: Record<'su' | 'de', DoctrineTrigger[]> = { de: ['penetration', 'pressure', 'encircled'], su: ['attack'] };

/** Текст доктрины по сторонам (≤ 8 правил, ≤ 4000 знаков); у стороны без правил ключа нет. */
export function agentDoctrine(entries: Entry[], pins: Pins): { su?: string; de?: string } {
  const out: { su?: string; de?: string } = {};
  for (const side of ['su', 'de'] as const) {
    const { text } = doctrineFor(entries, pins, side, AGENT_TRIGGERS[side], '', { levels: side === 'su' ? ['army', 'corps'] : ['army', 'corps', 'division'] });
    if (text) out[side] = text;
  }
  return out;
}

/** Доктрина по базе окна; база недоступна — undefined (ядро берёт зашитый текст). */
export async function agentDoctrineText(): Promise<{ su?: string; de?: string } | undefined> {
  try {
    const kb = await import('../kb/kb');
    await kb.load();
    return agentDoctrine(kb.current().entries, await kb.getPins());
  } catch { return undefined; }
}
