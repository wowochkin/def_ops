import { expect, it } from 'vitest';
import set from '../data/sets/ru-modern-v2.json' with { type: 'json' };
import pages from '../data/vector-pages.json' with { type: 'json' };
import { sourceRegistry } from '../src/source/registry';

it('набор v2 содержит все 610 подтверждённых номеров без заготовок и дублей', () => {
  expect(set.symbols).toHaveLength(610);
  expect(new Set(set.symbols.map(symbol => symbol.id)).size).toBe(610);
  expect(set.symbols.every(symbol => !symbol.name.includes('несверенная заготовка'))).toBe(true);
  expect(set.symbols.every(symbol => symbol.status === 'MAPPED')).toBe(true);
  const numbers = set.symbols.map(symbol => Number(symbol.source.symbolNumber));
  expect(new Set(numbers).size).toBe(610);
  expect(Math.min(...numbers)).toBe(1);
  expect(Math.max(...numbers)).toBe(613);
  expect(numbers).not.toEqual(expect.arrayContaining([321, 322, 323]));
});

it('каждая запись связана с существующей страницей и непустым векторным охватом', () => {
  expect(Object.keys(pages)).toHaveLength(83);
  const fragments = new Set(sourceRegistry.fragments.map(fragment => fragment.id));
  for (const symbol of set.symbols) {
    expect(fragments.has(symbol.source.fragmentId)).toBe(true);
    expect(Object.hasOwn(pages, symbol.geometry.parameters.pageId)).toBe(true);
    const box = symbol.geometry.parameters.viewBox.split(' ').map(Number);
    expect(box).toHaveLength(4);
    expect(box[2]).toBeGreaterThan(0);
    expect(box[3]).toBeGreaterThan(0);
  }
});


it('образец «Танк» не содержит заголовок главы или соседний знак', () => {
  const tank = set.symbols.find(symbol => symbol.id === 'source-75')!;
  const [x, y, width, height] = tank.geometry.parameters.viewBox.split(' ').map(Number);
  expect(x).toBeGreaterThanOrEqual(95);
  expect(y).toBeGreaterThan(84);
  expect(y + height).toBeLessThan(125);
  expect(width).toBeLessThan(155);
  expect(tank.geometry.parameters.elements).not.toContain(',');
});


it('не включает цифры исходного номера в сложные образцы', () => {
  for (const id of ['source-324', 'source-426']) {
    const symbol = set.symbols.find(item => item.id === id)!;
    const page = pages[symbol.geometry.parameters.pageId as keyof typeof pages];
    const selected = symbol.geometry.parameters.elements.split(',').map(Number);
    expect(selected.every(index => !(page.elements[index].html.startsWith('<g') && page.elements[index].x < 110)), id).toBe(true);
  }
});


it('связывает запись 125 с графикой внизу предыдущей страницы', () => {
  const symbol = set.symbols.find(item => item.id === 'source-125')!;
  expect(symbol.source.page).toBe(6);
  expect(symbol.geometry.parameters.pageId).toBe('doc-005-page-005');
  const page = pages[symbol.geometry.parameters.pageId as keyof typeof pages];
  const selected = symbol.geometry.parameters.elements.split(',').filter(Boolean).map(Number);
  expect(selected.some(index => page.elements[index].html.startsWith('<path'))).toBe(true);
  expect(selected).toContain(659);
});


it('сохраняет линии с нулевой шириной или высотой во всех шести вариантах записи 68', () => {
  const symbol = set.symbols.find(item => item.id === 'source-68')!;
  const selected = symbol.geometry.parameters.elements.split(',').filter(Boolean).map(Number);
  expect(selected).toEqual(expect.arrayContaining([774, 776, 777, 790, 808]));
});


it('разделяет элементы записей 436 и 437 на общей исходной странице', () => {
  const previous = set.symbols.find(item => item.id === 'source-436')!;
  const current = set.symbols.find(item => item.id === 'source-437')!;
  expect(current.geometry.parameters.pageId).toBe('doc-022-page-001');
  const before = new Set(previous.geometry.parameters.elements.split(','));
  const after = current.geometry.parameters.elements.split(',').filter(Boolean);
  expect(after.length).toBeGreaterThan(0);
  expect(after.every(index => !before.has(index))).toBe(true);
});


it('восстанавливает название от начала описания, а не от строки номера', () => {
  expect(set.symbols.find(symbol => symbol.id === 'source-68')!.name).toContain('Походные колонны');
  expect(set.symbols.find(symbol => symbol.id === 'source-324')!.name).toContain('Район водообеспечения');
});
