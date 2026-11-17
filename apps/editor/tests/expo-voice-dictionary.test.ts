import { expect, it } from 'vitest';
import { dictionaryEntry, updateDictionary } from '../../../scripts/expo-voice-dictionary';

it('сохраняет все чужие исправления и явно обновляет только выбранное слово', () => {
  const original = { mark: { model: 'acute' as const }, words: { Хальбе: 'Х+альбе', Кетцин: 'К+етцин', кетцин: 'к+етцин' } };
  const next = updateDictionary(original, 'Кетцин', 'Кетц+ин');
  expect(next.words).toEqual({ Хальбе: 'Х+альбе', Кетцин: 'Кетц+ин', кетцин: 'Кетц+ин' });
  expect(original.words.Кетцин).toBe('К+етцин');
  expect(next.mark).toEqual(original.mark);
});

it('добавляет своё слово без догадки об ударении и затем сохраняет пометку', () => {
  const pending = updateDictionary({ mark: {}, words: {} }, 'Кетцину', '');
  expect(pending.pending).toEqual(['Кетцину']);
  expect(pending.words).toEqual({});
  const saved = updateDictionary(pending, 'Кетцину', 'Ке́тцину');
  expect(saved.words).toEqual({ Кетцину: 'К+етцину' });
  expect(saved.pending).toEqual([]);
});

it('не сохраняет опечатки, лишние ударения или HTML вместо слова', () => {
  for (const [word, say] of [['Кетцин', 'К+етцина'], ['Кетцин', 'Ке+тцин'], ['Кетцин', 'К+етц+ин'], ['<script>', '']]) {
    expect(() => dictionaryEntry(word, say)).toThrow();
  }
  expect(dictionaryEntry('Франкфурт-на-Одере', 'Фр+анкфурт-на-+Одере').say).toBe('Фр+анкфурт-на-+Одере');
});
