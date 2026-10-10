import { describe, expect, it } from 'vitest';
import { assessCoverage, coverageTodo, formationNeeds, type CoverageInput, type Entry } from '../src';

const input: CoverageInput = {
  operation: { id: 'op1', title: 'Операция', start: '1945-04-16T00:00', end: '1945-05-02T00:00' },
  formations: [{ id: 'su_8gva', name: '8-я гвардейская армия', side: 'su', echelon: 'army' }, { id: 'de_x', name: 'Дивизия Икс', side: 'de', echelon: 'division' }],
  places: [{ id: 'Seelow', names: ['Зелов', 'Seelow'], why: 'место события' }],
  lines: [], rivers: [],
  events: [{ id: 'e1', title: 'Прорыв Зееловских высот у Мюнхеберга', date: '1945-04-19' }],
};
const f = (key: string, value = 'x') => ({ key, value });
const entries: Entry[] = [
  { id: 'a', category: 'formations', title: '8-я гвардейская армия', aliases: ['su_8gva'], summary: '', status: 'checked', facts: [f('commander', 'ген.-полк. В. И. Чуйков'), f('personnel'), f('tanks')] },
  { id: 'a2', category: 'formations', title: '8-я гвардейская армия', aliases: ['su_8gva_vo'], summary: '', status: 'checked', facts: [f('composition'), f('guns'), f('path')] },
  { id: 'c', category: 'commanders', title: 'В. И. Чуйков', summary: '', status: 'checked', facts: [f('rank'), f('post')] },
  { id: 'p', category: 'terrain', title: 'Зелов', aliases: ['Seelow'], summary: '', status: 'checked', facts: [f('kind'), f('defense')] },
  { id: 'h', category: 'chronology', title: 'Прорыв у Мюнхеберга', summary: 'Зееловские высоты прорваны', period: { from: '1945-04-18' }, status: 'checked', facts: [f('event')] },
];

describe('полнота материалов по каркасу', () => {
  const c = assessCoverage(input, entries);
  const g = (id: string) => c.groups.find((x) => x.id === id)!;

  it('формирование — по своей записи (id сценария), не по одноимённой записи другой операции', () => {
    const it8 = g('formations').items.find((i) => i.id === 'su_8gva')!;
    expect(it8.need).toEqual(formationNeeds('army'));
    expect(it8.filled).toEqual(['commander', 'personnel', 'tanks']);
    expect(it8.entries).toEqual(['a']);
    expect(g('formations').items.find((i) => i.id === 'de_x')!.entries).toEqual([]);
  });

  it('командующий — по фамилии из записи формирования; пункт — оборона учитывается; событие — по дате и словам', () => {
    expect(g('commanders').items[0].filled).toEqual(['rank', 'post']);
    expect(g('places').items[0].filled).toEqual(['kind', 'defense']);
    expect(g('events').items[0].score).toBe(1);
    expect(c.score).toBeGreaterThan(0); expect(c.score).toBeLessThan(1);
    expect(c.level).toBe('little');
  });

  it('разделы: стороны (организация, вооружение), источники; положения по дням и мосты — из данных операции', () => {
    expect(g('doctrine').items.length).toBe(16); // 2 стороны × 8 тем
    expect(g('equipment').items.some((i) => i.title === 'Т-34-85')).toBe(true);
    expect(g('formations').bySide!.su).toBeGreaterThan(g('formations').bySide!.de);
    expect(c.sections.map((x) => x.id)).toEqual(['forces', 'ground', 'course', 'sides', 'sources']);
    const c2 = assessCoverage({ ...input, positions: [{ id: 'su_8gva', name: '8-я гв. А', side: 'su', days: 8, total: 16 }], bridges: [{ id: 'b1', name: 'мост', known: true }, { id: 'b2', name: 'мост 2', known: false }] }, entries);
    expect(c2.groups.find((x) => x.id === 'positions')!.score).toBe(0.5);
    expect(c2.groups.find((x) => x.id === 'bridges')!.score).toBe(0.5);
  });

  it('список недостающего — по элементам, с названиями сведений', () => {
    const md = coverageTodo(c, 'Операция');
    expect(md).toMatch(/Дивизия Икс.*записи в базе нет/);
    expect(md).toMatch(/8-я гвардейская армия.*Состав/);
  });
});

describe('подсказки, что искать', () => {
  it('по дефицитам: сведения формирований — первыми, с источниками, запросами и списком элементов', async () => {
    const { coverageHints } = await import('../src/hints');
    const c = assessCoverage(input, entries);
    const h = coverageHints(c);
    expect(h.length).toBeGreaterThan(5);
    const top = h.slice(0, 6).map((x) => x.id);
    expect(top.some((id) => id.startsWith('formations:'))).toBe(true);
    const comp = h.find((x) => x.id === 'formations:composition')!;
    expect(comp.items).toContain('Дивизия Икс');
    expect(comp.where.length).toBeGreaterThan(0);
    expect(comp.queries[0]).toMatch(/состав/);
    expect(h.every((x, i) => i === 0 || h[i - 1].priority >= x.priority)).toBe(true);
    expect(coverageTodo(c, 'Операция')).toMatch(/С чего начать/);
  });
});

describe('полнота: разграничительные линии', () => {
  const pair = (directives: { title: string; source?: string; reliability?: string }[]) => ({ id: 'a|b', side: 'su', a: { id: 'su_1bf', names: ['1-й Белорусский фронт', '1 БФ'] }, b: { id: 'su_1uf', names: ['1-й Украинский фронт', '1 УФ'] }, directives });
  const kb: Entry[] = [{ id: 'f1', category: 'formations', title: '1-й Белорусский фронт', aliases: ['su_1bf'], summary: '', status: 'checked', facts: [{ key: 'boundary', value: '1-й Белорусский фронт / 1-й Украинский фронт: Люббен — Тойпитц', source: 'src:x', reliability: 'A' }] }];
  it('линия по директиве в сценарии — заполнено полностью', () => {
    const c = assessCoverage({ ...input, boundaries: [pair([{ title: 'директива', source: '№ 11074', reliability: 'A' }])] }, []);
    expect(c.groups.find((g) => g.id === 'boundaries')!.items[0].score).toBe(1);
  });
  it('нет директивы — по факту базы о соседе; нет ничего — пробел с подсказкой поиска', () => {
    expect(assessCoverage({ ...input, boundaries: [pair([])] }, kb).groups.find((g) => g.id === 'boundaries')!.items[0].filled).toEqual(['line', 'source', 'reliable']);
    const c = assessCoverage({ ...input, boundaries: [pair([])] }, []);
    expect(c.groups.find((g) => g.id === 'boundaries')!.items[0].score).toBe(0);
    expect(coverageTodo(c, 'Операция')).toMatch(/Разграничительные линии/);
  });
});

