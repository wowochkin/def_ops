import { describe, expect, it } from 'vitest';
import { fold, fuzzyIndex, nearestTitles } from '../src/live/fuzzy-area';

const T = ['Зелов (Seelow)', 'Кюстрин (Küstrin)', 'Мюнхеберг (Müncheberg)', 'Фюрстенвальде (Fürstenwalde)', 'Альтфридланд (Altfriedland)',
  'Фридланд (Friedland)', 'Лёкниц (Loecknitz)', 'Нойдамм (Neudamm)', 'Нойдорф (Neudorf)', 'Крайник (Krajnik)', 'Одерберг (Oderberg)'];
const at = (q: string) => { const i = fuzzyIndex(q, T); return i < 0 ? null : T[i].replace(/ \(.*/, ''); };

describe('допроверка названий пунктов', () => {
  it('опечатки и пропущенные буквы', () => {
    expect(at('Кюстрн')).toBe('Кюстрин');
    expect(at('Мюнхенберг')).toBe('Мюнхеберг');
    expect(at('Фюрстенвалде')).toBe('Фюрстенвальде');
    expect(at('Одербрег')).toBe('Одерберг'); // перестановка соседних букв
  });
  it('другое написание одного звука и двойные буквы', () => {
    expect(at('Зеелов')).toBe('Зелов');
    expect(at('Кустрин')).toBe('Кюстрин');
    expect(at('Крайнык')).toBe('Крайник');
  });
  it('шум вокруг названия: город, предлоги', () => {
    expect(at('город Кюстрн')).toBe('Кюстрин');
    expect(at('в районе Мюнхенберг')).toBe('Мюнхеберг');
  });
  it('оригинальное название латиницей с опечаткой', () => {
    expect(at('Muencheberg')).toBe('Мюнхеберг');
    expect(at('Müncheberk')).toBe('Мюнхеберг');
    expect(at('Seelov')).toBe('Зелов');
  });
  it('похожие соседние пункты не склеиваются', () => {
    expect(at('Нойдам')).toBe('Нойдамм');   // однозначно
    expect(at('Нойд')).toBeNull();           // коротко
    expect(at('Нойдорм')).toBe('Нойдорф');   // ближе одного, дальше другого — однозначно
    // равноудалён от двух пунктов — не угадываем, решает модель (повторный запрос с ближайшими)
    expect(fuzzyIndex('Бергеп', ['Берген', 'Бергем'])).toBe(-1);
  });
  it('чужое название и короткие слова не угадываются', () => {
    expect(at('Берлин')).toBeNull();
    expect(at('Зел')).toBeNull();
    expect(at('')).toBeNull();
  });
  it('подсказка модели: ближайшие по написанию', () => {
    expect(nearestTitles('Нойдорм', T, 2).map((x) => x.replace(/ \(.*/, ''))).toEqual(['Нойдорф', 'Нойдамм']);
    expect(nearestTitles('Кюстрн', T, 3)[0]).toMatch(/^Кюстрин/);
    expect(nearestTitles('Хельсинки', T)).toEqual([]);
  });
  it('свёртка', () => {
    expect(fold('город Кюстрин')).toBe(fold('Кустрин'));
    expect(fold('Müncheberg')).toBe('muencheberg');
  });
});
