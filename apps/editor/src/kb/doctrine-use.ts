/**
 * «Кто использует» правила доктрины записи: штаб противника и посредник берут правила в промпт, штабы агентной
 * модели — в текст доктрины; Ставка — правила советской стороны уровня фронта и армии, ОКХ — германские армейские.
 */
import type { Entry } from '@def-ops/knowledge';

export function doctrineUsers(e: Entry): string[] {
  const rules = (e.facts ?? []).flatMap((f) => (f.claim?.kind === 'doctrine' ? [f.claim] : []));
  if (!rules.length) return [];
  const stavka = rules.some((c) => c.side === 'su' && (c.level === 'front' || c.level === 'army'));
  const okh = rules.some((c) => c.side === 'de' && c.level === 'army');
  return ['штаб противника', ...(stavka ? ['Ставка'] : []), ...(okh ? ['ОКХ'] : []), 'посредник', 'штабы агентной модели'];
}
