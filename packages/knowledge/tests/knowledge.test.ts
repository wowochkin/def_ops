import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import { hybridHits, rrf, toVec, dot, queryText, entryEmbedText, CATEGORIES, RUBRIC_CODES, rubricPath, rubricsOf, applyProposal, chunkText, gameReference, gather, Index, qaMessages, quoteFound, toProposals, type Entry, type ExtractedItem } from '../src';

const entries = (seed as { entries: Entry[] }).entries;
const byId = new Map(entries.map((e) => [e.id, e]));

describe('база знаний: каркас и начальное наполнение', () => {
  it('все записи — в категориях каркаса, связи не висят, у формирований есть факты с источником', () => {
    const cats = new Set(CATEGORIES.map((c) => c.id));
    expect(entries.length).toBeGreaterThan(1000);
    for (const e of entries) {
      expect(cats.has(e.category), e.id).toBe(true);
      for (const r of e.relations ?? []) expect(byId.has(r.target), `${e.id} → ${r.target}`).toBe(true);
    }
    for (const c of CATEGORIES) expect(entries.some((e) => e.category === c.id), c.id).toBe(true);
    const z = byId.get('f:su_8gva')!;
    expect(z.facts!.some((f) => f.key === 'commander')).toBe(true);
    expect(byId.get('op:berlin')!.sections!.length).toBeGreaterThan(5);
  });

  it('поиск по-русски находит по основам слов', () => {
    const idx = new Index(entries);
    expect(idx.search('Зееловских высотах', { limit: 3 })[0].ref).toMatch(/seelow/);
    expect(idx.search('котёл Хальбе', { limit: 3 }).some((h) => h.ref === 'battle:halbe')).toBe(true);
    expect(idx.search('Жуков', { limit: 3 }).some((h) => byId.get(h.ref)?.category === 'commanders')).toBe(true);
  });

  it('справка для игры: без вопросов истории — только доктрина и техника', () => {
    const idx = new Index(entries);
    const safe = gameReference(idx, byId, 'Зееловские высоты оборона', false);
    expect(safe).not.toMatch(/Сражение на Зееловских высотах/);
    const tanks = gameReference(idx, byId, 'танки в городе фаустпатрон наступление', false);
    expect(tanks).toMatch(/Фаустпатрон/);
    expect(tanks).not.toMatch(/\((Театр|Сражения и бои|Формирования|Источники)\)|Модель:/);
    const hist = gameReference(idx, byId, 'Зееловские высоты оборона', true);
    expect(hist).toMatch(/история/);
    const src = gather(idx, byId, 'бой за рейхстаг', { limit: 4 });
    const m = qaMessages('lecture', 'бой за рейхстаг', src);
    expect(m[m.length - 1].content).toMatch(/\[1\]/);
  });
});

describe('рубрикатор', () => {
  it('у каждой записи есть рубрика из рубрикатора; сражения — в своей операции и теме', () => {
    for (const e of entries) {
      const r = rubricsOf(e);
      expect(r.length, e.id).toBeGreaterThan(0);
      for (const c of r) expect(RUBRIC_CODES, e.id).toContain(c);
    }
    expect(rubricsOf(byId.get('battle:reichstag')!)).toEqual(['1.2.6', '3.2.3']);
    expect(rubricPath('1.2.6').map((x) => x.title)).toEqual(['Операции и сражения', 'Берлинская операция (16.04–08.05.1945)', 'Штурм Берлина']);
    expect(rubricsOf(byId.get('cmd:zhukov') ?? entries.find((e) => e.category === 'commanders' && e.group === 'su')!)).toEqual(['7.1']);
  });
});

describe('документы: разбивка и проверка извлечённого', () => {
  const text = 'Предисловие.\n\n' + 'На рассвете 16 апреля 1945 года 8-я гвардейская армия генерала Чуйкова перешла в наступление с Кюстринского плацдарма. '.repeat(3) + '\n\n' + 'Танковая армия была введена в бой к полудню.';
  it('части текста — по абзацам, с перекрытием', () => {
    const parts = chunkText(text + '\n\n' + 'x '.repeat(4000), 1000, 100);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.every((p) => p.length <= 1600)).toBe(true);
  });
  it('факт без цитаты из текста отбрасывается; совпавшая запись — дополнение, новая — с подтверждёнными фактами', () => {
    expect(quoteFound('8-я гвардейская   армия генерала Чуйкова', text)).toBe(true);
    expect(quoteFound('армия взяла Берлин 17 апреля', text)).toBe(false);
    const items: ExtractedItem[] = [
      { category: 'formations', rubrics: ['1.2.2', '9.9.9'], title: '8-я гвардейская армия', aliases: [], summary: '', dateFrom: null, dateTo: null, relations: [],
        facts: [{ key: 'commander', value: 'В. И. Чуйков', quote: '8-я гвардейская армия генерала Чуйкова' }, { key: 'path', value: '16.04 перешла в наступление с Кюстринского плацдарма', quote: 'перешла в наступление с Кюстринского плацдарма' }, { key: 'personnel', value: '100 000', quote: 'численность 100 тысяч' }] },
      { category: 'battles', title: 'Бой у Выдуманной деревни', aliases: [], summary: '', dateFrom: null, dateTo: null, relations: [],
        facts: [{ key: 'outcome', value: 'победа', quote: 'вымышленная цитата, которой нет' }] },
    ];
    const r = toProposals(items, text, entries, { id: 'd1', name: 'тест', reliability: 'B' }, 0);
    expect(r.dropped).toBe(2);
    expect(r.proposals.length).toBe(1);
    expect(r.proposals[0].kind).toBe('update');
    expect(r.proposals[0].target).toBe('f:su_8gva');
    expect(r.proposals[0].facts.map((f) => f.key)).toEqual(['path']); // командир уже есть — повтор не предлагается
    expect(r.proposals[0].facts[0].source).toBe('doc:d1');
    expect(r.proposals[0].rubrics).toEqual(['1.2.2']); // несуществующая рубрика отброшена
    const merged = applyProposal(r.proposals[0], byId.get('f:su_8gva'));
    expect(merged.rubrics).toEqual(['2.1.2', '1.2.2']);
  });
});

describe('смысловой поиск: векторы и слияние выдач', () => {
  it('вектор урезается (MRL) и нормируется; RRF поднимает найденное обоими способами', () => {
    const v = toVec([3, 4, 12], 2);
    expect(v.length).toBe(2);
    expect(dot(v, v)).toBeCloseTo(1, 5);
    const f = rrf([[{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'c' }, { id: 'd' }]]);
    expect(f[0].id).toBe('c');
    const idx = new Index(entries);
    const bm = idx.search('рейхстаг', { limit: 5 });
    const h = hybridHits(bm, [{ id: 'e:battle:berlin-storm', score: 0.9 }], (id) => idx.doc(id), 5);
    expect(h.some((x) => x.ref === 'battle:berlin-storm')).toBe(true);
    expect(queryText('бой за рейхстаг', { dims: 0, eos: true })).toMatch(/^Instruct: .+\nQuery:бой за рейхстаг<\|endoftext\|>$/);
    expect(entryEmbedText(byId.get('battle:reichstag')!)).toMatch(/^Бой за рейхстаг .*Сражения и бои/);
  });
});

describe('нормативы для правил арбитра', () => {
  it('каждый норматив таблицы sim:norms ссылается на запись базы знаний', async () => {
    const { readFileSync } = await import('node:fs');
    const t = JSON.parse(readFileSync(new URL('../../sim/data/rules/norms.json', import.meta.url), 'utf8')) as { norms: { id: string; kb: string; expect?: number[]; measure: { kind: string } }[] };
    for (const n of t.norms) {
      expect(byId.has(n.kb), n.id).toBe(true);
      if (n.measure.kind !== 'unmodelled') expect(n.expect?.length, n.id).toBe(2);
    }
  });
});
