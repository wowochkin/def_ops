import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv, decodeTable, isTemplate, templateMapping, rowsToCandidates, parseFactsJson, mappingMessages, MAPPING_SCHEMA, TEMPLATE_COLUMNS, type TableMapping } from '../src';

const doc = { id: 'd5', name: 'Таблица', reliability: 'B' as const, operation: 'berlin' };
const sample = (n: string) => readFileSync(new URL(`../../../apps/editor/public/samples/${n}`, import.meta.url));
const fromCsv = (text: string) => { const rows = parseCsv(text); return rowsToCandidates(rows, templateMapping(rows[0]), doc); };

describe('таблицы', () => {
  it('CSV шаблона: образец разбирается без ошибок, 7 видов', () => {
    expect(TEMPLATE_COLUMNS).toHaveLength(21);
    const r = fromCsv(decodeTable(new Uint8Array(sample('facts-template.csv'))));
    expect(r.errors).toEqual([]);
    expect(r.candidates.map((c) => c.claim.kind)).toEqual(['strength', 'reinforce', 'losses', 'parent', 'position', 'event', 'crossing']);
    expect(r.candidates[0]).toMatchObject({ origin: 'table', reliability: 'A', pages: 'л. 12', op: 'berlin', verdict: 'review', names: { subject: 'Условная 1-я армия' } });
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
    const rows = parseCsv('Соединение;16.04.1945;17.04.1945\n1-я армия;1 200;\n2-я армия;300;450,5\n');
    const mapping: TableMapping = { kind: 'losses', columns: ['subject', { day: '1945-04-16', field: 'total' }, { day: '1945-04-17', field: 'total' }] };
    const r = rowsToCandidates(rows, mapping, doc);
    expect(r.errors).toEqual([]);
    expect(r.candidates).toHaveLength(3);
    expect(r.candidates.map((c) => (c.claim as { from: string }).from)).toEqual(['1945-04-16', '1945-04-16', '1945-04-17']);
    expect(r.candidates[0].claim).toMatchObject({ kind: 'losses', total: 1200, to: '1945-04-16' });
    expect(new Set(r.candidates.map((c) => c.id)).size).toBe(3);
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
    const r = parseFactsJson(JSON.parse(readFileSync(new URL('../../../apps/editor/public/samples/facts-template.json', import.meta.url), 'utf8')), doc);
    expect(r.errors).toEqual([]);
    expect(r.candidates.map((c) => c.origin)).toEqual(['agent', 'agent', 'table', 'table']);
    expect(r.candidates[0].evidence).toEqual({ kind: 'agent', ref: 'Условный фонд, оп. 1, д. 1, л. 12', quote: 'К исходу дня в армии 52000 человек, 310 танков' });
    expect(r.candidates[2].evidence).toMatchObject({ kind: 'row', row: 3 });
    expect(r.candidates[1].reliability).toBe('B');
  });

  it('запрос сопоставления и схема', () => {
    const m = mappingMessages(['Часть', 'Дата'], [['1-я А', '16.04.1945']]);
    expect(m[1].content).toContain('Часть | Дата');
    expect(MAPPING_SCHEMA.required).toEqual(['kind', 'columns']);
  });
});
