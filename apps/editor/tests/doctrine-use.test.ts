import { describe, expect, it } from 'vitest';
import type { Claim, Entry, Fact } from '@def-ops/knowledge';
import { doctrineUsers } from '../src/kb/doctrine-use';

const rule = (side: 'su' | 'de', level: 'front' | 'army' | 'corps' | 'division'): Fact => {
  const claim: Claim = { kind: 'doctrine', side, level, group: 'commit', rule: `r-${side}-${level}`, condition: 'Условие', action: 'Действие' };
  return { key: 'principles', value: 'правило', claim };
};
const entry = (facts: Fact[]): Entry => ({ id: 'org:x', category: 'organization', title: 'Доктрина', summary: '', facts, status: 'extracted' } as Entry);

describe('Кто использует правила доктрины', () => {
  it('правило su уровня фронта — штаб противника своей стороны, Ставка, посредник; штабам агентной модели фронт не нужен', () => {
    expect(doctrineUsers(entry([rule('su', 'front')]))).toEqual(['штаб противника (советской стороны)', 'Ставка', 'посредник']);
  });
  it('правила de корпуса и армии — штаб противника немецкой стороны, ОКХ (один раз), штабы агентной модели', () => {
    expect(doctrineUsers(entry([rule('de', 'corps'), rule('de', 'army'), rule('de', 'army')]))).toEqual(['штаб противника (немецкой стороны)', 'ОКХ', 'посредник', 'штабы агентной модели']);
  });
  it('правило de фронта — ОКХ, без штабов агентной модели; правило su дивизии — без Ставки и без агентной модели', () => {
    expect(doctrineUsers(entry([rule('de', 'front')]))).toEqual(['штаб противника (немецкой стороны)', 'ОКХ', 'посредник']);
    expect(doctrineUsers(entry([rule('su', 'division')]))).toEqual(['штаб противника (советской стороны)', 'посредник']);
  });
  it('правила обеих сторон — штаб противника за каждую сторону', () => {
    expect(doctrineUsers(entry([rule('su', 'corps'), rule('de', 'division')]))).toEqual(['штаб противника (советской стороны)', 'штаб противника (немецкой стороны)', 'посредник', 'штабы агентной модели']);
  });
  it('правило su корпуса — без Ставки, со штабами агентной модели; запись без доктрины — пусто', () => {
    expect(doctrineUsers(entry([rule('su', 'corps')]))).toEqual(['штаб противника (советской стороны)', 'посредник', 'штабы агентной модели']);
    expect(doctrineUsers(entry([{ key: 'principles', value: 'текст без формальной части' }]))).toEqual([]);
    expect(doctrineUsers(entry([]))).toEqual([]);
  });
});
