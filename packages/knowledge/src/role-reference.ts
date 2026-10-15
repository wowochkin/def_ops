/**
 * Справка из базы по роли: советник, посредник, штаб противника, Ставка, разбор после игры видят разное.
 * Общее для всех — без записей модели, без списка источников и без материалов разбора других операций.
 * Штабу, Ставке и посреднику — только организация и доктрина, техника, местность: без хода операции и без будущего
 * (запись с началом позже момента хода, запись документа с положениями, потерями, событиями).
 */
import { category, type Entry } from './schema';
import { gather } from './qa';
import type { Hit, Index } from './search';
import { foreignTo } from './operations';

export type Role = 'advisor' | 'umpire' | 'staff' | 'stavka' | 'review';
export interface RoleScope { role: Role; side?: 'su' | 'de'; operation?: string; moment?: string; history?: boolean }
/** Справка: id записи, заголовок, текст. Номер справки [R n] — по порядку в списке. */
export interface RoleRef { id: string; title: string; text: string }

/** Категории, видимые штабу, Ставке и посреднику. */
const COMMAND_CATEGORIES = new Set(['organization', 'equipment', 'terrain']);
/** Виды фактов, допустимые в записи документа для штаба: значения правил и доктрина (не обстановка). */
const TIMELESS = new Set(['param', 'doctrine']);

/** Фильтр записей для роли. */
export function roleFilter(scope: RoleScope): (e: Entry) => boolean {
  return (e) => {
    if (e.group === 'model' || e.category === 'sources' || foreignTo(e, scope.operation)) return false;
    switch (scope.role) {
      case 'review': return true;
      case 'advisor': return !!scope.history || !!category(e.category)?.gameSafe;
      default:
        if (!COMMAND_CATEGORIES.has(e.category)) return false;
        if (e.origin === 'document' && (e.facts ?? []).some((f) => f.claim && !TIMELESS.has(f.claim.kind))) return false;
        // даты ISO сравниваются строкой: '1945-04-25' > '1945-04-19T05:00', а день хода без часа ('1945-04-19') — не позже
        if (scope.moment && e.period?.from && e.period.from > scope.moment) return false;
        return true;
    }
  };
}

/**
 * Справка по запросам: по каждому запросу — поиск (пул 400; hits[i] — готовая выдача гибридного поиска), записи
 * берутся поочерёдно из выдач запросов (первая каждого, вторая каждого…), без повторов, всего не больше limit;
 * текст записи — до chars знаков. При стороне у записи организации своей/чужой стороны — пометка в заголовке.
 */
export function roleReference(index: Index, byId: Map<string, Entry>, queries: string[], scope: RoleScope,
  o: { limit: number; chars: number; hits?: (Hit[] | undefined)[] }): { refs: RoleRef[]; text: string } {
  const ok = roleFilter(scope);
  const lists = queries.map((q, i) => gather(index, byId, q, { limit: o.limit, pool: 400, hits: o.hits?.[i], filter: (e) => !!e && ok(e) }));
  const refs: RoleRef[] = [];
  const seen = new Set<string>();
  for (let rank = 0; refs.length < o.limit && lists.some((l) => l.length > rank); rank++) {
    for (const l of lists) {
      const s = l[rank];
      if (!s || seen.has(s.ref)) continue;
      seen.add(s.ref);
      const e = byId.get(s.ref)!;
      const mark = scope.side && e.category === 'organization' && (e.group === 'su' || e.group === 'de')
        ? (e.group === scope.side ? ' — своя сторона' : ' — противник') : '';
      refs.push({ id: s.ref, title: `${s.title}${mark}`, text: s.text.slice(0, o.chars) });
      if (refs.length >= o.limit) break;
    }
  }
  return { refs, text: refs.map((r, i) => `[R${i + 1}] ${r.title}\n${r.text}`).join('\n\n') };
}
