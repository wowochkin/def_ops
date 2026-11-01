import { describe, expect, it } from 'vitest';
import { applyStress, markStress, plainStress, stressed } from '../src/expo/stress';
import STRESS from '../src/expo/bank-data/stress.json';

describe('ударения для озвучки стенда', () => {
  it('словарь ставит «+» в словах целиком, с учётом заглавной', () => {
    expect(applyStress('прорыв из котла у Хальбе, хальбе', { Хальбе: 'Х+альбе' })).toBe('прорыв из котла у Х+альбе, х+альбе');
    expect(applyStress('Хальбеск', { Хальбе: 'Х+альбе' })).toBe('Хальбеск');
  });
  it('пометка — в виде, который понимает модель', () => {
    expect(markStress('Х+альбе', 'acute')).toBe('Ха\u0301льбе');
    expect(markStress('Х+альбе', 'upper')).toBe('ХАльбе');
    expect(markStress('Х+альбе', 'plus')).toBe('Х+альбе');
    expect(markStress('2+2', 'acute')).toBe('2+2');
  });
  it('без пометок — для проверки распознаванием', () => {
    expect(plainStress('Ха\u0301льбе и Х+альбе')).toBe('Хальбе и Хальбе');
  });
  it('по умолчанию — знак ударения; у модели может быть свой вид', () => {
    expect(stressed('у Хальбе', 'x', { mark: {}, words: { Хальбе: 'Х+альбе' } }).said).toBe('у Ха\u0301льбе');
    expect(stressed('у Хальбе', 'x', { mark: { x: 'upper' }, words: { Хальбе: 'Х+альбе' } })).toEqual({ say: 'у Х+альбе', said: 'у ХАльбе' });
  });
  it('в словаре у каждого слова одна пометка перед гласной и то же слово без неё', () => {
    for (const [w, s] of Object.entries(STRESS.words)) {
      expect(plainStress(s), w).toBe(w);
      expect(s.match(/\+[аеёиоуыэюя]/gi)?.length, w).toBe(1);
    }
  });
});
