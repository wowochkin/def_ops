/**
 * Справка из базы по роли: советник, посредник, штаб противника, Ставка, разбор после игры видят разное.
 * Общее для всех — без записей модели, без списка источников и без материалов разбора других операций.
 * Штабу, Ставке и посреднику — только организация и доктрина, техника; местность — только из значений правил и
 * доктрины: без хода операции и без будущего (запись с началом или датой факта позже момента хода, запись документа с
 * положениями, потерями, событиями; факты доктрины с датой позже хода из текста справки убираются).
 */
import { category, type Entry, type Fact } from './schema';
import { gather } from './qa';
import type { Hit, Index } from './search';
import { foreignTo } from './operations';
import { doctrineAfter } from './doctrine';

export type Role = 'advisor' | 'umpire' | 'staff' | 'stavka' | 'review';
/** doctrine — доктрина дана роли отдельным блоком (штабу и Ставке записи доктрины в справке не нужны). */
export interface RoleScope { role: Role; side?: 'su' | 'de'; operation?: string; moment?: string; history?: boolean; doctrine?: boolean }
/** Справка: id записи, заголовок, текст. Номер справки [R n] — по порядку в списке. */
export interface RoleRef { id: string; title: string; text: string }

/** Категории, видимые штабу, Ставке и посреднику (безопасные для игры); местность — только из значений правил и доктрины. */
const COMMAND_CATEGORIES = new Set(['organization', 'equipment']);
/** Виды фактов, допустимые в записи документа для штаба: значения правил и доктрина (не обстановка). */
const TIMELESS = new Set(['param', 'doctrine']);
const timeless = (f: Fact) => !!f.claim && TIMELESS.has(f.claim.kind);
const command = (r: Role) => r === 'staff' || r === 'stavka' || r === 'umpire';

/** Дата позже момента: момент с часом — сравнение строкой целиком; дата без часа — по дню (день хода — не позже). */
const later = (d: string, moment: string) => d.length > 10 ? d > moment : d > moment.slice(0, 10);
/** Даты формальной части факта: at, from, to (событие, положение, переправа, потери…). */
const claimDates = (f: Fact): string[] => {
  const c = f.claim as { at?: unknown; from?: unknown; to?: unknown } | undefined;
  return c ? [c.at, c.from, c.to].filter((d): d is string => typeof d === 'string' && d.length >= 10) : [];
};
/** Запись доктрины: есть факты доктрины, и все формальные факты — доктрина (прочие — пояснения: сторона, тема). */
const doctrineRecord = (e: Entry) => {
  const claimed = (e.facts ?? []).filter((f) => f.claim);
  return claimed.length > 0 && claimed.every((f) => f.claim!.kind === 'doctrine');
};

/** Факт из документа: запись из документа, источник doc:… или подтверждение по документу. */
const fromDocument = (e: Entry, f: Fact): boolean =>
  e.origin === 'document' || !!f.source?.startsWith('doc:') || !!(f.evidence && 'doc' in f.evidence);

/**
 * Фильтр записей для роли. Штабу, Ставке и посреднику (туман войны) не проходит запись, в которой хоть один факт из
 * документа — не значение правила и не доктрина: текстовые факты документа операции (положения, состояние мостов,
 * гарнизоны) — обстановка, которую сторона знать не должна, в какой бы записи они ни лежали.
 */
export function roleFilter(scope: RoleScope): (e: Entry) => boolean {
  return (e) => {
    if (e.group === 'model' || e.category === 'sources' || foreignTo(e, scope.operation)) return false;
    switch (scope.role) {
      case 'review': return true;
      case 'advisor': return !!scope.history || !!category(e.category)?.gameSafe;
      default: {
        const facts = e.facts ?? [];
        // местность — история операции (мосты, прорывы позиций), если в ней есть хоть что-то, кроме значений правил
        if (e.category === 'terrain') { if (!facts.length || !facts.every(timeless)) return false; }
        else if (!COMMAND_CATEGORIES.has(e.category)) return false;
        if (facts.some((f) => fromDocument(e, f) && !timeless(f))) return false;
        // даты ISO сравниваются строкой: '1945-04-25' > '1945-04-19T05:00', а день хода без часа ('1945-04-19') — не позже
        if (scope.moment && e.period?.from && e.period.from > scope.moment) return false;
        if (scope.moment && facts.some((f) => claimDates(f).some((d) => later(d, scope.moment!)))) return false;
        // правила доктрины уже в блоке доктрины — запись доктрины в справке штаба и Ставки повторила бы их
        if (scope.doctrine && (scope.role === 'staff' || scope.role === 'stavka') && doctrineRecord(e)) return false;
        return true;
      }
    }
  };
}

const views = new WeakMap<Map<string, Entry>, Map<string, Map<string, Entry>>>();
/** Записи без фактов доктрины, написанных позже момента (doctrineAfter); прочие записи — те же объекты. */
function withoutLater(byId: Map<string, Entry>, moment: string): Map<string, Entry> {
  let cache = views.get(byId);
  if (!cache) views.set(byId, cache = new Map());
  let v = cache.get(moment);
  if (v) return v;
  v = new Map(byId);
  for (const [id, e] of byId) if (e.facts?.some((f) => doctrineAfter(f, moment))) v.set(id, { ...e, facts: (e.facts ?? []).filter((f) => !doctrineAfter(f, moment)) });
  if (cache.size > 64) cache.clear();
  cache.set(moment, v);
  return v;
}

/**
 * Справка по запросам: по каждому запросу — поиск (пул 400; hits[i] — готовая выдача гибридного поиска), записи
 * берутся поочерёдно из выдач запросов (первая каждого, вторая каждого…), без повторов, всего не больше limit;
 * текст записи — до chars знаков. Советнику с историей у записей истории — «, история». При стороне у записи организации своей/чужой стороны — пометка в заголовке.
 */
export function roleReference(index: Index, byId: Map<string, Entry>, queries: string[], scope: RoleScope,
  o: { limit: number; chars: number; hits?: (Hit[] | undefined)[] }): { refs: RoleRef[]; text: string } {
  const ok = roleFilter(scope);
  // штабу, Ставке, посреднику — без фактов доктрины с датой позже хода (приказы и опыт после момента)
  const view = command(scope.role) && scope.moment ? withoutLater(byId, scope.moment) : byId;
  const lists = queries.map((q, i) => gather(index, view, q, { limit: o.limit, pool: 400, hits: o.hits?.[i], filter: (e) => !!e && ok(e) }));
  const refs: RoleRef[] = [];
  const seen = new Set<string>();
  for (let rank = 0; refs.length < o.limit && lists.some((l) => l.length > rank); rank++) {
    for (const l of lists) {
      const s = l[rank];
      if (!s || seen.has(s.ref)) continue;
      seen.add(s.ref);
      const e = view.get(s.ref)!;
      const mark = scope.side && e.category === 'organization' && (e.group === 'su' || e.group === 'de')
        ? (e.group === scope.side ? ' — своя сторона' : ' — противник') : '';
      // советнику с историей — пометка у записей истории (как в gameReference)
      const hist = scope.role === 'advisor' && scope.history && !category(e.category)?.gameSafe ? ', история' : '';
      refs.push({ id: s.ref, title: `${s.title}${mark}${hist}`, text: s.text.slice(0, o.chars) });
      if (refs.length >= o.limit) break;
    }
  }
  return { refs, text: refs.map((r, i) => `[R${i + 1}] ${r.title}\n${r.text}`).join('\n\n') };
}
