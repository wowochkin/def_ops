// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import * as historical from '../src/kb/store';
import { modernStore } from '../src/kb/store';

afterEach(() => historical.resetForTests());

it('изолирует записи, документы, очереди, закрепления и векторы даже при одинаковых id', async () => {
  for (const name of ['entries', 'documents', 'candidates', 'vectors', 'pins', 'pages', 'transcripts'] as const) {
    await historical.put(name, { id: 'same', value: 'historical' });
    await modernStore.put(name, { id: 'same', value: 'modern' });
    expect((await historical.one<{ value: string }>(name, 'same'))?.value).toBe('historical');
    expect((await modernStore.one<{ value: string }>(name, 'same'))?.value).toBe('modern');
    await modernStore.del(name, 'same');
    expect(await modernStore.one(name, 'same')).toBeUndefined();
    expect(await historical.one(name, 'same')).toBeTruthy();
    await historical.del(name, 'same');
  }
});

it('современное наполнение не содержит исторических сценариев, историческое не содержит нового корпуса', async () => {
  const old = await historical.seed(), modern = await modernStore.seed();
  expect(old.some(e => e.id === 'op:berlin')).toBe(true);
  expect(old.some(e => e.id.startsWith('modern:'))).toBe(false);
  expect(modern.length).toBeGreaterThan(60);
  expect(modern.every(e => e.id.startsWith('modern:') && e.status === 'draft')).toBe(true);
  expect(modern.some(e => e.id === 'modern:org:gb-royal-artillery')).toBe(true);
  expect(modern.some(e => e.scenario || e.facts?.some(f => f.claim || f.norm))).toBe(false);
});
