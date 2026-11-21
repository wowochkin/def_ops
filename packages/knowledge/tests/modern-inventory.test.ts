import { describe, it, expect } from 'vitest';
import { parseInventory, normalizeModelName } from '../../../scripts/modern-inventory-parser.mjs';
const cell = (text: string, extra = {}) => ({ text, header: false, rowspan: 1, colspan: 1, links: [], ...extra });
const page = (rows: ReturnType<typeof cell>[][]) => ({ tables: [{index: 0, headings: ['Aircraft'], rows}] });
describe('разбор справочных перечней', () => {
 it('учитывает изображение первым и не переносит количество и примечания', () => {
  const result = parseInventory(page([[cell('Image',{header:true}),cell('Model',{header:true}),cell('Quantity',{header:true}),cell('Notes',{header:true})],[cell(''),cell('A-1'),cell('123'),cell('secret deployment')]]), 'air');
  expect(result.records[0].title).toBe('A-1');
  expect(JSON.stringify(result.records)).not.toMatch(/123|secret deployment/);
 });
 it('разворачивает rowspan и сохраняет класс корабля вместо имени корпуса', () => {
  const r = parseInventory(page([[cell('Class',{header:true}),cell('Ship',{header:true}),cell('Type',{header:true})],[cell('Hamina class',{rowspan:2}),cell('Hamina'),cell('Missile boat',{rowspan:2})],[cell('Tornio')]]), 'navy');
  expect(r.records.map(x => x.title)).toEqual(['Hamina class']);
 });
 it('не превращает заголовки и пустые классы в модели', () => {
  const r = parseInventory(page([[cell('Class',{header:true}),cell('Ship',{header:true})],[cell('Carriers',{colspan:2})],[cell('—'),cell('HMS Victory')]]), 'navy');
  expect(r.records).toHaveLength(0);
  expect(r.unresolved).toHaveLength(1);
 });
 it('сохраняет составную строку для проверки и не склеивает варианты при сопоставлении', () => {
  const r = parseInventory(page([[cell('Name',{header:true}),cell('Type',{header:true})],[cell('T-90M\nT-90MS'),cell('Tank')]]), 'ground');
  expect(r.records[0].title).toBe('T-90M / T-90MS');
  expect(r.records[0].aliases).toEqual(['T-90M','T-90MS']);
  expect(normalizeModelName('Т-90М')).toBe(normalizeModelName('T-90M'));
  expect(normalizeModelName('T-90M')).not.toBe(normalizeModelName('T-90MS'));
 });
});
