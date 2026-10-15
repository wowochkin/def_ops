/**
 * «Кто использует» правила доктрины записи — как их отбирают в игре и в расчёте:
 * - штаб противника — правила своей стороны (той, за которую играет), всех уровней;
 * - Ставка — советские правила уровня фронта и армии, ОКХ — германские фронта (группы армий) и армии;
 * - посредник — в справке (запись доктрины по поиску);
 * - штабы агентной модели — советские армии и корпуса, германские армии, корпуса и дивизии (без фронта).
 */
import type { Entry } from '@def-ops/knowledge';

/** Уровни правил, которые берут штабы агентной модели (как в sim/kb-doctrine.ts). */
const AGENT_LEVELS = { su: ['army', 'corps'], de: ['army', 'corps', 'division'] } as const;

export function doctrineUsers(e: Entry): string[] {
  const rules = (e.facts ?? []).flatMap((f) => (f.claim?.kind === 'doctrine' ? [f.claim] : []));
  if (!rules.length) return [];
  const has = (side: 'su' | 'de', levels?: readonly string[]) => rules.some((c) => c.side === side && (!levels || levels.includes(c.level)));
  const top = ['front', 'army'];
  return [
    ...(has('su') ? ['штаб противника (советской стороны)'] : []),
    ...(has('de') ? ['штаб противника (немецкой стороны)'] : []),
    ...(has('su', top) ? ['Ставка'] : []),
    ...(has('de', top) ? ['ОКХ'] : []),
    'посредник',
    ...(has('su', AGENT_LEVELS.su) || has('de', AGENT_LEVELS.de) ? ['штабы агентной модели'] : []),
  ];
}
