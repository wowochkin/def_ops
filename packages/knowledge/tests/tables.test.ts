import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv, decodeTable, isTemplate, templateMapping, rowsToCandidates, parseFactsJson, normalizeMapping, mappingMessages, MAPPING_SCHEMA, TEMPLATE_COLUMNS, type TableMapping } from '../src';

const doc = { id: 'd5', name: 'Таблица', reliability: 'B' as const, operation: 'berlin' };
const sample = (n: string) => readFileSync(new URL(`../../../apps/editor/public/samples/${n}`, import.meta.url));
const fromCsv = (text: string) => { const rows = parseCsv(text); return rowsToCandidates(rows, templateMapping(rows[0]), doc); };

describe('таблицы', () => {
  it('CSV шаблона: образец разбирается без ошибок, 7 видов', () => {
    expect(TEMPLATE_COLUMNS).toHaveLength(21);
    const r = fromCsv(decodeTable(new Uint8Array(sample('facts-template.csv'))));
    expect(r.errors).toEqual([]);
    expect(r.candidates.map((c) => c.claim.kind)).toEqual(['strength', 'reinforce', 'losses', 'parent', 'position', 'event', 'crossing']);
    expect(r.candidates[0]).toMatchObject({ origin: 'table', reliability: 'A', pages: 'Журнал боевых действий (пример), л. 12', op: 'berlin', verdict: 'review', names: { subject: 'Условная 1-я армия' } });
    expect(r.candidates[0].evidence).toMatchObject({ kind: 'row', doc: 'd5', row: 2 });
    expect(r.candidates[4].claim).toMatchObject({ kind: 'position', lngLat: [14.6, 52.45], uncertaintyKm: 12.5 });
  });

  it('тот же CSV в Windows-1251 с «;» и «12,5» даёт те же кандидаты', () => {
    const utf = decodeTable(new Uint8Array(sample('facts-template.csv')));
    const a = fromCsv(utf);
    // переписываем в «;» и десятичную запятую, кодируем в cp1251
    const semi = parseCsv(utf).map((r) => r.map((c) => (c === '12.5' ? '12,5' : c === '52.45' ? '52,45' : c === '14.6' ? '14,6' : /[;"\n]/.test(c) ? `"${c}"` : c)).join(';')).join('\r\n');
    const cp = new Uint8Array([...semi].map((ch) => { const k = ch.charCodeAt(0); return k < 128 ? k : k === 0x401 ? 0xa8 : k === 0x451 ? 0xb8 : k >= 0x410 && k <= 0x44f ? k - 0x410 + 0xc0 : k === 0xb7 ? 0xb7 : 0x3f; }));
    const text = decodeTable(cp);
    expect(text).toContain('Условная');
    const b = fromCsv(text);
    expect(b.errors).toEqual([]);
    // доказательство хранит ячейки как в файле («12,5»), остальное — одинаково
    const bare = (l: typeof a.candidates) => l.map(({ evidence, ...c }) => ({ ...c, row: evidence.kind === 'row' ? evidence.row : -1 }));
    expect(bare(b.candidates)).toEqual(bare(a.candidates));
  });

  it('кавычки, перевод строки в ячейке, пустая строка в конце', () => {
    expect(parseCsv('a,b\n"x, ""y""","1\n2"\n\n')).toEqual([['a', 'b'], ['x, "y"', '1\n2']]);
  });

  it('isTemplate', () => {
    expect(isTemplate([...TEMPLATE_COLUMNS])).toBe(true);
    expect(isTemplate(['Соединение', '16.04.1945'])).toBe(false);
  });

  it('дни в столбцах: кандидат на каждую непустую ячейку', () => {
    const rows = parseCsv('Соединение;16.04.1945;17.04.1945\n1-я армия;1 200;\n2-я армия;300;450\n');
    const mapping: TableMapping = { kind: 'losses', columns: ['subject', { day: '1945-04-16', field: 'total' }, { day: '1945-04-17', field: 'total' }] };
    const r = rowsToCandidates(rows, mapping, doc);
    expect(r.errors).toEqual([]);
    expect(r.candidates).toHaveLength(3);
    expect(r.candidates.map((c) => (c.claim as { from: string }).from)).toEqual(['1945-04-16', '1945-04-16', '1945-04-17']);
    expect(r.candidates[0].claim).toMatchObject({ kind: 'losses', total: 1200, to: '1945-04-16' });
    expect(new Set(r.candidates.map((c) => c.id)).size).toBe(3);
    // доказательство помнит ячейку своего дня
    expect(r.candidates[1].evidence).toMatchObject({ kind: 'row', cell: '16.04.1945', dayCells: ['16.04.1945', '17.04.1945'] });
    expect(r.candidates[2].evidence).toMatchObject({ cell: '17.04.1945' });
  });

  it('дата 32.04.1945 — ошибка строки 2; 16.04.1945 и 1945-04-16 равны', () => {
    const hdr = 'kind,subject,date,personnel';
    const r = fromCsv(`${hdr}\nstrength,А,32.04.1945,10\nstrength,Б,16.04.1945,10\nstrength,В,1945-04-16,10\nstrength,Г,16.04.1945,много`);
    expect(r.errors[0].row).toBe(2);
    expect(r.errors[0].why).toContain('дат');
    expect(r.errors[1]).toMatchObject({ row: 5 });
    expect(r.errors[1].why).toContain('число');
    expect(r.candidates.map((c) => (c.claim as { at: string }).at)).toEqual(['1945-04-16', '1945-04-16']);
  });

  it('JSON: чужой format — ошибка; пакет: ref → agent, иначе table', () => {
    expect(parseFactsJson({ format: 'other', facts: [] }, doc).errors[0].why).toContain('не формат def-ops-facts');
    const r = parseFactsJson(JSON.parse(readFileSync(new URL('../../../apps/editor/public/samples/facts-template.json', import.meta.url), 'utf8')), { ...doc, reliability: 'C' });
    expect(r.errors).toEqual([]);
    expect(r.candidates.map((c) => c.origin)).toEqual(['agent', 'agent', 'agent', 'agent', 'agent', 'agent', 'agent']);
    expect(r.candidates[0].evidence).toEqual({ kind: 'agent', ref: 'Условный фонд, оп. 1, д. 1, л. 12', quote: 'К исходу дня в армии 52000 человек, 310 танков' });
    expect(r.candidates[1].reliability).toBe('B');   // достоверность пакета, не документа (C)
    expect(r.candidates[0].reliability).toBe('A');
    // естественные ключи: между/точки, состояние, название
    expect(r.candidates[4].claim).toMatchObject({ kind: 'boundary', points: ['Условные Холмы', 'Условный Брод', 'Условная Слобода'], from: '1945-04-16', to: '1945-04-20' });
    expect(r.candidates[4].names.between).toEqual(['Условная 1-я армия', 'Условная 2-я армия']);
    expect(r.candidates[5].claim).toMatchObject({ kind: 'crossing', state: 'built' });
    expect(r.candidates[6].claim).toMatchObject({ kind: 'event', title: 'Взят опорный пункт' });
    // ref пакета — запасной шифр факта без своего ref
    expect(r.candidates[3].evidence).toMatchObject({ kind: 'agent', ref: 'Условный фонд, оп. 1, д. 1' });
    expect(r.candidates[3].pages).toBe('Пример пакета фактов (вымышленные значения)');
    expect(r.candidates[0].pages).toBe('Пример пакета фактов (вымышленные значения), л. 12');
  });

  it('JSON без ref в пакете: факт без ref — строка таблицы', () => {
    const r = parseFactsJson({ format: 'def-ops-facts', version: 1, facts: [{ kind: 'enter', subject: 'А', date: '1945-04-16' }] }, doc);
    expect(r.candidates[0].origin).toBe('table');
    expect(r.candidates[0].evidence).toMatchObject({ kind: 'row', row: 1 });
  });

  it('состояния переправы по-русски', () => {
    const f = (state: string) => parseFactsJson({ format: 'def-ops-facts', version: 1, facts: [{ kind: 'crossing', subject: 'М', date: '1945-04-16', state }] }, doc).candidates[0]?.claim;
    expect(f('Взорван')).toMatchObject({ state: 'destroyed' });
    expect(f('уничтожен')).toMatchObject({ state: 'destroyed' });
    expect(f('Построен')).toMatchObject({ state: 'built' });
    expect(f('действует')).toMatchObject({ state: 'open' });
    expect(f('цел')).toMatchObject({ state: 'open' });
  });

  it('разряды и дробные: счётные целые, десятичные только в координатах', () => {
    const r = fromCsv('kind,subject,date,personnel,total,approx_km\nstrength,А,16.04.1945,52.000,,\nstrength,Б,16.04.1945,"1 200",,\nlosses,В,16.04.1945,,"450,5",\nposition,Г,16.04.1945,,,"12,5"\nposition,Д,16.04.1945,"1,200",,');
    expect(r.candidates[0].claim).toMatchObject({ personnel: 52000 });
    expect(r.candidates[1].claim).toMatchObject({ personnel: 1200 });
    expect(r.errors.map((e) => e.row)).toEqual([4, 5, 6]);
    expect(r.errors[0].why).toContain('не целое');
  });

  it('позиция и граница: обязательные поля', () => {
    const r = fromCsv('kind,subject,date,place,lat,lon\nposition,А,16.04.1945,,52.4,\nposition,Б,16.04.1945,,52.4,14.6\nposition,В,16.04.1945,Холмы,,\nboundary,А / Б,16.04.1945,Холмы,,\nboundary,А | Б,16.04.1945,Холмы | Брод,,');
    expect(r.errors.map((e) => e.row)).toEqual([2, 5]);
    expect(r.candidates.map((c) => c.claim.kind)).toEqual(['position', 'position', 'boundary']);
  });

  it('пустой или неизвестный kind при столбце kind — ошибка строки', () => {
    const r = fromCsv('kind,subject,date,personnel\n,А,16.04.1945,10\nнечто,Б,16.04.1945,10');
    expect(r.candidates).toEqual([]);
    expect(r.errors[0].why).toContain('не указан вид');
    expect(r.errors[1].why).toContain('неизвестный вид');
  });

  it('source и pages строки — в pages кандидата', () => {
    const r = fromCsv('kind,subject,date,personnel,source,pages\nstrength,А,16.04.1945,10,Журнал,л. 3');
    expect(r.candidates[0].pages).toBe('Журнал, л. 3');
    expect(r.candidates[0].source).toBe('doc:d5');
  });

  it('кавычки после пробела: a, "b,c" — одна ячейка', () => {
    expect(parseCsv('a, "b,c"\n')).toEqual([['a', 'b,c']]);
  });

  it('normalizeMapping: число значений, чужие слова — skip, негодный вид — null', () => {
    expect(normalizeMapping({ kind: 'losses', columns: ['subject', 'чушь', { day: '1945-04-16', field: 'total' }, { day: 'x', field: 'bogus' }] }, 6)).toEqual({
      kind: 'losses', columns: ['subject', 'skip', { day: '1945-04-16', field: 'total' }, 'skip', 'skip', 'skip'],
    });
    expect(normalizeMapping({ kind: 'losses', columns: ['a', 'b', 'c'] }, 2)?.columns).toHaveLength(2);
    expect(normalizeMapping({ kind: 'nope', columns: [] }, 1)).toBeNull();
    expect(normalizeMapping(null, 1)).toBeNull();
  });

  it('запрос сопоставления и схема', () => {
    const m = mappingMessages(['Часть', 'Дата'], [['1-я А', '16.04.1945']]);
    expect(m[1].content).toContain('Часть | Дата');
    expect(MAPPING_SCHEMA.required).toEqual(['kind', 'columns']);
  });
});
