import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import { CATEGORIES, chunkText, gameReference, gather, Index, qaMessages, quoteFound, toProposals, type Entry, type ExtractedItem } from '../src';

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

  it('справка для игры: без вопросов истории — только доктрина, техника, местность', () => {
    const idx = new Index(entries);
    const safe = gameReference(idx, byId, 'Зееловские высоты оборона', false);
    expect(safe).not.toMatch(/Сражение на Зееловских высотах/);
    const hist = gameReference(idx, byId, 'Зееловские высоты оборона', true);
    expect(hist).toMatch(/история/);
    const src = gather(idx, byId, 'бой за рейхстаг', { limit: 4 });
    const m = qaMessages('lecture', 'бой за рейхстаг', src);
    expect(m[m.length - 1].content).toMatch(/\[1\]/);
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
      { category: 'formations', title: '8-я гвардейская армия', aliases: [], summary: '', dateFrom: null, dateTo: null, relations: [],
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
  });
});
