import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BANK, bankErrors, deal, replacement, turnCards } from '../src/expo/bank';

const ROOT = join(__dirname, '../../..');
const scenario = JSON.parse(readFileSync(join(ROOT, BANK.scenario), 'utf8')) as { hqs: { id: string; parent: string | null; echelon: string }[]; theatre: string };
const theatre = JSON.parse(readFileSync(join(ROOT, 'packages/sim/data/theatres/oder-berlin-1945.json'), 'utf8')) as { areas: { id: string }[] };
const armiesOf = (front: string) => scenario.hqs.filter((h) => h.parent === front && h.echelon === 'army').map((h) => h.id);
const places = new Set(theatre.areas.map((a) => a.id));

/** Детерминированный генератор для раздачи. */
const seq = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe('банк карточек', () => {
  it('form is valid: own armies, theatre places, card text', () => {
    expect(bankErrors(BANK, armiesOf, places)).toEqual([]);
  });

  it('form errors are caught', () => {
    const bad = { ...BANK, cards: BANK.cards.map((c) => (c.id === 'bf1-north' ? { ...c, orders: [{ army: 'su_3gta', kind: 'attack' as const, place: 'Nowhere' }] } : c)) };
    const errs = bankErrors(bad, armiesOf, places);
    expect(errs.some((e) => e.includes('su_3gta'))).toBe(true);
    expect(errs.some((e) => e.includes('Nowhere'))).toBe(true);
  });

  it('every card has a source or an assumption', () => {
    for (const c of BANK.cards) expect('source' in c.basis ? c.basis.source : c.basis.assumption).toBeTruthy();
  });

  it('deal: historical card and two own, shuffled', () => {
    const positions = new Set<number>();
    for (let s = 1; s < 40; s++) {
      const ids = deal(BANK, 'su_1bf', 2, seq(s));
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
      expect(ids.filter((id) => BANK.cards.find((c) => c.id === id)!.historical)).toEqual(['bf2-hist']);
      positions.add(ids.indexOf('bf2-hist'));
    }
    expect(positions.size).toBe(3);
  });

  it('replacement: unshown own card; historical is never replaced', () => {
    const shown = deal(BANK, 'su_1uf', 1, seq(7));
    const own = shown.find((id) => !id.endsWith('-hist'))!;
    const r = replacement(BANK, shown, own, seq(3))!;
    expect(shown).not.toContain(r);
    expect(turnCards(BANK, 'su_1uf', 1).map((c) => c.id)).toContain(r);
    expect(replacement(BANK, shown, 'uf1-hist')).toBeNull();
    expect(replacement(BANK, turnCards(BANK, 'su_1uf', 1).map((c) => c.id), own)).toBeNull();
  });
});
