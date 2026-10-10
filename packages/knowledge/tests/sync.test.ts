import { describe, expect, it } from 'vitest';
import { matchFormation, parseCount, reconcile, toPositionProposals, type Entry } from '../src';

const op = { id: 'op', title: 'Операция', start: '1945-04-16T00:00', end: '1945-05-02T00:00' };
const entry = (id: string, title: string, facts: Entry['facts'], aliases: string[] = []): Entry => ({ id, category: 'formations', title, aliases, summary: '', facts, status: 'checked' });

describe('сверка базы со сценарием', () => {
  it('числа из значений фактов', () => {
    expect(parseCount('768 000 — без резервов и тылов, на 16.04')).toBe(768000);
    expect(parseCount('около 85 тыс. человек')).toBe(85000);
    expect(parseCount('САУ: 1 360 — на 16.04')).toBe(1360);
    expect(parseCount('нет сведений')).toBeNull();
  });

  it('база → сценарий: списочная численность пересчитывается в боевую; танки — с САУ', () => {
    const kb = [entry('f:a', '8-я гвардейская армия', [
      { key: 'personnel', value: '100 000 на 16.04', reliability: 'A', source: 's' },
      { key: 'tanks', value: '200 — на 16.04', reliability: 'A' }, { key: 'tanks', value: 'САУ: 100 — на 16.04', reliability: 'A' },
    ], ['su_8gva'])];
    const items = reconcile({ operation: op, formations: [{ id: 'su_8gva', name: '8-я гв. армия', side: 'su', echelon: 'army', personnel: 50000, tanks: 300, guns: 2000 }] }, kb);
    const p = items.find((i) => i.key === 'personnel')!;
    expect(p.dir).toBe('toScenario');
    expect(p.value).toBe(60000);
    expect(items.some((i) => i.key === 'tanks' && i.dir === 'toScenario')).toBe(false); // 200 + 100 = 300 — совпадает
    const g = items.find((i) => i.key === 'guns')!;
    expect(g.dir).toBe('toKb');
    expect(g.facts![0].reliability).toBe('C');
    expect(g.entry).toBe('f:a');
  });

  it('факты на поздние даты не берутся; боевая численность не пересчитывается', () => {
    const kb = [entry('f:b', 'LVI танковый корпус', [{ key: 'personnel', value: '5 000 на 28.04', reliability: 'A' }, { key: 'personnel', value: '30 000 — боевая численность', reliability: 'B' }], ['de_56tk'])];
    const items = reconcile({ operation: op, formations: [{ id: 'de_56tk', name: 'LVI тк', side: 'de', echelon: 'corps', personnel: 20000 }] }, kb);
    expect(items.find((i) => i.key === 'personnel')?.value).toBe(30000);
    // «не численность на 16.04, а прорвавшиеся» — не цифра на начало операции
    const neg = reconcile({ operation: op, formations: [{ id: 'n', name: 'N', side: 'de', echelon: 'division', personnel: 4000 }] }, [entry('f:n', 'N', [{ key: 'personnel', value: '4 000 — не численность на 16.04, а прорвавшиеся в Берлин', reliability: 'B' }], ['n'])]);
    expect(neg.some((i) => i.dir === 'toScenario')).toBe(false);
  });

  it('сценарий → база: подчинённость и боевой путь из истории', () => {
    const items = reconcile({ operation: op, formations: [{ id: 'x', name: 'X корпус', side: 'su', echelon: 'corps', parentName: 'Y армия',
      positions: [{ time: '1945-04-16T00:00', place: 'Зелов', source: 'Z p.1', reliability: 'A' }, { time: '1945-04-20T00:00', place: 'Бернау', source: 'Z p.2', reliability: 'B' }] }] }, []);
    expect(items.find((i) => i.key === 'parent')?.facts?.[0].value).toBe('Y армия');
    const path = items.find((i) => i.key === 'path')!;
    expect(path.facts![0].value).toBe('16.04 — Зелов; 20.04 — Бернау');
    expect(path.facts![0].reliability).toBe('B');
    expect(path.entry).toBeUndefined();
  });

  it('формирование по названию из документа', () => {
    const fs = [{ id: 'su_8gva', name: '8-я гвардейская армия' }, { id: 'su_5ua', name: '5-я ударная армия' }, { id: 'su_8a', name: '8-я армия' }];
    expect(matchFormation('8-я гвардейская армия', fs, [])).toBe('su_8gva');
    expect(matchFormation('8 гв. армия', fs, [])).toBe('su_8gva');
    expect(matchFormation('5-я ударная армия', fs, [])).toBe('su_5ua');
    expect(matchFormation('Армия Венка', fs, [entry('f:w', '12-я армия', [], ['Армия Венка', 'su_8a'])])).toBe('su_8a');
    expect(matchFormation('3-я танковая армия', fs, [])).toBeNull();
  });

  it('положения из документа: только с датой, местом и дословной цитатой', () => {
    const text = 'К исходу 22 апреля 8-я гвардейская армия вышла к Эркнеру. Прочее.';
    const r = toPositionProposals([
      { formation: '8-я гвардейская армия', date: '1945-04-22', place: 'Эркнер', note: null, quote: '8-я гвардейская армия вышла к Эркнеру' },
      { formation: '8-я гвардейская армия', date: 'апрель', place: 'Эркнер', note: null, quote: '8-я гвардейская армия вышла к Эркнеру' },
      { formation: '5-я ударная армия', date: '1945-04-22', place: 'Берлин', note: null, quote: '5-я ударная армия ворвалась в Берлин' },
    ], text, { id: 'd1', name: 'doc', reliability: 'B', operation: 'op' }, 0);
    expect(r.proposals).toHaveLength(1);
    expect(r.dropped).toBe(2);
    expect(r.proposals[0].item.date).toBe('1945-04-22');
  });
});
