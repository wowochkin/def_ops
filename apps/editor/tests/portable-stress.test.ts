import { afterEach, expect, it, vi } from 'vitest';
import { expoSpeechText } from '../src/expo/live-voice-profile';
import { loadPortableStress, savePortableStress } from '../src/portable/stress';
import BASE from '../src/expo/bank-data/stress.json';
afterEach(async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(BASE))));
  await loadPortableStress();
  vi.unstubAllGlobals();
});
it('пользовательское исправление сразу меняет живую озвучку, не удаляя другие записи', async () => {
  const merged = { ...BASE, words: { ...BASE.words, Кетцин: 'Кетц+ин' } };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(merged)));
  vi.stubGlobal('fetch', fetcher);
  await savePortableStress('Кетцин', 'Кетц+ин');
  expect(expoSpeechText('Кетцин')).toContain('Кетци́н');
  expect(fetcher.mock.calls[0][1].method).toBe('PATCH');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ word: 'Кетцин', say: 'Кетц+ин' });
});
it('неудачное сохранение не подменяет рабочий словарь', async () => {
  const before = expoSpeechText('Кетцин');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Нет места на диске' }), { status: 500 })));
  await expect(savePortableStress('Кетцин', 'Кетц+ин')).rejects.toThrow('Нет места на диске');
  expect(expoSpeechText('Кетцин')).toBe(before);
});
