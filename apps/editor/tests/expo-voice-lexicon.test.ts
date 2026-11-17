import { describe, expect, it } from 'vitest';
import { buildLexicon, sourceVocabulary } from '../../../scripts/expo-voice-lexicon';
import STRESS from '../src/expo/bank-data/stress.json';

describe('каталог слов студии озвучки', () => {
  it('включает названия всего театра, падежи, карточки и пользовательские слова с источниками', () => {
    // Изолированный словарь: Кетцину выводится из Кетцин, пока отдельная форма не подтверждена.
    const words = { Кетцин: 'К+етцин', Новореченск: 'Новор+еченск' };
    const { entries, coverage } = buildLexicon({ words }, ['К Кетцину пришли подкрепления. Новореченск удержан.']);
    const get = (word: string) => entries.find(e => e.word.toLowerCase() === word.toLowerCase())!;
    expect(get('Кетцину')).toMatchObject({ kind: 'place', status: 'derived', say: 'К+етцину' });
    expect(get('Шарлоттенбург')).toMatchObject({ kind: 'place', status: 'missing', say: null });
    expect(get('Тиргартен')).toMatchObject({ kind: 'place', status: 'missing', say: null });
    expect(get('Адлерсхоф').sources).toContain('Названия мест');
    expect(get('Новореченск')).toMatchObject({ status: 'explicit', say: 'Новор+еченск' });
    expect(get('подкрепления').examples).toContain('К Кетцину пришли подкрепления. Новореченск удержан.');
    expect(get('Тиргартен').sources).toContain('Карточки решений');
    expect(new Set(entries.map(e => e.word.toLowerCase())).size).toBe(entries.length);
    expect(coverage.total).toBe(entries.length);
    expect(coverage.explicit + coverage.derived + coverage.inherent + coverage.missing).toBe(coverage.total);
    expect(words).toEqual({ Кетцин: 'К+етцин', Новореченск: 'Новор+еченск' });
  });

  it('новая подтверждённая форма сразу меняет статус; неизвестные ударения не создаются', () => {
    const d = { mark: {}, words: { Шарлоттенбург: 'Шарл+оттенбург' } };
    const { entries } = buildLexicon(d);
    expect(entries.find(e => e.word === 'Шарлоттенбург')).toMatchObject({ status: 'explicit', say: 'Шарл+оттенбург' });
    expect(entries.find(e => e.word === 'Шарлоттенбургу')).toMatchObject({ status: 'derived', say: 'Шарл+оттенбургу' });
    expect(entries.find(e => e.word === 'Мюнхебергу')).toMatchObject({ status: 'missing', say: null });
  });

  it('свои слова без пометки и составные словарные записи видны целиком', () => {
    const entries = buildLexicon({ words: { 'Бад-Фрайенвальде': 'Бад-Фр+айенвальде' }, pending: ['Лесной рубеж', 'Зелёный замок'] }).entries;
    expect(entries.find(e => e.word === 'Бад-Фрайенвальде')).toMatchObject({ status: 'explicit', say: 'Бад-Фр+айенвальде' });
    expect(entries.find(e => e.word === 'Лесной рубеж')).toMatchObject({ status: 'missing', say: null });
    expect(entries.find(e => e.word === 'Зелёный замок')).toMatchObject({ status: 'missing', say: null });
  });

  it('не скрывает сохранённые пользователем названия на других языках', () => {
    const entries = buildLexicon({ words: { Cottbus: 'Cottbus' }, pending: ['S-Bahn', 'Łódź', 'Cottbus мост'] }).entries;
    expect(entries.find(e => e.word === 'Cottbus')).toMatchObject({ status: 'explicit', say: 'Cottbus' });
    for (const word of ['S-Bahn', 'Łódź', 'Cottbus мост']) {
      expect(entries.find(e => e.word === word)).toMatchObject({ status: 'missing', say: null });
    }
  });

  it('добавляет лексику разбора из исходных строк, без исполнения модели', () => {
    const source = sourceVocabulary();
    expect(source.some(s => s.includes('Разбираю, как она прошла'))).toBe(true);
    expect(source.every(s => /[а-яё]/i.test(s))).toBe(true);
    expect(source.some(s => /\$\{|=>/.test(s))).toBe(false);
    expect(buildLexicon(STRESS, source).entries.some(e => e.word.toLowerCase() === 'разбираю')).toBe(true);
  });
});

 it('подсказки не становятся сохранёнными ударениями и не перекрывают правку пользователя', () => {
  const data = { words: { авиации: 'авиац+ии' }, pending: ['агентное', 'Берёза', 'замок'] };
  const rows = buildLexicon(data).entries;
  expect(rows.find(e => e.word === 'авиации')).toMatchObject({ say: 'авиац+ии', suggestion: null });
  expect(rows.find(e => e.word === 'агентное')).toMatchObject({ say: null, suggestion: 'аг+ентное', status: 'missing' });
  expect(rows.find(e => e.word === 'Берёза')?.suggestion).toBe('Бер+ёза');
  expect(rows.find(e => e.word === 'замок')?.suggestion).toBeNull();
  expect(data.words).toEqual({ авиации: 'авиац+ии' });
 });
