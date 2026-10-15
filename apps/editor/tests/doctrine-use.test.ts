import { describe, expect, it } from 'vitest';
import type { Claim, Entry, Fact } from '@def-ops/knowledge';
import { doctrineUsers } from '../src/kb/doctrine-use';

const rule = (side: 'su' | 'de', level: 'front' | 'army' | 'corps' | 'division'): Fact => {
  const claim: Claim = { kind: 'doctrine', side, level, group: 'commit', rule: `r-${side}-${level}`, condition: 'Условие', action: 'Действие' };
  return { key: 'principles', value: 'правило', claim };
};
const entry = (facts: Fact[]): Entry => ({ id: 'org:x', category: 'organization', title: 'Доктрина', summary: '', facts, status: 'extracted' } as Entry);

describe('Кто использует правила доктрины', () => {
  it('правило su уровня фронта — штаб противника, Ставка, посредник, штабы агентной модели', () => {
    expect(doctrineUsers(entry([rule('su', 'front')]))).toEqual(['штаб противника', 'Ставка', 'посредник', 'штабы агентной модели']);
  });
  it('правила de корпуса и армии — ОКХ (один раз)', () => {
    expect(doctrineUsers(entry([rule('de', 'corps'), rule('de', 'army'), rule('de', 'army')]))).toEqual(['штаб противника', 'ОКХ', 'посредник', 'штабы агентной модели']);
  });
  it('правило su корпуса — без Ставки; запись без доктрины — пусто', () => {
    expect(doctrineUsers(entry([rule('su', 'corps')]))).toEqual(['штаб противника', 'посредник', 'штабы агентной модели']);
    expect(doctrineUsers(entry([{ key: 'principles', value: 'текст без формальной части' }]))).toEqual([]);
    expect(doctrineUsers(entry([]))).toEqual([]);
  });
});
