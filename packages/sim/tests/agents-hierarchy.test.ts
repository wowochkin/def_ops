import { describe, expect, it } from 'vitest';
import { hierarchyProblems, HIGH_COMMAND, type ScenHq } from '../tools/agents/hierarchy';

const chain: ScenHq[] = [
  { id: 'su_stavka', name: 'Ставка ВГК', side: 'su', echelon: 'high_command', parent: null },
  { id: 'su_f', name: 'фронт', side: 'su', echelon: 'front', parent: 'su_stavka' },
  { id: 'su_a', name: 'армия', side: 'su', echelon: 'army', parent: 'su_f' },
  { id: 'su_k', name: 'корпус', side: 'su', echelon: 'corps', parent: 'su_a' },
];
const divs = [{ id: 'su_d', side: 'su', hq: 'su_k' }];

describe('иерархия штабов агентной модели', () => {
  it('верхние инстанции сторон', () => {
    expect(HIGH_COMMAND.su.id).toBe('su_stavka');
    expect(HIGH_COMMAND.de.id).toBe('de_hc');
  });
  it('полная цепочка — без замечаний', () => {
    expect(hierarchyProblems(chain, divs)).toEqual([]);
  });
  it('армия без старшего — обрыв цепочки', () => {
    const hqs = chain.map((h) => (h.id === 'su_a' ? { ...h, parent: null } : h));
    const p = hierarchyProblems(hqs, divs);
    expect(p.some((x) => x.includes('su_a'))).toBe(true);
  });
  it('цикл', () => {
    const hqs = chain.map((h) => (h.id === 'su_f' ? { ...h, parent: 'su_k' } : h));
    expect(hierarchyProblems(hqs, divs).some((x) => x.includes('цикл'))).toBe(true);
  });
  it('старший не старше по ступени', () => {
    const hqs = [...chain, { id: 'su_a2', name: 'армия 2', side: 'su' as const, echelon: 'army' as const, parent: 'su_k' }];
    expect(hierarchyProblems(hqs, [{ id: 'su_d2', side: 'su', hq: 'su_a2' }]).some((x) => x.includes('su_a2') && x.includes('ступен'))).toBe(true);
  });
  it('неизвестный штаб дивизии и старший другой стороны', () => {
    expect(hierarchyProblems(chain, [{ id: 'su_x', side: 'su', hq: 'nope' }]).some((x) => x.includes('su_x'))).toBe(true);
    const hqs = [...chain, { id: 'de_hc', name: 'ОКХ', side: 'de' as const, echelon: 'high_command' as const, parent: null }, { id: 'de_a', name: 'армия', side: 'de' as const, echelon: 'army' as const, parent: 'su_f' }];
    expect(hierarchyProblems(hqs, divs).some((x) => x.includes('de_a') && x.includes('сторон'))).toBe(true);
  });
});
