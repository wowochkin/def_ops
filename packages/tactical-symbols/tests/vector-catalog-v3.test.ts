import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const path = new URL('../data/sets/ru-modern-v3.json', import.meta.url);

it('содержит отдельные векторные варианты записи 68 и полный текст записи 125', () => {
  expect(existsSync(path)).toBe(true);
  const set = JSON.parse(readFileSync(path, 'utf8'));
  const ids = new Set(set.symbols.map((symbol: { id: string }) => symbol.id));
  for (let variant = 1; variant <= 6; variant += 1) expect(ids.has(`source-68-${variant}`)).toBe(true);
  const guns = set.symbols.filter((symbol: { id: string }) => symbol.id.startsWith('source-125-'));
  expect(guns).toHaveLength(4);
  expect(guns[0].purpose).toContain('Зенитные орудия');
  expect(guns[0].purpose).toContain('крупного калибра');
});

it('не объединяет соседние номера и сохраняет две строки тягачей под номерами 80 и 81', () => {
  const set = JSON.parse(readFileSync(path, 'utf8'));
  const byNumber = (number: number) => set.symbols.filter((symbol: { source: { symbolNumber: string } }) => symbol.source.symbolNumber === String(number));
  expect(byNumber(77)[0].name).toContain('Боевая разведывательная');
  expect(byNumber(78)[0].name).toContain('Бронетранспортер');
  expect(byNumber(80).every((symbol: { name: string }) => symbol.name.startsWith('Тягачи'))).toBe(true);
  expect(byNumber(81).every((symbol: { name: string }) => symbol.name.startsWith('Тягачи'))).toBe(true);
  expect(byNumber(80)[0].geometry.parameters.pageId).not.toBe(byNumber(81)[0].geometry.parameters.pageId);
});

it('читает номера вариантов по визуальным строкам с допуском базовой линии', () => {
  const set = JSON.parse(readFileSync(path, 'utf8'));
  const ids = new Set(set.symbols.map((symbol: { id: string }) => symbol.id));
  for (const id of ['source-83-1', 'source-83-2', 'source-83-3', 'source-86-1', 'source-86-2', 'source-86-3', 'source-86-4', 'source-128-7', 'source-128-8']) {
    expect(ids.has(id), id).toBe(true);
  }
});

it('разделяет пять групп с подписями на границе колонки или без номеров вариантов', () => {
  const set = JSON.parse(readFileSync(path, 'utf8'));
  const expected = new Map([[26, 2], [110, 2], [133, 5], [196, 5], [218, 3]]);
  for (const [number, count] of expected) {
    const variants = set.symbols.filter((symbol: { source: { symbolNumber: string } }) => symbol.source.symbolNumber === String(number));
    expect(variants, `source-${number}`).toHaveLength(count);
  }
});

it('не включает контур следующей строки или служебную цифру векторный вариант', () => {
  const set = JSON.parse(readFileSync(path, 'utf8'));
  const firstRocket = set.symbols.find((symbol: { id: string }) => symbol.id === 'source-124-1');
  const firstGun = set.symbols.find((symbol: { id: string }) => symbol.id === 'source-125-1');
  expect(firstRocket.geometry.parameters.elements.split(',')).not.toContain('200');
  expect(firstGun.geometry.parameters.elements.split(',')).not.toContain('2');
});

it('переносит 20 знаков МПО без выдуманной уставной нумерации', () => {
  const set = JSON.parse(readFileSync(path, 'utf8'));
  const mpo = set.symbols.filter((symbol: { id: string }) => idStartsWithMpo(symbol.id));
  expect(mpo).toHaveLength(20);
  expect(mpo.every((symbol: { source: { symbolNumber: string | null; page: number } }) => symbol.source.symbolNumber === null && symbol.source.page >= 1 && symbol.source.page <= 3)).toBe(true);
});

it('называет вариант по его смыслу и не переносит пояснительную цифру в знак', () => {
  const set = JSON.parse(readFileSync(path, 'utf8'));
  const rear = set.symbols.find((symbol: { id: string }) => symbol.id === 'source-68-6');
  expect(rear.name).toContain('Походные колонны');
  expect(rear.name).toContain('тыла');
  expect(rear.name).not.toContain('1 - мотострелковых');
  expect(rear.geometry.parameters.elements.split(',')).not.toContain('6');
});

it('восстанавливает плавающую графику шести вариантов из исходной страницы', () => {
  const set = JSON.parse(readFileSync(path, 'utf8'));
  const ids = new Set(set.symbols.map((symbol: { id: string }) => symbol.id));
  for (const id of ['source-160-8', 'source-190-3', 'source-190-4', 'source-239-3', 'source-606-1', 'source-606-2']) {
    expect(ids.has(id), id).toBe(true);
  }
});

it('выделяет исходную надпись 2мсд как редактируемую без пояснительной цифры', () => {
  const set = JSON.parse(readFileSync(path, 'utf8'));
  const rear = set.symbols.find((symbol: { id: string }) => symbol.id === 'source-68-6');
  const inscription = rear.inscriptions.find((item: { text: string }) => item.text === '2мсд');
  expect(inscription).toBeDefined();
  expect(inscription.elements).toEqual([3, 4, 5]);
  expect(inscription).toMatchObject({ fontFamily: 'Arial', fontWeight: '700', fontStyle: 'italic' });
});

it('различает участок оповещения и его пять вариантов в названиях', () => {
  const set = JSON.parse(readFileSync(path, 'utf8'));
  const base = set.symbols.find((symbol: { id: string }) => symbol.id === 'source-605-1');
  const firstVariant = set.symbols.find((symbol: { id: string }) => symbol.id === 'source-606-1');
  expect(base.name).toBe('Участок оповещения');
  expect(firstVariant.name).toContain('Участок оповещения');
  expect(firstVariant.name).toContain('пункт предварительного сбора граждан');
  expect(firstVariant.name).not.toContain('2 - пункт');
});

function idStartsWithMpo(id: string) {
  return id.startsWith('mpo-');
}
