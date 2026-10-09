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
    expect(c.level).toBe('partial');
  });

  it('список недостающего — по элементам, с названиями сведений', () => {
    const md = coverageTodo(c, 'Операция');
    expect(md).toMatch(/Дивизия Икс.*записи в базе нет/);
    expect(md).toMatch(/8-я гвардейская армия.*Состав/);
  });
});
