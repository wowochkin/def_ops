/**
 * Полнота материалов операции — не мнение модели, а проверка по каркасу: для каждого элемента операции известно,
 * какие сведения должны быть, и считается, какие есть. Элементы берутся из данных операции (формирования, пункты,
 * рубежи, реки, мосты, участки, события, положения по дням) и из того, что нужно модели о сторонах (организация и
 * тактика, вооружение, нормативы). Элемент заполнен на долю найденного; группа — в среднем; операция — взвешенно.
 *
 * Разделы:
 *  - Войска и командование: формирования, командующие, положения по дням (история для сравнения);
 *  - Местность и инфраструктура: пункты и районы, рубежи, реки, мосты и переправы;
 *  - Ход операции: операция, сражения и бои по участкам, события, погода и грунт;
 *  - Стороны: организация и тактика, вооружение и техника, нормативы опыта войны;
 *  - Источники: документы операции, источник у фактов, достоверность.
 */
import { CATEGORIES, type Entry } from './schema';
import { stems } from './search';
import { rubricsOf, within } from './rubrics';
import { coverageHints, hintsMarkdown } from './hints';

type LL = [number, number];
export interface CoverageInput {
  operation: { id: string; title: string; start: string; end: string };
  sides?: { id: string; name: string }[];
  /** Действующие формирования сценария (id — как в синонимах записей базы); at — положение в начале. */
  formations: { id: string; name: string; side: string; echelon: string; at?: LL }[];
  /** Ключевые пункты: цели приказов, места событий, опорный пункт; names — по-русски и в оригинале. */
  places: { id: string; names: string[]; why: string; at?: LL }[];
  lines: { id: string; names: string[]; line?: LL[] }[];
  rivers: { names: string[]; lines?: LL[][] }[];
  events: { id: string; title: string; date: string; place?: string[]; at?: LL }[];
  /** Участки (сектора фокуса) — сражения и бои операции. */
  sectors?: { id: string; title: string; bbox?: [number, number, number, number] }[];
  /** Мосты на больших реках района: известно ли их состояние (разрушен/наведён — по театру или сведениям). */
  bridges?: { id: string; name: string; river?: string; known: boolean; how?: string; at?: LL }[];
  /** Положения формирований по дням в истории (для сравнения расчёта): дней с положением из дней операции. */
  positions?: { id: string; name: string; side: string; days: number; total: number }[];
  /** Нормативы опыта войны (rules/norms.json) по операции. */
  norms?: { id: string; title: string; kb?: string; source?: string; reliability?: string }[];
  /** Документы, загруженные в операцию. */
  documents?: { id: string; name: string; reliability: string }[];
}

export interface CoverageItem {
  id: string; title: string; note?: string; side?: string;
  /** Название в оригинале (немецкое, английское) — для поисковых запросов. */
  alt?: string;
  /** Значимость элемента (армия важнее батальона) — порядок в подсказках. */
  weight?: number;
  /** Что должно быть (ключи) и что найдено. */
  need: string[]; filled: string[];
  entries: string[];
  score: number;
  at?: LL; line?: LL[]; lines?: LL[][];
}
export interface CoverageGroup {
  id: string; section: string; title: string; what: string; weight: number;
  /** Подписи ключей need (столбцы матрицы). */
  labels: Record<string, string>;
  items: CoverageItem[]; score: number;
  /** Полнота по сторонам (войска, командование, положения). */
  bySide?: Record<string, number>;
}
export interface Coverage {
  operation: string;
  groups: CoverageGroup[];
  sections: { id: string; title: string; score: number }[];
  score: number;
  level: 'enough' | 'partial' | 'little';
  quality: { facts: number; sourced: number; reliable: number };
  sides: { id: string; name: string }[];
}

export const COVERAGE_LEVEL: Record<Coverage['level'], string> = { enough: 'достаточно для моделирования', partial: 'частично — моделировать можно, но с оговорками', little: 'мало — сначала собрать материалы' };
export const levelOf = (x: number): Coverage['level'] => (x >= 0.75 ? 'enough' : x >= 0.45 ? 'partial' : 'little');
export const COVERAGE_SECTIONS: { id: string; title: string }[] = [
  { id: 'forces', title: 'Войска и командование' }, { id: 'ground', title: 'Местность и инфраструктура' }, { id: 'course', title: 'Ход операции' },
  { id: 'sides', title: 'Стороны: организация, вооружение, нормативы' }, { id: 'sources', title: 'Источники' },
];

const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е').replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[«»"“”„'’`()]/g, ' ').replace(/[\s\-–—_.]+/g, ' ').trim();
const fieldTitle = (cat: string, key: string) => CATEGORIES.find((c) => c.id === cat)?.fields.find((f) => f.key === key)?.title ?? key;
const labelsOf = (cat: string, keys: string[]) => Object.fromEntries(keys.map((k) => [k, fieldTitle(cat, k)]));

/** Совпадение названий: точное (с точностью до регистра и написания) или по основам слов. */
function nameMatch(e: Entry, names: string[], loose = false): boolean {
  const own = [e.title, ...(e.aliases ?? [])].map(norm);
  const want = names.map(norm).filter(Boolean);
  if (want.some((w) => own.includes(w))) return true;
  if (!loose) return false;
  const es = new Set([e.title, ...(e.aliases ?? [])].flatMap((x) => stems(x)));
  return want.some((w) => {
    const ws = stems(w);
    if (!ws.length) return false;
    const common = ws.filter((x) => es.has(x)).length;
    return common >= Math.min(2, ws.length) && common / Math.max(ws.length, 1) >= 0.6;
  });
}
const keysOf = (es: Entry[]) => new Set(es.flatMap((e) => (e.facts ?? []).filter((f) => f.value?.trim()).map((f) => f.key)));
function item(id: string, title: string, need: string[], found: Entry[], extra: Partial<CoverageItem> = {}): CoverageItem {
  const k = keysOf(found);
  const filled = need.filter((x) => k.has(x));
  return { id, title, need, filled, entries: found.map((e) => e.id), score: need.length ? filled.length / need.length : 1, ...extra };
}
const flag = (id: string, title: string, key: string, ok: boolean, extra: Partial<CoverageItem> = {}): CoverageItem => ({ id, title, need: [key], filled: ok ? [key] : [], entries: [], score: ok ? 1 : 0, ...extra });
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1);
const day = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / 864e5;
const overlaps = (e: Entry, a: string, b: string) => !!e.period?.from && day(e.period.from) <= day(b) && day(e.period.to ?? e.period.from) >= day(a);

const ECH_W: Record<string, number> = { front: 5, army: 4, corps: 3, division: 2, brigade: 1.5 };

/** Записи базы о формировании сценария: по id в синонимах, иначе по названию. */
export function formationEntries(entries: Entry[], f: { id: string; name: string }): Entry[] {
  const fs = entries.filter((e) => e.category === 'formations');
  const byId = fs.filter((e) => (e.aliases ?? []).includes(f.id));
  return byId.length ? byId : fs.filter((e) => nameMatch(e, [f.name]));
}

/** Что должно быть о формировании — по ступени. */
export function formationNeeds(echelon: string): string[] {
  if (echelon === 'front' || echelon === 'army') return ['commander', 'composition', 'personnel', 'tanks', 'guns', 'path'];
  if (echelon === 'corps' || echelon === 'division' || echelon === 'brigade') return ['parent', 'commander', 'composition', 'personnel', 'tanks', 'guns', 'path'];
  return ['parent', 'commander', 'personnel', 'path'];
}

/** Темы организации и тактики, которые нужны модели о каждой стороне: рубрики и слова в названии. */
const DOCTRINE: { id: string; title: string; rub: string[]; words: RegExp }[] = [
  { id: 'org', title: 'Организация соединений (штаты, состав)', rub: ['2.1', '2.2'], words: /штат|организац|состав (дивиз|корпус)/i },
  { id: 'attack', title: 'Наступление, прорыв обороны', rub: ['3.2.1', '3.1.1', '3.1.3'], words: /наступ|прорыв/i },
  { id: 'defense', title: 'Оборона', rub: ['3.2.2', '3.1.4'], words: /оборон/i },
  { id: 'city', title: 'Бой в городе', rub: ['3.2.3'], words: /город|штурм/i },
  { id: 'crossing', title: 'Форсирование рек', rub: ['3.2.4'], words: /форсир|переправ/i },
  { id: 'arms', title: 'Рода войск: артиллерия, танки, авиация, инженерные', rub: ['3.3'], words: /артилл|танков|авиац|инженер/i },
  { id: 'supply', title: 'Тыл и снабжение', rub: ['5.1', '5.4'], words: /снабж|тыл|подвоз/i },
  { id: 'general', title: 'Общие черты армии (состояние, выучка)', rub: ['3.4.5'], words: /общие черты/i },
];

/** Основное вооружение сторон весной 1945 г. — каркас для раздела «Вооружение и техника». */
const EQUIPMENT: Record<string, { names: string[]; kind: 'armor' | 'gun' | 'small' }[]> = {
  su: [
    { names: ['Т-34-85', 'T-34-85'], kind: 'armor' }, { names: ['ИС-2', 'IS-2'], kind: 'armor' }, { names: ['ИСУ-152', 'ISU-152'], kind: 'armor' }, { names: ['СУ-76', 'SU-76'], kind: 'armor' },
    { names: ['БМ-13 «Катюша»', 'Катюша', 'BM-13'], kind: 'gun' }, { names: ['122-мм гаубица М-30', 'М-30'], kind: 'gun' }, { names: ['76-мм пушка ЗИС-3', 'ЗИС-3'], kind: 'gun' }, { names: ['ППШ-41', 'PPSh-41'], kind: 'small' },
  ],
  de: [
    { names: ['Pz.Kpfw. IV', 'Panzer IV', 'Т-IV'], kind: 'armor' }, { names: ['Pz.Kpfw. V «Пантера»', 'Panther', 'Пантера'], kind: 'armor' }, { names: ['Pz.Kpfw. VI Ausf. B «Тигр II»', 'Tiger II', 'Королевский тигр'], kind: 'armor' },
    { names: ['StuG III', 'Sturmgeschütz III'], kind: 'armor' }, { names: ['Jagdpanzer 38(t) «Хетцер»', 'Hetzer', 'Хетцер'], kind: 'armor' },
    { names: ['8,8-см FlaK', '88-мм зенитная пушка', 'Flak 88'], kind: 'gun' }, { names: ['Фаустпатрон (Panzerfaust)', 'Panzerfaust', 'Фаустпатрон'], kind: 'small' }, { names: ['MG 42', 'МГ-42'], kind: 'small' },
  ],
};
const EQ_NEED: Record<string, string[]> = { armor: ['armament', 'armor', 'weight', 'speed', 'crew'], gun: ['type', 'armament', 'range', 'crew'], small: ['type', 'armament', 'range'] };

export function assessCoverage(input: CoverageInput, entries: Entry[]): Coverage {
  const byCat = (c: string) => entries.filter((e) => e.category === c);
  const formations = byCat('formations'), terrain = byCat('terrain'), ops = byCat('operations'), commanders = byCat('commanders');
  const o = input.operation;
  const sides = input.sides ?? [...new Set(input.formations.map((f) => f.side))].map((id) => ({ id, name: id === 'su' ? 'СССР' : id === 'de' ? 'Германия' : id }));
  const groups: CoverageGroup[] = [];
  const add = (g: Omit<CoverageGroup, 'score' | 'bySide'>, withSides = false) => {
    const bySide = withSides ? Object.fromEntries(sides.map((s) => [s.id, mean(g.items.filter((i) => i.side === s.id).map((i) => i.score))]).filter(([id]) => g.items.some((i) => i.side === id))) : undefined;
    groups.push({ ...g, score: mean(g.items.map((i) => i.score)), ...(bySide ? { bySide } : {}) });
  };

  /* ── войска и командование ── */
  const fEntries = (f: { id: string; name: string }) => formationEntries(formations, f);
  const fKeys = ['parent', 'commander', 'composition', 'personnel', 'tanks', 'guns', 'path'];
  add({ id: 'formations', section: 'forces', title: 'Формирования', what: 'по каждому действующему формированию: подчинённость, командир, состав, численность, танки, орудия, боевой путь в операции', weight: 0.2, labels: labelsOf('formations', fKeys),
    items: input.formations.map((f) => {
      const found = fEntries(f);
      const alt = found.flatMap((e) => e.aliases ?? []).find((a) => /[A-Za-z]/.test(a) && !/_/.test(a) && !/^[a-z]/.test(a));
      return item(f.id, f.name, formationNeeds(f.echelon), found, { side: f.side, at: f.at, alt, weight: ECH_W[f.echelon] ?? 1 });
    }) }, true);

  const cItems: CoverageItem[] = [];
  for (const f of input.formations.filter((x) => x.echelon === 'front' || x.echelon === 'army')) {
    const names = new Map<string, string>();
    for (const v of fEntries(f).flatMap((e) => (e.facts ?? []).filter((x) => x.key === 'commander').flatMap((x) => x.value.split(';')))) {
      const clean = v.replace(/\(.*?\)/g, '').replace(/^.*?\b(с|до)\s+~?[\d.]+\s*/, '').trim();
      const sur = clean.split(/\s+/).filter((w) => /^[А-ЯЁA-Z][а-яёa-zäöüß-]{2,}$/.test(w)).pop();
      if (sur && !names.has(sur)) names.set(sur, clean.replace(/^(маршал|ген(ерал)?\.?(-\S+)?|полк(овник)?\.?|ген\.-\S+)\s+/i, ''));
    }
    if (!names.size) { cItems.push({ id: `cmd:${f.id}`, title: `Командующий: ${f.name}`, side: f.side, need: ['rank', 'post', 'decisions'], filled: [], entries: [], score: 0, note: 'командующий не указан' }); continue; }
    for (const [sur, n] of [...names].slice(0, 2)) {
      const found = commanders.filter((e) => [e.title, ...(e.aliases ?? [])].some((a) => norm(a).split(' ').includes(norm(sur))));
      cItems.push(item(`cmd:${f.id}:${sur}`, `${n} — ${f.name}`, ['rank', 'post', 'decisions'], found, { side: f.side }));
    }
  }
  add({ id: 'commanders', section: 'forces', title: 'Командование', what: 'командующие армий и фронтов: звание, должность в операции, ключевые решения', weight: 0.06, labels: labelsOf('commanders', ['rank', 'post', 'decisions']), items: cItems }, true);

  if (input.positions?.length) add({ id: 'positions', section: 'forces', title: 'Положения по дням', what: 'история для сравнения расчёта: в какие дни операции известно положение формирования (по источникам)', weight: 0.1, labels: { days: 'дни с положением' },
    items: input.positions.map((p) => ({ id: `pos:${p.id}`, title: p.name, side: p.side, alt: formations.filter((e) => (e.aliases ?? []).includes(p.id)).flatMap((e) => e.aliases ?? []).find((a) => /[A-Za-z]/.test(a) && !/_/.test(a) && !/^[a-z]/.test(a)), need: ['days'], filled: p.days >= p.total * 0.5 ? ['days'] : [], entries: [], score: Math.min(1, p.days / Math.max(1, p.total)), note: `${p.days} из ${p.total} дн.` })) }, true);

  /* ── местность и инфраструктура ── */
  add({ id: 'places', section: 'ground', title: 'Пункты и районы', what: 'ключевые населённые пункты и районы (цели, места событий): что это, где, особенности, оборона (гарнизон, укрепления), значение', weight: 0.1, labels: labelsOf('terrain', ['kind', 'location', 'features', 'defense', 'significance']),
    items: input.places.map((p) => item(p.id, p.names[0], ['kind', 'location', 'features', 'defense', 'significance'], terrain.filter((e) => nameMatch(e, p.names, true)), { note: p.why, at: p.at })) });
  add({ id: 'lines', section: 'ground', title: 'Рубежи и укрепления', what: 'оборонительные полосы и позиции: где, устройство, кто оборонял, значение', weight: 0.06, labels: labelsOf('terrain', ['location', 'features', 'defense', 'significance']),
    items: input.lines.map((l) => item(l.id, l.names[0], ['location', 'features', 'defense', 'significance'], terrain.filter((e) => nameMatch(e, l.names, true)), { line: l.line })) });
  add({ id: 'rivers', section: 'ground', title: 'Реки', what: 'большие реки в районе действий: особенности, мосты и переправы, значение', weight: 0.03, labels: labelsOf('terrain', ['features', 'crossings', 'significance']),
    items: input.rivers.map((r) => item(`river:${r.names[0]}`, r.names[0], ['features', 'crossings', 'significance'], terrain.filter((e) => nameMatch(e, r.names, true)), { lines: r.lines })) });
  if (input.bridges?.length) add({ id: 'bridges', section: 'ground', title: 'Мосты и переправы', what: 'мосты на больших реках района: известно ли их состояние в операции (разрушен, цел, наведён — в театре или в сведениях операции)', weight: 0.06, labels: { state: 'состояние известно' },
    items: input.bridges.map((b) => flag(`br:${b.id}`, b.name, 'state', b.known, { note: b.how ?? (b.river ? `р. ${b.river}` : undefined), at: b.at })) });

  /* ── ход операции ── */
  const opFound = ops.filter((e) => (e.operations ?? []).includes(o.id) || e.scenario === o.id || nameMatch(e, [o.title.split(/[,:]/)[0]], true));
  const opKeys = CATEGORIES.find((c) => c.id === 'operations')!.fields.map((f) => f.key);
  add({ id: 'operation', section: 'course', title: 'Операция', what: 'даты, театр, стороны, командование, замысел, силы сторон, итог, потери', weight: 0.05, labels: labelsOf('operations', opKeys), items: [item(o.id, o.title, opKeys, opFound)] });
  const battles = byCat('battles');
  const bKeys = ['dates', 'place', 'attacker', 'defender', 'forces', 'course', 'outcome', 'losses'];
  if (input.sectors?.length) add({ id: 'battles', section: 'course', title: 'Сражения и бои по участкам', what: 'по каждому участку операции — запись о бое: даты, место, стороны, силы, ход, исход, потери', weight: 0.08, labels: labelsOf('battles', bKeys),
    items: input.sectors.map((s) => {
      const names = [s.title, ...s.title.split(/\s+и\s+|,\s*/).map((x) => x.trim()).filter((x) => x.length > 3)];
      const found = battles.filter((e) => nameMatch(e, names, true) || (overlaps(e, o.start, o.end) && names.some((n) => stems(n).filter((w) => w.length > 3).some((w) => stems(`${e.title} ${e.summary}`).includes(w)))));
      return item(`sec:${s.id}`, s.title, bKeys, found, { at: s.bbox ? [(s.bbox[0] + s.bbox[2]) / 2, (s.bbox[1] + s.bbox[3]) / 2] : undefined });
    }) });
  const dated = entries.filter((e) => (e.category === 'chronology' || e.category === 'battles') && e.period?.from);
  add({ id: 'events', section: 'course', title: 'События', what: 'ключевые события истории операции: есть ли о них запись хроники или боя на ту же дату (±1 сут)', weight: 0.12, labels: { event: 'запись о событии' },
    items: input.events.map((ev) => {
      const words = new Set([...stems(ev.title), ...(ev.place ?? []).flatMap((p) => stems(p))]);
      const found = dated.filter((e) => {
        const a = day(e.period!.from!), b = day(e.period!.to ?? e.period!.from!), d = day(ev.date);
        return d >= a - 1 && d <= b + 1 && [...stems(e.title), ...stems(e.summary ?? '')].filter((w) => words.has(w)).length >= 2;
      });
      return { ...flag(ev.id, `${ev.date.slice(8, 10)}.${ev.date.slice(5, 7)} ${ev.title}`, 'event', found.length > 0, { at: ev.at }), entries: found.map((e) => e.id) };
    }) });
  const weather = entries.filter((e) => rubricsOf(e).some((c) => within(c, '6.5')) && (overlaps(e, o.start, o.end) || (e.operations ?? []).includes(o.id)));
  add({ id: 'weather', section: 'course', title: 'Погода и грунт', what: 'погода, состояние дорог и грунта, ледостав в дни операции (рубрика 6.5)', weight: 0.02, labels: { weather: 'запись есть' },
    items: [{ ...flag('weather', `Погода и грунт: ${o.start.slice(0, 10)} — ${o.end.slice(0, 10)}`, 'weather', weather.length > 0), entries: weather.map((e) => e.id) }] });

  /* ── стороны ── */
  const org = byCat('organization').filter((e) => e.group !== 'model');
  const dItems: CoverageItem[] = [];
  for (const s of sides) for (const t of DOCTRINE) {
    const found = org.filter((e) => (e.group === s.id || !e.group) && (rubricsOf(e).some((c) => t.rub.some((r) => within(c, r))) || t.words.test(`${e.title} ${e.summary}`)));
    dItems.push(item(`doc:${s.id}:${t.id}`, `${s.name}: ${t.title}`, ['principles', 'numbers'], found, { side: s.id }));
  }
  add({ id: 'doctrine', section: 'sides', title: 'Организация и тактика', what: 'о каждой стороне: организация соединений, наступление, оборона, бой в городе, форсирование, рода войск, тыл — положения и числа (нормативы)', weight: 0.04, labels: labelsOf('organization', ['principles', 'numbers']), items: dItems }, true);
  const eq = byCat('equipment');
  const eItems: CoverageItem[] = [];
  for (const s of sides) for (const x of EQUIPMENT[s.id] ?? []) eItems.push(item(`eq:${s.id}:${x.names[0]}`, x.names[0], EQ_NEED[x.kind], eq.filter((e) => nameMatch(e, x.names, true)), { side: s.id }));
  const eqKeys = ['type', 'armament', 'armor', 'weight', 'speed', 'crew', 'range'];
  add({ id: 'equipment', section: 'sides', title: 'Вооружение и техника', what: 'основное вооружение сторон весной 1945 г.: тип, вооружение, броня, масса, скорость, экипаж, дальность', weight: 0.04, labels: labelsOf('equipment', eqKeys), items: eItems }, true);
  if (input.norms?.length) add({ id: 'norms', section: 'sides', title: 'Нормативы опыта войны', what: 'нормативы, по которым проверяются правила арбитра (темпы, потери, плотности): есть ли запись базы, источник, достоверность A/B', weight: 0.02, labels: { kb: 'запись базы', source: 'источник', reliable: 'достоверность A/B' },
    items: input.norms.map((n) => { const k = [n.kb && entries.some((e) => e.id === n.kb) ? 'kb' : '', n.source ? 'source' : '', n.reliability === 'A' || n.reliability === 'B' ? 'reliable' : ''].filter(Boolean); return { id: `norm:${n.id}`, title: n.title, need: ['kb', 'source', 'reliable'], filled: k, entries: n.kb ? [n.kb] : [], score: k.length / 3 }; }) });

  /* ── источники ── */
  const ids = new Set(groups.flatMap((g) => g.items.flatMap((i) => i.entries)));
  const facts = entries.filter((e) => ids.has(e.id)).flatMap((e) => e.facts ?? []);
  const q = { facts: facts.length, sourced: facts.filter((f) => f.source || f.quote).length, reliable: facts.filter((f) => f.reliability === 'A' || f.reliability === 'B').length };
  const docs = input.documents ?? [];
  const ratio = (a: number, b: number) => (b ? a / b : 0);
  add({ id: 'sources', section: 'sources', title: 'Источники', what: 'цели: 3 и больше документов операции, из них хотя бы один A; 80 % фактов — с источником или цитатой; половина — с достоверностью A/B', weight: 0.02, labels: { have: 'выполнено' },
    items: [
      { ...flag('docs', `Документы операции: ${docs.length} из 3`, 'have', docs.length >= 3), score: Math.min(1, docs.length / 3) },
      flag('docsA', `Документ достоверности A (официальный, справочник): ${docs.filter((d) => d.reliability === 'A').length}`, 'have', docs.some((d) => d.reliability === 'A')),
      { ...flag('sourced', `Факты с источником или цитатой: ${Math.round(ratio(q.sourced, q.facts) * 100)} % из 80 %`, 'have', ratio(q.sourced, q.facts) >= 0.8), score: Math.min(1, ratio(q.sourced, q.facts) / 0.8) },
      { ...flag('reliable', `Факты с достоверностью A/B: ${Math.round(ratio(q.reliable, q.facts) * 100)} % из 50 %`, 'have', ratio(q.reliable, q.facts) >= 0.5), score: Math.min(1, ratio(q.reliable, q.facts) / 0.5) },
    ] });

  const used = groups.filter((g) => g.items.length);
  const wsum = used.reduce((a, g) => a + g.weight, 0) || 1;
  const score = used.reduce((a, g) => a + g.weight * g.score, 0) / wsum;
  const sections = COVERAGE_SECTIONS.map((s) => { const gs = used.filter((g) => g.section === s.id); const w = gs.reduce((a, g) => a + g.weight, 0) || 1; return { ...s, score: gs.reduce((a, g) => a + g.weight * g.score, 0) / w }; }).filter((s) => used.some((g) => g.section === s.id));
  return { operation: o.id, groups, sections, score, level: levelOf(score), quality: q, sides };
}

/** Что собрать: недостающие сведения списком (markdown) — задание на поиск материалов. */
export function coverageTodo(c: Coverage, title: string): string {
  const out = [`# Что собрать по операции «${title}»`, '', `Полнота: ${Math.round(c.score * 100)} % — ${COVERAGE_LEVEL[c.level]}.`, '',
    '## С чего начать — по пользе для модели', '', hintsMarkdown(coverageHints(c), 10), '# Всё недостающее по разделам', ''];
  for (const s of c.sections) {
    out.push(`# ${s.title} — ${Math.round(s.score * 100)} %`, '');
    for (const g of c.groups.filter((x) => x.section === s.id)) {
      const miss = g.items.filter((i) => i.score < 1);
      if (!miss.length) continue;
      out.push(`## ${g.title} — ${Math.round(g.score * 100)} %`, '', `_${g.what}_`, '');
      // сводка по сведениям: чего не хватает чаще всего
      const keys = [...new Set(g.items.flatMap((i) => i.need))];
      if (keys.length > 1) out.push(`Нет сведений: ${keys.map((k) => `${g.labels[k] ?? k} — у ${g.items.filter((i) => i.need.includes(k) && !i.filled.includes(k)).length} из ${g.items.filter((i) => i.need.includes(k)).length}`).join('; ')}.`, '');
      for (const i of miss.sort((a, b) => a.score - b.score)) {
        const need = i.need.filter((k) => !i.filled.includes(k)).map((k) => g.labels[k] ?? k);
        out.push(`- **${i.title}**${i.note ? ` (${i.note})` : ''}: ${need.join(', ')}${i.entries.length || i.need[0] === 'days' || i.need[0] === 'state' || i.need[0] === 'have' ? '' : ' — записи в базе нет'}`);
      }
      out.push('');
    }
  }
  return out.join('\n');
}
export { fieldTitle as coverageFieldTitle };
