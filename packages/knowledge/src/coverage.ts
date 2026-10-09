/**
 * Полнота материалов операции — не мнение модели, а проверка по каркасу: для каждого элемента операции
 * (действующее формирование, ключевой пункт, рубеж, река, сама операция, событие истории, командующий)
 * известно, какие сведения должны быть в базе (ключи фактов категории), и считается, какие есть. Элемент
 * заполнен на долю найденных ключей; группа — в среднем по элементам; операция — взвешенно по группам.
 * Отдельно — качество: доля фактов с источником и с достоверностью A/B.
 */
import { CATEGORIES, type Entry } from './schema';
import { stems } from './search';

export interface CoverageInput {
  operation: { id: string; title: string; start: string; end: string };
  /** Действующие формирования сценария (id — как в синонимах записей базы). */
  formations: { id: string; name: string; side: string; echelon: string }[];
  /** Ключевые пункты: цели приказов, места событий, опорный пункт; names — по-русски и в оригинале. */
  places: { id: string; names: string[]; why: string }[];
  /** Рубежи и укреплённые полосы театра. */
  lines: { id: string; names: string[] }[];
  /** Большие реки в районе действий. */
  rivers: { names: string[] }[];
  /** События истории (с датой). */
  events: { id: string; title: string; date: string; place?: string[] }[];
}

export interface CoverageItem {
  id: string; title: string; note?: string;
  /** Ключи, которые должны быть, и какие найдены. */
  need: string[]; filled: string[];
  /** Записи базы, где найдено. */
  entries: string[];
  score: number;
}
export interface CoverageGroup { id: string; title: string; what: string; weight: number; items: CoverageItem[]; score: number }
export interface Coverage {
  operation: string;
  groups: CoverageGroup[];
  score: number;
  level: 'enough' | 'partial' | 'little';
  quality: { facts: number; sourced: number; reliable: number };
}

export const COVERAGE_LEVEL: Record<Coverage['level'], string> = { enough: 'достаточно для моделирования', partial: 'частично — моделировать можно, но с оговорками', little: 'мало — сначала собрать материалы' };

const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е').replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[«»"“”„'’`()]/g, ' ').replace(/[\s\-–—_]+/g, ' ').trim();
const fieldTitle = (cat: string, key: string) => CATEGORIES.find((c) => c.id === cat)?.fields.find((f) => f.key === key)?.title ?? key;

/** Совпадение названий: точное (с точностью до регистра и написания) или по основам слов. */
function nameMatch(e: Entry, names: string[], loose = false): boolean {
  const own = [e.title, ...(e.aliases ?? [])].map(norm);
  const want = names.map(norm).filter(Boolean);
  if (want.some((w) => own.includes(w))) return true;
  if (!loose) return false;
  const es = new Set(stems(e.title));
  return want.some((w) => {
    const ws = stems(w);
    if (!ws.length) return false;
    const common = ws.filter((x) => es.has(x)).length;
    return common >= Math.min(2, ws.length) && common / Math.max(ws.length, 1) >= 0.6;
  });
}

/** Ключи фактов, найденные в записях. */
const keysOf = (es: Entry[]) => new Set(es.flatMap((e) => (e.facts ?? []).filter((f) => f.value?.trim()).map((f) => f.key)));

function item(id: string, title: string, need: string[], found: Entry[], note?: string): CoverageItem {
  const k = keysOf(found);
  const filled = need.filter((x) => k.has(x));
  return { id, title, note, need, filled, entries: found.map((e) => e.id), score: need.length ? filled.length / need.length : 1 };
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1);

/** Что должно быть о формировании — по ступени. */
export function formationNeeds(echelon: string): string[] {
  if (echelon === 'front' || echelon === 'army') return ['commander', 'composition', 'personnel', 'tanks', 'guns', 'path'];
  if (echelon === 'corps' || echelon === 'division' || echelon === 'brigade') return ['parent', 'commander', 'composition', 'personnel', 'tanks', 'guns', 'path'];
  return ['parent', 'commander', 'personnel', 'path'];
}

export function assessCoverage(input: CoverageInput, entries: Entry[]): Coverage {
  const byCat = (c: string) => entries.filter((e) => e.category === c);
  const formations = byCat('formations'), terrain = byCat('terrain'), ops = byCat('operations'), commanders = byCat('commanders');
  const groups: CoverageGroup[] = [];

  // войска: каждое действующее формирование
  // запись формирования: по id сценария в синонимах (у одноимённых формирований разных операций — свои записи), иначе по названию
  const fEntries = (f: { id: string; name: string }) => { const byId = formations.filter((e) => (e.aliases ?? []).includes(f.id)); return byId.length ? byId : formations.filter((e) => nameMatch(e, [f.name])); };
  const fItems = input.formations.map((f) => {
    const found = fEntries(f);
    return item(f.id, f.name, formationNeeds(f.echelon), found, `${f.side === 'su' ? 'советская' : f.side === 'de' ? 'германская' : f.side} сторона`);
  });
  groups.push({ id: 'formations', title: 'Войска', what: 'по каждому действующему формированию: подчинённость, командир, состав, численность, танки, орудия, боевой путь в операции', weight: 0.3, items: fItems, score: mean(fItems.map((x) => x.score)) });

  // командование: командующие армий и фронтов, названные в записях формирований
  const cItems: CoverageItem[] = [];
  for (const f of input.formations.filter((x) => x.echelon === 'front' || x.echelon === 'army')) {
    const fe = fEntries(f);
    // командующий — по фамилии (в фактах бывает «Маршал Г. К. Жуков», «ген. Т. Буссе (нач. штаба …)»; смена — через «;»)
    const names = new Map<string, string>();
    for (const v of fe.flatMap((e) => (e.facts ?? []).filter((x) => x.key === 'commander').flatMap((x) => x.value.split(';')))) {
      const clean = v.replace(/\(.*?\)/g, '').replace(/^.*?\b(с|до)\s+~?[\d.]+\s*/, '').trim();
      const sur = clean.split(/\s+/).filter((w) => /^[А-ЯЁA-Z][а-яёa-zäöüß-]{2,}$/.test(w)).pop();
      if (sur && !names.has(sur)) names.set(sur, clean.replace(/^(маршал|ген(ерал)?\.?(-\S+)?|полк(овник)?\.?|ген\.-\S+)\s+/i, ''));
    }
    if (!names.size) { cItems.push({ id: `cmd:${f.id}`, title: `Командующий: ${f.name}`, need: ['rank', 'post', 'decisions'], filled: [], entries: [], score: 0, note: 'командующий не указан' }); continue; }
    for (const [sur, n] of [...names].slice(0, 2)) {
      const found = commanders.filter((e) => norm(e.title).split(' ').includes(norm(sur)) || (e.aliases ?? []).some((a) => norm(a).split(' ').includes(norm(sur))));
      cItems.push(item(`cmd:${f.id}:${n}`, `${n} — ${f.name}`, ['rank', 'post', 'decisions'], found));
    }
  }
  groups.push({ id: 'commanders', title: 'Командование', what: 'командующие армий и фронтов: звание, должность в операции, ключевые решения', weight: 0.1, items: cItems, score: mean(cItems.map((x) => x.score)) });

  // ключевые пункты: цели приказов и места событий — что это, где, оборона, значение
  const pItems = input.places.map((p) => item(p.id, p.names[0], ['kind', 'location', 'features', 'defense', 'significance'], terrain.filter((e) => nameMatch(e, p.names, true)), p.why));
  groups.push({ id: 'places', title: 'Пункты и районы', what: 'ключевые населённые пункты и районы (цели, места событий): что это, где, особенности, оборона (гарнизон, укрепления), значение', weight: 0.15, items: pItems, score: mean(pItems.map((x) => x.score)) });

  const lItems = input.lines.map((l) => item(l.id, l.names[0], ['location', 'features', 'defense', 'significance'], terrain.filter((e) => nameMatch(e, l.names, true))));
  groups.push({ id: 'lines', title: 'Рубежи и укрепления', what: 'оборонительные полосы и позиции: где, устройство, кто оборонял, значение', weight: 0.1, items: lItems, score: mean(lItems.map((x) => x.score)) });

  const rItems = input.rivers.map((r) => item(`river:${r.names[0]}`, r.names[0], ['features', 'crossings', 'significance'], terrain.filter((e) => nameMatch(e, r.names, true))));
  groups.push({ id: 'rivers', title: 'Реки и переправы', what: 'большие реки в районе действий: особенности, мосты и переправы, значение', weight: 0.05, items: rItems, score: mean(rItems.map((x) => x.score)) });

  // сама операция
  const o = input.operation;
  const opFound = ops.filter((e) => (e.operations ?? []).includes(o.id) || e.scenario === o.id || nameMatch(e, [o.title.split(/[,:]/)[0]], true));
  const oItems = [item(o.id, o.title, CATEGORIES.find((c) => c.id === 'operations')!.fields.map((f) => f.key), opFound)];
  groups.push({ id: 'operation', title: 'Операция', what: 'даты, театр, стороны, командование, замысел, силы сторон, итог, потери', weight: 0.1, items: oItems, score: oItems[0].score });

  // события истории: есть ли запись хроники или боя на эту дату (±1 сут) о том же
  const dated = entries.filter((e) => (e.category === 'chronology' || e.category === 'battles') && e.period?.from);
  const day = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / 864e5;
  const eItems = input.events.map((ev) => {
    const words = new Set([...stems(ev.title), ...(ev.place ?? []).flatMap((p) => stems(p))]);
    const found = dated.filter((e) => {
      const a = day(e.period!.from!), b = day(e.period!.to ?? e.period!.from!), d = day(ev.date);
      if (d < a - 1 || d > b + 1) return false;
      const es = [...stems(e.title), ...stems(e.summary ?? '')];
      return es.filter((w) => words.has(w)).length >= 2;
    });
    return { id: ev.id, title: `${ev.date.slice(8, 10)}.${ev.date.slice(5, 7)} ${ev.title}`, need: ['event'], filled: found.length ? ['event'] : [], entries: found.map((e) => e.id), score: found.length ? 1 : 0 };
  });
  groups.push({ id: 'events', title: 'Ход событий', what: 'ключевые события истории операции: есть ли о них запись хроники или боя на ту же дату', weight: 0.2, items: eItems, score: mean(eItems.map((x) => x.score)) });

  const used = groups.filter((g) => g.items.length);
  const wsum = used.reduce((a, g) => a + g.weight, 0) || 1;
  const score = used.reduce((a, g) => a + g.weight * g.score, 0) / wsum;
  // качество: факты найденных записей — с источником, с достоверностью A/B
  const ids = new Set(groups.flatMap((g) => g.items.flatMap((i) => i.entries)));
  const facts = entries.filter((e) => ids.has(e.id)).flatMap((e) => e.facts ?? []);
  return {
    operation: o.id, groups, score,
    level: score >= 0.75 ? 'enough' : score >= 0.45 ? 'partial' : 'little',
    quality: { facts: facts.length, sourced: facts.filter((f) => f.source || f.quote).length, reliable: facts.filter((f) => f.reliability === 'A' || f.reliability === 'B').length },
  };
}

/** Что собрать: недостающие сведения списком (markdown) — задание на поиск материалов. */
export function coverageTodo(c: Coverage, title: string): string {
  const cat: Record<string, string> = { formations: 'formations', commanders: 'commanders', places: 'terrain', lines: 'terrain', rivers: 'terrain', operation: 'operations', events: 'chronology' };
  const out = [`# Что собрать по операции «${title}»`, '', `Полнота: ${Math.round(c.score * 100)} % — ${COVERAGE_LEVEL[c.level]}.`, ''];
  for (const g of c.groups) {
    const miss = g.items.filter((i) => i.score < 1);
    if (!miss.length) continue;
    out.push(`## ${g.title} — ${Math.round(g.score * 100)} %`, '', `_${g.what}_`, '');
    for (const i of miss.sort((a, b) => a.score - b.score)) {
      const need = i.need.filter((k) => !i.filled.includes(k)).map((k) => (k === 'event' ? 'запись о событии' : fieldTitle(cat[g.id], k)));
      out.push(`- **${i.title}**${i.note ? ` (${i.note})` : ''}: ${need.join(', ')}${i.entries.length ? '' : ' — записи в базе нет'}`);
    }
    out.push('');
  }
  return out.join('\n');
}
export { fieldTitle as coverageFieldTitle };
