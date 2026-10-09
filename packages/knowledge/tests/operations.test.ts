import { describe, expect, it } from 'vitest';
import { entryOperations, extractMessages, foreignTo, inOperation, OPERATION_EXTRACT_SCHEMA, toInfraProposals, toProposals, applyProposal, type Entry, type KbOperation } from '../src';

const OPS: KbOperation[] = [{ id: 'berlin-1945', title: 'Берлин', start: '1945-04-16T00:00', end: '1945-05-02T00:00' }, { id: 'vistula-oder-1945', title: 'Висла', start: '1945-01-12T00:00', end: '1945-02-03T00:00' }];
const e = (x: Partial<Entry>): Entry => ({ id: 'x', category: 'battles', title: 't', summary: '', status: 'checked', ...x });

describe('база знаний по операциям', () => {
  it('операция записи — явно, по рубрике и по периоду; общие — без операции', () => {
    expect(entryOperations(e({ rubrics: ['1.2.6'] }), OPS)).toEqual(['berlin-1945']);
    expect(entryOperations(e({ category: 'chronology', period: { from: '1945-01-20' } }), OPS)).toEqual(['vistula-oder-1945']);
    expect(entryOperations(e({ category: 'equipment', rubrics: ['4.1'] }), OPS)).toEqual([]);
    expect(inOperation(e({ category: 'equipment' }), 'general', OPS)).toBe(true);
    expect(entryOperations(e({ origin: 'document', operations: ['my-op'], rubrics: ['1.2'] }), OPS)).toEqual(['my-op']);
  });

  it('разбор документа операции: новые записи — её, чужие записи из документов не дополняются, запрос просит инфраструктуру', () => {
    const chunk = 'Мост через Шпрее у Фюрстенвальде взорван 22 апреля 1945 года отходящими частями.';
    const msg = extractMessages(chunk, 'док', { id: 'op1', title: 'Операция', start: '1945-04-16', end: '1945-05-02', sides: [{ id: 'su', name: 'СССР' }] });
    expect(msg[0].content).toMatch(/infrastructure/);
    expect(OPERATION_EXTRACT_SCHEMA.required).toContain('infrastructure');
    const items = [{ category: 'battles' as const, title: 'Бой у Фюрстенвальде', aliases: [], summary: '', facts: [{ key: 'course', value: 'мост взорван', quote: 'Мост через Шпрее у Фюрстенвальде взорван' }], relations: [], dateFrom: null, dateTo: null }];
    const other = e({ id: 'u:op2:battles:x', title: 'Бой у Фюрстенвальде', origin: 'document', operations: ['op2'] });
    const r = toProposals(items, chunk, [other], { id: 'd1', name: 'док', reliability: 'B', operation: 'op1' }, 0);
    expect(r.proposals[0].kind).toBe('new');
    expect(r.proposals[0].entry.operations).toEqual(['op1']);
    expect(foreignTo(other, 'op1')).toBe(true);
    const seed = e({ id: 's', title: 'Бой у Фюрстенвальде', origin: 'seed' });
    const u = toProposals(items, chunk, [seed], { id: 'd1', name: 'док', reliability: 'B', operation: 'op1' }, 0).proposals[0];
    expect(u.kind).toBe('update');
    expect(applyProposal(u, seed).operations).toEqual(['op1']);
  });

  it('сведения об инфраструктуре — только с цитатой из текста', () => {
    const chunk = 'Мост через Шпрее у Фюрстенвальде взорван 22 апреля 1945 года отходящими частями.';
    const base = { kind: 'bridge' as const, state: 'destroyed' as const, title: 'мост через Шпрее', place: 'Фюрстенвальде', river: 'Шпрее', date: '1945-04-22', dateTo: null, side: null, note: null };
    const r = toInfraProposals([{ ...base, quote: 'Мост через Шпрее у Фюрстенвальде взорван' }, { ...base, quote: 'мост был цел и невредим всю войну' }], chunk, { id: 'd1', name: 'док', reliability: 'B', operation: 'op1' }, 0);
    expect(r.proposals).toHaveLength(1);
    expect(r.dropped).toBe(1);
    expect(r.proposals[0].item.date).toBe('1945-04-22');
  });
});
